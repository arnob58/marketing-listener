import type { OffscreenRequest, OffscreenResponse } from '../../core/messages';
import { sha256Hex } from '../../core/hash';
import { TransformersEmbedder, installGuardedFetch, type Embedder } from '../../features/embeddings';
import { fetchImageBytes } from '../../features/imageFetch';
import { rgbaToGray } from '../../features/phash';
import { THUMB_MAX_SIDE, encodeWithinBudget, thumbnailSize } from '../../features/thumbnail';
import { FeatureWorker, type FeatureCache } from '../../features/worker';
import { getDb } from '../../storage/db';
import { Repository } from '../../storage/repositories';

const DECODE_SIZE = 64;
let embeddingsAllowed = false;
installGuardedFetch(() => embeddingsAllowed);

const repo = new Repository(getDb());
const cache: FeatureCache = {
  getImage: (h) => repo.getImageFeatures(h),
  putImage: (f) => repo.putImageFeatures(f),
  getText: (h) => repo.getTextFeatures(h),
  putText: (f) => repo.putTextFeatures(f),
};

let embedder: TransformersEmbedder | null = null;
const getEmbedder = (): Embedder => (embedder ??= new TransformersEmbedder(chrome.runtime.getURL('/ort/')));

const fetchImage = (url: string) => fetchImageBytes(fetch, url);

async function decodeGray(bytes: Uint8Array, mime: string) {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const canvas = new OffscreenCanvas(DECODE_SIZE, DECODE_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, DECODE_SIZE, DECODE_SIZE);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, DECODE_SIZE, DECODE_SIZE);
  return rgbaToGray(data, DECODE_SIZE, DECODE_SIZE);
}

/** Shrinks the bytes already fetched for hashing; no further network request. */
async function makeThumbnail(bytes: Uint8Array, mime: string): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
  const { width, height } = thumbnailSize(bitmap.width, bitmap.height, THUMB_MAX_SIDE);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return encodeWithinBudget((quality) => canvas.convertToBlob({ type: 'image/jpeg', quality }));
}

const idle = () => new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 500 }));

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'features:compute') return false;
  embeddingsAllowed = msg.embeddings;
  const worker = new FeatureWorker({
    fetchImage,
    decodeGray,
    hashBytes: sha256Hex,
    cache,
    makeThumbnail,
    saveThumbnail: (key, blob) => repo.putThumbnail({ key, blob, at: Date.now() }),
    hasThumbnail: (key) => repo.hasThumbnail(key),
    embedder: msg.embeddings ? getEmbedder() : null,
  });
  (async (): Promise<OffscreenResponse> => {
    const results = [];
    for (const job of msg.jobs) {
      results.push(await worker.process(job));
      await idle();
    }
    return { ok: true, results };
  })().then(sendResponse, (e: Error) => sendResponse({ ok: false, error: e.message } satisfies OffscreenResponse));
  return true;
});
