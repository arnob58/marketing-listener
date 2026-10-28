import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/core/hash';
import { THUMB_MAX_BYTES, encodeWithinBudget, thumbnailSize } from '../../src/features/thumbnail';
import { FeatureWorker, type FeatureCache } from '../../src/features/worker';
import { syntheticImage } from '../helpers/images';

const cache = (): FeatureCache => ({
  getImage: async () => undefined,
  putImage: async () => {},
  getText: async () => undefined,
  putText: async () => {},
});

describe('thumbnail sizing', () => {
  it('fits the longest side to 160px and never upscales', () => {
    expect(thumbnailSize(1080, 1350)).toEqual({ width: 128, height: 160 });
    expect(thumbnailSize(1600, 900)).toEqual({ width: 160, height: 90 });
    expect(thumbnailSize(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it('lowers JPEG quality until the result fits about 12KB', async () => {
    const sizes: Record<string, number> = { '0.7': 30_000, '0.55': 20_000, '0.4': 11_000, '0.28': 8_000, '0.18': 5_000 };
    const encode = vi.fn(async (q: number) => new Blob([new Uint8Array(sizes[String(q)])]));
    const blob = await encodeWithinBudget(encode);
    expect(blob.size).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    expect(encode).toHaveBeenCalledTimes(3);
  });
});

describe('FeatureWorker thumbnails', () => {
  const bytes = new TextEncoder().encode('image-bytes');

  it('builds the thumbnail from the bytes already fetched for the hash: one fetch, no extra requests', async () => {
    const fetchImage = vi.fn(async () => ({ bytes, mime: 'image/jpeg' }));
    const makeThumbnail = vi.fn(async () => new Blob(['t']));
    const saved = new Map<string, Blob>();
    const w = new FeatureWorker({
      fetchImage, decodeGray: async () => syntheticImage(2), hashBytes: sha256Hex, cache: cache(), embedder: null,
      makeThumbnail, saveThumbnail: async (k, b) => void saved.set(k, b), hasThumbnail: async (k) => saved.has(k),
    });
    const r = await w.process({ postKey: 'instagram:a', imageUrl: 'https://scontent.cdninstagram.com/a', text: '' });
    expect(r.imageHash).toBeTruthy();
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(makeThumbnail).toHaveBeenCalledWith(bytes, 'image/jpeg');
    expect(saved.has('instagram:a')).toBe(true);
  });

  it('does not regenerate an existing thumbnail, and a thumbnail failure never fails the features', async () => {
    const makeThumbnail = vi.fn(async (): Promise<Blob> => { throw new Error('canvas gone'); });
    const base = { fetchImage: async () => ({ bytes, mime: 'image/jpeg' }), decodeGray: async () => syntheticImage(2), hashBytes: sha256Hex, cache: cache(), embedder: null, saveThumbnail: async () => {} };
    const failing = await new FeatureWorker({ ...base, makeThumbnail, hasThumbnail: async () => false }).process({ postKey: 'x:1', imageUrl: 'https://pbs.twimg.com/a', text: '' });
    expect(failing.error).toBeUndefined();
    expect(failing.imageHash).toBeTruthy();
    makeThumbnail.mockClear();
    await new FeatureWorker({ ...base, makeThumbnail, hasThumbnail: async () => true }).process({ postKey: 'x:1', imageUrl: 'https://pbs.twimg.com/a', text: '' });
    expect(makeThumbnail).not.toHaveBeenCalled();
  });
});
