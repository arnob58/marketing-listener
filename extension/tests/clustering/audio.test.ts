import { describe, expect, it } from 'vitest';
import { assignPost, newCluster } from '../../src/clustering/cluster';
import { findSharedAudio, type ComparablePost, type PostFeatures } from '../../src/clustering/dedup';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { HOUR, MON, createWorld, handleN } from '../helpers/world';

const T = { ...DEFAULT_SETTINGS.thresholds };
const cp = (key: string, authorKey: string, audioId: string | null): ComparablePost => ({
  key,
  authorKey,
  features: { phash: null, minhash: [], imageVec: null, textVec: null, textChars: 0, audioId } satisfies PostFeatures,
});

describe('audio matching', () => {
  it('matches the same sound used by a different account only', () => {
    const pool = [cp('a', 'instagram:alice', 'aud1')];
    expect(findSharedAudio(cp('b', 'instagram:bob', 'aud1'), pool)?.key).toBe('a');
    expect(findSharedAudio(cp('c', 'instagram:alice', 'aud1'), pool)).toBeNull(); // same account re-using its own sound
    expect(findSharedAudio(cp('d', 'instagram:bob', 'aud2'), pool)).toBeNull();
    expect(findSharedAudio(cp('e', 'instagram:bob', null), [cp('f', 'instagram:x', null)])).toBeNull();
  });

  it('assigns by audio before semantic similarity, with its own reason', () => {
    const c = newCluster('A', cp('m', 'instagram:alice', 'aud1'));
    expect(assignPost(cp('p', 'instagram:bob', 'aud1'), [c], T)).toMatchObject({ clusterId: 'A', reason: 'audio', variantOf: null });
  });
});

describe('audio clustering end to end', () => {
  const sound = { id: '9001', title: 'Summer Loop', isOriginal: false };
  const original = { id: '777', title: 'Original audio', isOriginal: true };
  const add = (w: ReturnType<typeof createWorld>, i: number, audio: typeof sound | null, handle = handleN(i)) =>
    w.addPost({ platform: 'instagram', handle, audio, firstSeenAt: MON + i * HOUR });

  it('3 accounts using the same audio id form 1 cluster with "3 independent accounts used this sound"', async () => {
    const w = createWorld();
    for (const i of [1, 2, 3]) await add(w, i, sound);
    const stored = await w.repo.allPosts();
    const ids = new Set(stored.map((p) => p.clusterId));
    expect(ids.size).toBe(1);

    const report = (await w.analysis.allReports(MON + 5 * HOUR))[0];
    expect(report.independentAccounts).toBe(3);
    const audioEvidence = report.classification.evidence.filter((e) => e.signal === 'audio');
    expect(audioEvidence).toHaveLength(1);
    expect(audioEvidence[0].text).toContain('3 independent accounts used this sound');
    expect(audioEvidence[0].direction).toBe('content');
  });

  it('keeps unrelated sounds apart', async () => {
    const w = createWorld();
    await add(w, 1, sound);
    await add(w, 2, { ...sound, id: '1234' });
    expect(new Set((await w.repo.allPosts()).map((p) => p.clusterId)).size).toBe(2);
  });

  it("an owner's original audio, used only by the owner, does not group anything", async () => {
    const w = createWorld();
    const owner = handleN(4);
    await add(w, 1, original, owner);
    await add(w, 2, original, owner);
    await add(w, 3, original, owner);
    const stored = await w.repo.allPosts();
    expect(new Set(stored.map((p) => p.clusterId)).size).toBe(3);
    for (const r of await w.analysis.allReports(MON + 5 * HOUR)) {
      expect(r.classification.evidence.some((e) => e.signal === 'audio')).toBe(false);
    }
  });

  it('original audio re-used by other accounts does group, counting the other accounts too', async () => {
    const w = createWorld();
    await add(w, 1, original);
    await add(w, 2, original);
    expect(new Set((await w.repo.allPosts()).map((p) => p.clusterId)).size).toBe(1);
  });
});
