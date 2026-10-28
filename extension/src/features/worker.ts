import { hashHex, normalizeCaption } from '../core/hash';
import type { ImageFeatures, TextFeatures } from '../core/types';
import type { Embedder } from './embeddings';
import { minhash } from './minhash';
import { dHash, type GrayImage } from './phash';

export interface FeatureJob {
  postKey: string;
  imageUrl: string | null;
  text: string;
}

export interface FeatureResult {
  postKey: string;
  imageHash: string | null;
  textHash: string | null;
  error?: string;
}

/** Features are cached by content hash so identical media or captions are computed once. */
export interface FeatureCache {
  getImage(hash: string): Promise<ImageFeatures | undefined>;
  putImage(f: ImageFeatures): Promise<unknown>;
  getText(hash: string): Promise<TextFeatures | undefined>;
  putText(f: TextFeatures): Promise<unknown>;
}

export interface FeatureWorkerDeps {
  fetchImage(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
  decodeGray(bytes: Uint8Array, mime: string): Promise<GrayImage>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  cache: FeatureCache;
  /** Optional: shrinks the already-fetched bytes to a small JPEG. No extra network request is made. */
  makeThumbnail?(bytes: Uint8Array, mime: string): Promise<Blob>;
  saveThumbnail?(postKey: string, blob: Blob): Promise<unknown>;
  /** True when the post already has a thumbnail, so it is not regenerated. */
  hasThumbnail?(postKey: string): Promise<boolean>;
  /** Null until the user opts in to the embedding models. */
  embedder: Embedder | null;
}

export const textKey = (text: string): string => hashHex(normalizeCaption(text));

export class FeatureWorker {
  constructor(private readonly deps: FeatureWorkerDeps) {}

  async process(job: FeatureJob): Promise<FeatureResult> {
    const result: FeatureResult = { postKey: job.postKey, imageHash: null, textHash: null };
    try {
      if (job.imageUrl) result.imageHash = await this.image(job.postKey, job.imageUrl);
    } catch (e) {
      result.error = `image: ${(e as Error).message}`;
    }
    try {
      if (normalizeCaption(job.text)) result.textHash = await this.text(job.text);
    } catch (e) {
      result.error = `${result.error ? `${result.error}; ` : ''}text: ${(e as Error).message}`;
    }
    return result;
  }

  /** A failed thumbnail never fails the features: it is a convenience for the dashboard. */
  private async thumbnail(postKey: string, bytes: Uint8Array, mime: string): Promise<void> {
    const { makeThumbnail, saveThumbnail, hasThumbnail } = this.deps;
    if (!makeThumbnail || !saveThumbnail) return;
    try {
      if (await hasThumbnail?.(postKey)) return;
      await saveThumbnail(postKey, await makeThumbnail(bytes, mime));
    } catch {
      /* ignore */
    }
  }

  private async image(postKey: string, url: string): Promise<string> {
    const { bytes, mime } = await this.deps.fetchImage(url);
    await this.thumbnail(postKey, bytes, mime);
    const hash = await this.deps.hashBytes(bytes);
    const cached = await this.deps.cache.getImage(hash);
    const embedder = this.deps.embedder;
    if (cached && (cached.vec || !embedder)) return hash;

    const phash = cached?.phash ?? dHash(await this.deps.decodeGray(bytes, mime));
    const vec = embedder ? await embedder.embedImage(bytes, mime) : null;
    await this.deps.cache.putImage({ hash, phash, vec });
    return hash;
  }

  private async text(text: string): Promise<string> {
    const hash = textKey(text);
    const cached = await this.deps.cache.getText(hash);
    const embedder = this.deps.embedder;
    if (cached && (cached.vec || !embedder)) return hash;

    const vec = embedder ? await embedder.embedText(text) : null;
    await this.deps.cache.putText({ hash, minhash: cached?.minhash ?? minhash(text), vec });
    return hash;
  }
}
