import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/core/hash';
import { IdleUnloader, MODEL_IDLE_MS, cosine, type Embedder } from '../../src/features/embeddings';
import { FeatureWorker, textKey, type FeatureCache } from '../../src/features/worker';
import type { ImageFeatures, TextFeatures } from '../../src/core/types';
import { syntheticImage } from '../helpers/images';

function memoryCache(): FeatureCache & { images: Map<string, ImageFeatures>; texts: Map<string, TextFeatures> } {
  const images = new Map<string, ImageFeatures>();
  const texts = new Map<string, TextFeatures>();
  return {
    images,
    texts,
    getImage: async (h) => images.get(h),
    putImage: async (f) => void images.set(f.hash, f),
    getText: async (h) => texts.get(h),
    putText: async (f) => void texts.set(f.hash, f),
  };
}

function fakeEmbedder() {
  const calls = { text: 0, image: 0 };
  const embedder: Embedder = {
    embedText: async () => (calls.text++, [1, 0, 0]),
    embedImage: async () => (calls.image++, [0, 1, 0]),
    unload: async () => {},
  };
  return { embedder, calls };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('FeatureWorker', () => {
  it('computes dHash and minhash without any model when embeddings are off', async () => {
    const cache = memoryCache();
    const decode = vi.fn(async () => syntheticImage(3));
    const w = new FeatureWorker({ fetchImage: async () => ({ bytes: bytes('img'), mime: 'image/png' }), decodeGray: decode, hashBytes: sha256Hex, cache, embedder: null });
    const r = await w.process({ postKey: 'x:1', imageUrl: 'https://pbs.twimg.com/a', text: 'a long enough caption for hashing purposes' });
    expect(r.error).toBeUndefined();
    const img = cache.images.get(r.imageHash!)!;
    expect(img.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(img.vec).toBeNull();
    const txt = cache.texts.get(r.textHash!)!;
    expect(txt.minhash.length).toBe(64);
    expect(txt.vec).toBeNull();
  });

  it('computes each distinct image and caption once, keyed by content hash', async () => {
    const cache = memoryCache();
    const { embedder, calls } = fakeEmbedder();
    const decode = vi.fn(async () => syntheticImage(3));
    const w = new FeatureWorker({
      fetchImage: async (url) => ({ bytes: bytes(url.includes('copy') ? 'same-bytes' : 'same-bytes'), mime: 'image/jpeg' }),
      decodeGray: decode, hashBytes: sha256Hex, cache, embedder,
    });
    const job = { imageUrl: 'https://pbs.twimg.com/orig', text: 'The very same caption, posted twice!' };
    const a = await w.process({ postKey: 'x:1', ...job });
    const b = await w.process({ postKey: 'instagram:2', imageUrl: 'https://scontent.cdninstagram.com/copy', text: 'the very same caption posted twice' });
    expect(a.imageHash).toBe(b.imageHash);
    expect(a.textHash).toBe(b.textHash);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(calls).toEqual({ image: 1, text: 1 });
  });

  it('upgrades cached features with embeddings once the user opts in', async () => {
    const cache = memoryCache();
    const decode = vi.fn(async () => syntheticImage(5));
    const base = { fetchImage: async () => ({ bytes: bytes('x'), mime: 'image/png' }), decodeGray: decode, hashBytes: sha256Hex, cache };
    const job = { postKey: 'x:1', imageUrl: 'https://pbs.twimg.com/a', text: 'caption long enough for the test' };
    const r = await new FeatureWorker({ ...base, embedder: null }).process(job);
    expect(cache.images.get(r.imageHash!)!.vec).toBeNull();

    const { embedder, calls } = fakeEmbedder();
    await new FeatureWorker({ ...base, embedder }).process(job);
    expect(cache.images.get(r.imageHash!)!.vec).toEqual([0, 1, 0]);
    expect(cache.texts.get(r.textHash!)!.vec).toEqual([1, 0, 0]);
    expect(decode).toHaveBeenCalledTimes(1); // dHash was reused
    expect(calls).toEqual({ image: 1, text: 1 });
  });

  it('reports a failed image without losing the text features', async () => {
    const cache = memoryCache();
    const w = new FeatureWorker({
      fetchImage: async () => { throw new Error('HTTP 403'); },
      decodeGray: async () => syntheticImage(1), hashBytes: sha256Hex, cache, embedder: null,
    });
    const r = await w.process({ postKey: 'x:1', imageUrl: 'https://pbs.twimg.com/a', text: 'text still gets features here' });
    expect(r.error).toMatch(/HTTP 403/);
    expect(r.imageHash).toBeNull();
    expect(r.textHash).toBe(textKey('text still gets features here'));
  });

  it('skips text features for empty captions', async () => {
    const w = new FeatureWorker({ fetchImage: async () => ({ bytes: bytes('x'), mime: 'image/png' }), decodeGray: async () => syntheticImage(1), hashBytes: sha256Hex, cache: memoryCache(), embedder: null });
    expect((await w.process({ postKey: 'x:1', imageUrl: null, text: '   ' })).textHash).toBeNull();
  });
});

describe('model lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('unloads the model after 2 minutes with no work and restarts the clock on use', async () => {
    const unload = vi.fn();
    const u = new IdleUnloader(unload);
    expect(MODEL_IDLE_MS).toBe(120_000);
    u.touch();
    await vi.advanceTimersByTimeAsync(119_000);
    expect(unload).not.toHaveBeenCalled();
    u.touch(); // more work arrives
    await vi.advanceTimersByTimeAsync(119_000);
    expect(unload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents the unload callback', async () => {
    const unload = vi.fn();
    const u = new IdleUnloader(unload, 1000);
    u.touch();
    u.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(unload).not.toHaveBeenCalled();
  });
});

describe('cosine', () => {
  it('is 1 for parallel, 0 for orthogonal, and safe for zero or mismatched vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });
});
