import { describe, expect, it, vi } from 'vitest';
import { FeatureQueue, type FeatureTransport } from '../../src/background/featureQueue';
import { IngestService, REVISIT_MS, toStoredPost } from '../../src/background/ingest';
import { emptyMetrics, parseCount } from '../../src/core/metrics';
import type { ProfileInfo, RawPost } from '../../src/core/types';
import { sha256Hex } from '../../src/core/hash';
import { FeatureWorker } from '../../src/features/worker';
import type { GrayImage } from '../../src/features/phash';
import { MON, createWorld } from '../helpers/world';
import { syntheticImage } from '../helpers/images';

const raw = (over: Partial<RawPost> = {}): RawPost => ({
  platform: 'x',
  postId: '1001',
  url: 'https://x.com/Maple_Fox/status/1001',
  authorHandle: 'Maple_Fox',
  authorName: 'Maple Fox',
  text: 'A caption that is long enough to be matched on its own',
  hashtags: [],
  postedAt: MON,
  imageUrls: ['https://pbs.twimg.com/media/aaa?format=jpg&name=small'],
  hasVideo: false,
  metrics: { ...emptyMetrics(), likes: parseCount('1.2K'), comments: parseCount('45') },
  audio: null,
  surface: 'feed',
  kind: 'original',
  refPostId: null,
  repostedBy: null,
  resolved: { author: true, text: true, timestamp: true, url: true, metrics: true, media: true },
  selectorVersion: 'x-test',
  ...over,
});

function setup() {
  const w = createWorld();
  const notify = vi.fn();
  const ingest = new IngestService(w.repo, { notify });
  const imageBytes = new Map<string, Uint8Array>();
  const stats = { fetched: 0, decoded: 0, embedded: 0, computeCalls: 0, jobs: 0 };

  const worker = new FeatureWorker({
    fetchImage: async (url) => {
      stats.fetched++;
      const bytes = imageBytes.get(url) ?? new TextEncoder().encode(url);
      return { bytes, mime: 'image/jpeg' };
    },
    decodeGray: async (): Promise<GrayImage> => {
      stats.decoded++;
      return syntheticImage(7);
    },
    hashBytes: sha256Hex,
    cache: {
      getImage: (h) => w.repo.getImageFeatures(h),
      putImage: (f) => w.repo.putImageFeatures(f),
      getText: (h) => w.repo.getTextFeatures(h),
      putText: (f) => w.repo.putTextFeatures(f),
    },
    embedder: null,
  });
  const transport: FeatureTransport = {
    compute: async (jobs) => {
      stats.computeCalls++;
      stats.jobs += jobs.length;
      const out = [];
      for (const j of jobs) out.push(await worker.process(j)); // the offscreen document is sequential too
      return out;
    },
  };
  const queue = new FeatureQueue(w.repo, transport, w.cluster, { batchSize: 3, now: () => MON, embeddingsEnabled: () => false });
  return { w, ingest, notify, queue, stats, imageBytes };
}

describe('ingest', () => {
  it('normalizes a raw post for storage', () => {
    const p = toStoredPost(raw(), MON);
    expect(p.key).toBe('x:1001');
    expect(p.authorKey).toBe('x:maple_fox');
    expect(p.engagement.value).toBe(1200 + 90);
    expect(p.engagement.low).toBeLessThan(p.engagement.value);
    expect(p.featureState).toBe('pending');
    expect(toStoredPost(raw({ imageUrls: [], text: '' }), MON).featureState).toBe('done');
  });

  it('a post seen N times yields 1 feature extraction and N-1 metric observations', async () => {
    const { w, ingest, queue, stats } = setup();
    const N = 6;
    const outcomes: string[] = [];
    for (let i = 0; i < N; i++) {
      const now = MON + i * (REVISIT_MS + 60_000);
      outcomes.push(await ingest.ingestPost(raw({ metrics: { ...emptyMetrics(), likes: parseCount(`${i + 1}K`) } }), now));
      await queue.drain();
    }
    expect(outcomes).toEqual(['new', ...Array(N - 1).fill('observation')]);
    expect(stats.jobs).toBe(1);
    expect(stats.fetched).toBe(1);
    expect(stats.decoded).toBe(1);
    expect(await w.repo.countObservations()).toBe(N - 1);
    expect(await w.db.posts.count()).toBe(1);

    const stored = (await w.repo.getPost('x:1001'))!;
    expect(stored.featureState).toBe('done');
    expect(stored.metrics.likes?.value).toBe(6000);
    const obs = await w.repo.observationsFor('x:1001');
    expect(obs.map((o) => o.metrics.likes?.value)).toEqual([2000, 3000, 4000, 5000, 6000]);
  });

  it('sightings inside the revisit window record nothing', async () => {
    const { w, ingest, notify } = setup();
    expect(await ingest.ingestPost(raw(), MON)).toBe('new');
    expect(await ingest.ingestPost(raw(), MON + 60_000)).toBe('ignored');
    expect(await ingest.ingestPost(raw(), MON + REVISIT_MS - 1)).toBe('ignored');
    expect(await w.repo.countObservations()).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('reuses features for identical images cross-posted under different post ids', async () => {
    const { ingest, queue, stats, w } = setup();
    await ingest.ingestPost(raw({ postId: '1', url: 'https://x.com/a/status/1', authorHandle: 'a1' }), MON);
    await ingest.ingestPost(raw({ postId: '2', url: 'https://x.com/b/status/2', authorHandle: 'b2' }), MON);
    await queue.drain();
    expect(stats.jobs).toBe(2); // two posts are processed...
    expect(stats.decoded).toBe(1); // ...but the identical image is decoded once
    const [p1, p2] = await Promise.all([w.repo.getPost('x:1'), w.repo.getPost('x:2')]);
    expect(p1!.imageHash).toBe(p2!.imageHash);
  });

  it('merges reposters onto the original without a new observation', async () => {
    const { ingest, w } = setup();
    await ingest.ingestPost(raw(), MON);
    await ingest.ingestPost(raw({ repostedBy: 'gridlock_news' }), MON + 1000);
    await ingest.ingestPost(raw({ repostedBy: 'gridlock_news' }), MON + 2000);
    expect((await w.repo.getPost('x:1001'))!.repostedBy).toEqual(['gridlock_news']);
    expect(await w.repo.countObservations()).toBe(0);
  });

  it('records extraction health per field', async () => {
    const { ingest, w } = setup();
    await ingest.ingestPost(raw(), MON);
    await ingest.ingestPost(raw({ postId: '2', resolved: { author: true, text: false, timestamp: true, url: true, metrics: true, media: true } }), MON);
    const [h] = await w.repo.allHealth();
    expect(h).toMatchObject({ platform: 'x', selectorVersion: 'x-test', posts: 2, author: 2, text: 1 });
  });

  it('profile ingest never replaces known follower counts with unknowns', async () => {
    const { ingest, w } = setup();
    await ingest.ingestPost(raw(), MON);
    const profile: ProfileInfo = { platform: 'x', handle: 'Maple_Fox', displayName: 'Maple Fox', followers: parseCount('48.5K'), verified: true };
    await ingest.ingestProfile(profile, MON + 1);
    await ingest.ingestPost(raw({ postId: '9', url: 'https://x.com/Maple_Fox/status/9' }), MON + 2);
    await ingest.ingestProfile({ ...profile, followers: null, verified: false }, MON + 3);
    const acc = (await w.repo.getAccount('x:maple_fox'))!;
    expect(acc.followers?.value).toBe(48500);
    expect(acc.verified).toBe(true);
  });

  it('marks a post failed (not retried forever) when the transport fails entirely', async () => {
    const { ingest, w } = setup();
    await ingest.ingestPost(raw(), MON);
    const failing = new FeatureQueue(w.repo, { compute: async () => { throw new Error('offscreen gone'); } }, w.cluster, {
      batchSize: 3, now: () => MON, embeddingsEnabled: () => false,
    });
    await failing.drain();
    const p = (await w.repo.getPost('x:1001'))!;
    expect(p.featureState).toBe('failed');
    expect(p.clusterId).not.toBeNull(); // still clustered on whatever text features exist
  });
});
