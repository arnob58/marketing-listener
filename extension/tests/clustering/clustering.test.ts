import { describe, expect, it } from 'vitest';
import { addMember, assignPost, mergeInto, newCluster, planMerges, semanticScore, type ClusterState } from '../../src/clustering/cluster';
import { findNearDuplicate, type ComparablePost, type PostFeatures } from '../../src/clustering/dedup';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { minhash } from '../../src/features/minhash';
import { hamming } from '../../src/features/phash';
import { DAY, HOUR, MON, createWorld, handleN, vec } from '../helpers/world';

const T = { ...DEFAULT_SETTINGS.thresholds };
const features = (f: Partial<PostFeatures>): PostFeatures => ({ phash: null, minhash: [], imageVec: null, textVec: null, textChars: 0, ...f });
const cp = (key: string, f: Partial<PostFeatures>, authorKey = `x:${key}`): ComparablePost => ({ key, authorKey, features: features(f) });

/** Flips the first `bits` bits of a 16 hex char hash. */
function flip(hash: string, bits: number): string {
  let n = BigInt(`0x${hash}`);
  for (let i = 0; i < bits; i++) n ^= 1n << BigInt(i * 3);
  return n.toString(16).padStart(16, '0');
}
const HASH = '9f3a5c71e2b4d806';

describe('stage 2: near-duplicates', () => {
  it('matches by perceptual hash within the distance threshold only', () => {
    const near = flip(HASH, 6);
    const far = flip(HASH, 14);
    expect(hamming(HASH, near)).toBe(6);
    const pool = [cp('a', { phash: HASH })];
    expect(findNearDuplicate(features({ phash: near }), pool, T)?.reason).toBe('phash');
    expect(findNearDuplicate(features({ phash: far }), pool, T)).toBeNull();
  });

  it('matches near-identical captions by MinHash but ignores short generic ones', () => {
    const caption = 'we just shipped the redesign everyone asked for this week';
    const edited = `${caption} thanks`;
    const a = cp('a', { minhash: minhash(caption), textChars: caption.length });
    const hit = findNearDuplicate(features({ minhash: minhash(caption), textChars: caption.length }), [a], T);
    expect(hit?.reason).toBe('minhash');
    expect(hit?.score).toBe(1);
    expect(findNearDuplicate(features({ minhash: minhash(edited), textChars: edited.length }), [a], T)).not.toBeNull();

    const short = cp('s', { minhash: minhash('so good'), textChars: 7 });
    expect(findNearDuplicate(features({ minhash: minhash('so good'), textChars: 7 }), [short], T)).toBeNull();
    expect(findNearDuplicate(features({ minhash: minhash('totally different words about cooking pasta tonight'), textChars: 50 }), [a], T)).toBeNull();
  });

  it('never matches on a flat image hash', () => {
    const pool = [cp('a', { phash: '0000000000000000' })];
    expect(findNearDuplicate(features({ phash: '0000000000000000' }), pool, T)).toBeNull();
  });
});

describe('stage 3: semantic assignment (injected vectors)', () => {
  const cluster = (id: string, f: Partial<PostFeatures>): ClusterState => newCluster(id, cp(`m-${id}`, f));

  it('joins the best cluster at or above the image and text thresholds', () => {
    const a = cluster('A', { imageVec: vec(0) });
    const b = cluster('B', { imageVec: vec(1) });
    const hit = assignPost(cp('p', { imageVec: vec(0, 0.3) }), [a, b], T); // cos ~0.96
    expect(hit).toMatchObject({ clusterId: 'A', reason: 'semantic' });
    const miss = assignPost(cp('q', { imageVec: [1, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), [a, b], T); // cos ~0.857 < 0.88
    expect(miss).toMatchObject({ clusterId: null, reason: 'new' });
  });

  it('uses the text threshold (0.80) independently of the image threshold', () => {
    const c = cluster('T', { textVec: vec(2) });
    expect(assignPost(cp('p', { textVec: [0, 0, 1, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), [c], T).clusterId).toBe('T'); // cos 0.82
    expect(assignPost(cp('q', { textVec: [0, 0, 1, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), [c], T).clusterId).toBeNull(); // cos 0.74
  });

  it('lets two near-threshold modalities corroborate each other', () => {
    const c = cluster('X', { imageVec: vec(0), textVec: vec(1) });
    // image cos 0.875 (<0.88) and text cos 0.79 (<0.80): neither passes alone
    const imageNear = [0.875, Math.sqrt(1 - 0.875 ** 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const textNear = [0, 0.79, Math.sqrt(1 - 0.79 ** 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(semanticScore(features({ imageVec: imageNear }), c, T)).toBeLessThan(1);
    expect(semanticScore(features({ textVec: textNear }), c, T)).toBeLessThan(1);
    expect(semanticScore(features({ imageVec: imageNear, textVec: textNear }), c, T)).toBeGreaterThanOrEqual(1);
  });

  it('near-duplicate matching runs before semantic matching and records the variant', () => {
    const a = cluster('A', { phash: HASH, imageVec: vec(4) });
    const b = cluster('B', { imageVec: vec(0) });
    const res = assignPost(cp('p', { phash: flip(HASH, 3), imageVec: vec(0) }), [a, b], T);
    expect(res).toMatchObject({ clusterId: 'A', variantOf: 'm-A', reason: 'near-duplicate' });
  });

  it('updates centroids incrementally and merges converged clusters', () => {
    const a = cluster('A', { textVec: vec(0) });
    addMember(a, cp('m2', { textVec: [0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
    expect(a.nText).toBe(2);
    expect(a.centroidText![0]).toBeCloseTo(0.9, 5);

    const b = cluster('B', { textVec: vec(0, 0.05) });
    const c = cluster('C', { textVec: vec(7) });
    const plans = planMerges([a, b, c], T);
    expect(plans).toEqual([{ keep: 'A', absorb: 'B' }]);
    mergeInto(a, b);
    expect(a.members).toHaveLength(3);
    expect(a.nText).toBe(3);
  });
});

describe('cluster service (storage-backed)', () => {
  it('merges a recompressed repost into the same cluster and adds 0 independent accounts for duplicates by the same author', async () => {
    const w = createWorld();
    await w.addPost({ handle: handleN(1), phash: HASH, textVec: null, firstSeenAt: MON });
    await w.addPost({ handle: handleN(2), phash: flip(HASH, 4), textVec: null, firstSeenAt: MON + HOUR });
    await w.addPost({ handle: handleN(1), phash: flip(HASH, 2), textVec: null, firstSeenAt: MON + 2 * HOUR });
    await w.addPost({ handle: handleN(3), phash: '5a5a5a5a5a5a5a5a', textVec: null, firstSeenAt: MON + 3 * HOUR });

    const clusters = await w.repo.allClusters();
    expect(clusters).toHaveLength(2);
    const sizes = await Promise.all(clusters.map(async (c) => ({ id: c.id, n: (await w.repo.postsInCluster(c.id)).length })));
    const posts = await w.repo.postsInCluster(sizes.find((x) => x.n === 3)!.id);
    expect(posts).toHaveLength(3);
    expect(posts.filter((p) => p.variantOf).length).toBe(2);

    const report = (await w.analysis.report(posts[0].clusterId!, MON + DAY))!;
    expect(report.totalPosts).toBe(3);
    expect(report.independentAccounts).toBe(2); // handleN(1) twice counts once
    expect(report.variants).toBe(2);
  });

  it('puts a quote in the cluster of the post it quotes, as propagation not adoption', async () => {
    const w = createWorld();
    const original = await w.addPost({ handle: handleN(4), textVec: vec(6), firstSeenAt: MON, postId: 'orig' });
    // the quote's own vectors are unrelated; the reference decides the cluster
    await w.addPost({ handle: handleN(5), textVec: vec(11), firstSeenAt: MON + HOUR, kind: 'quote', refKey: original.key });
    const clusters = await w.repo.allClusters();
    expect(clusters).toHaveLength(1);
    const r = (await w.analysis.report(clusters[0].id, MON + DAY))!;
    expect(r.totalPosts).toBe(2);
    expect(r.independentAccounts).toBe(1);
  });

  it('keeps unrelated concepts in separate clusters', async () => {
    const w = createWorld();
    await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON });
    await w.addPost({ handle: handleN(2), textVec: vec(8), firstSeenAt: MON + HOUR });
    expect(await w.repo.allClusters()).toHaveLength(2);
  });

  it('ignores clusters outside the active window', async () => {
    const w = createWorld();
    await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON });
    await w.addPost({ handle: handleN(2), textVec: vec(0), firstSeenAt: MON + 20 * DAY });
    expect(await w.repo.allClusters()).toHaveLength(2);
  });

  it('nightly merge pass joins clusters whose centroids converged and keeps their snapshots', async () => {
    const w = createWorld();
    const a = await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON });
    const b = await w.addPost({ handle: handleN(2), textVec: vec(9), firstSeenAt: MON + HOUR });
    expect(a.clusterId).not.toBe(b.clusterId);
    await w.analysis.snapshotAll(MON + 2 * HOUR);

    // concept drift: the second cluster's centroid now matches the first
    const second = (await w.repo.getCluster(b.clusterId!))!;
    await w.repo.putCluster({ ...second, centroidText: vec(0, 0.02), nText: 1 });
    const merged = await w.cluster.mergePass(MON + 3 * HOUR);

    expect(merged).toBe(1);
    expect(await w.repo.allClusters()).toHaveLength(1);
    const survivor = (await w.repo.allClusters())[0];
    expect(await w.repo.postsInCluster(survivor.id)).toHaveLength(2);
    expect((await w.repo.snapshotsFor(survivor.id)).length).toBeGreaterThanOrEqual(1);
  });
});
