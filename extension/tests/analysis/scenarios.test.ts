import { describe, expect, it } from 'vitest';
import { baselineExcluding, computeBaseline } from '../../src/analysis/baseline';
import { classifyCluster } from '../../src/analysis/attribution';
import { evaluateCluster } from '../../src/analysis/evaluate';
import { independentAccounts, familyKey } from '../../src/analysis/independence';
import type { AccountInfo, AnalysisPost, ClusterInput, HistoryPoint } from '../../src/analysis/types';
import { exact, logEngagement, parseCount } from '../../src/core/metrics';
import { DAY, HOUR, MON, createWorld, handleN, vec } from '../helpers/world';

function analysisPost(o: Partial<AnalysisPost> & { handle: string }): AnalysisPost {
  const platform = o.platform ?? 'x';
  return {
    key: `${platform}:${o.handle}-${Math.random().toString(36).slice(2, 8)}`,
    platform,
    authorKey: `${platform}:${o.handle}`,
    authorHandle: o.handle,
    engagement: exact(100),
    postedAt: null,
    firstSeenAt: MON,
    lastSeenAt: MON,
    kind: 'original',
    refKey: null,
    variantOf: null,
    repostedBy: [],
    ...o,
  };
}

/** n prior posts around a typical engagement, with mild natural spread. */
function history(authorKey: string, n: number, typical: number): HistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${authorKey}-h${i}`,
    logE: logEngagement(exact(typical * (0.85 + 0.3 * ((i * 7) % 10) / 9))),
  }));
}

function input(posts: AnalysisPost[], accounts: Record<string, AccountInfo> = {}, hist: Record<string, HistoryPoint[]> = {}): ClusterInput {
  return {
    clusterId: 'c',
    posts,
    accounts: new Map(Object.entries(accounts)),
    history: new Map(Object.entries(hist)),
  };
}

describe('S1: three unrelated accounts, same concept', () => {
  it('forms one cluster and reads as content-driven citing independent adoption', async () => {
    const w = createWorld();
    const conceptA = [vec(0, 0.0), vec(0, 0.12), vec(0, -0.1)];
    const engagement = ['8K', '12K', '6.5K'].map((s) => parseCount(s)!);
    for (let i = 0; i < 3; i++) {
      await w.addPost({ handle: handleN(i), textVec: conceptA[i], engagement: engagement[i], firstSeenAt: MON + i * HOUR });
    }
    // unrelated concept must not join
    await w.addPost({ handle: handleN(9), textVec: vec(5), engagement: 300, firstSeenAt: MON + 4 * HOUR });

    const clusters = await w.repo.allClusters();
    expect(clusters).toHaveLength(2);
    const main = (await Promise.all(clusters.map((c) => w.analysis.report(c.id, MON + DAY)))).find((r) => r!.totalPosts === 3)!;

    expect(main.independentAccounts).toBe(3);
    expect(main.kind).toBe('trend');
    expect(main.classification.label).toBe('Likely content-driven');
    const adoption = main.classification.evidence.find((e) => e.signal === 'adoption' && e.direction === 'content');
    expect(adoption?.text).toMatch(/3 independent accounts/);
    expect(main.classification.confidence).toBeLessThan(1);
  });
});

describe('S2: brand vs small account', () => {
  const brandKey = 'x:acmebrandhq';
  const smallKey = 'x:tinyindie';

  const brand = () =>
    classifyCluster(
      input(
        [analysisPost({ handle: 'acmebrandhq', engagement: exact(50_000) })],
        { [brandKey]: { followers: exact(2_000_000), verified: true } },
        { [brandKey]: history(brandKey, 20, 50_000) },
      ),
    );
  const small = () =>
    classifyCluster(
      input(
        [analysisPost({ handle: 'tinyindie', engagement: exact(8_000) })],
        { [smallKey]: { followers: exact(300), verified: false } },
        { [smallKey]: history(smallKey, 20, 100) },
      ),
    );

  it('labels a brand post in line with its baseline and no adoption as publisher-driven', () => {
    const c = brand();
    expect(c.label).toBe('Likely publisher-driven');
    expect(c.confidence).toBeLessThan(1);
    expect(c.confidence).toBeLessThanOrEqual(0.9);
    expect(c.score).toBeGreaterThan(0.02);
  });

  it('labels a small account far above its baseline as content-driven', () => {
    const c = small();
    expect(c.label).toBe('Likely content-driven');
    expect(c.confidence).toBeLessThan(1);
  });

  it('scores the small account higher on content-driven than the brand', () => {
    expect(small().score).toBeGreaterThan(brand().score);
  });

  it('never uses certain language', () => {
    for (const c of [brand(), small()]) {
      expect(c.summary).toMatch(/evidence suggests/i);
      expect(c.summary).not.toMatch(/\bdefinitely|certainly|proven\b/i);
    }
  });
});

describe('S3: same concept on three platforms', () => {
  it('forms one cluster with a per-platform breakdown', async () => {
    const w = createWorld();
    const platforms = ['x', 'instagram', 'facebook'] as const;
    for (let i = 0; i < 3; i++) {
      await w.addPost({ platform: platforms[i], handle: handleN(i + 3), textVec: vec(2, 0.05 * i), engagement: 1500 + i * 200, firstSeenAt: MON + i * HOUR });
    }
    const clusters = await w.repo.allClusters();
    expect(clusters).toHaveLength(1);
    const r = (await w.analysis.report(clusters[0].id, MON + DAY))!;
    expect(r.platforms.sort()).toEqual(['facebook', 'instagram', 'x']);
    expect(r.perPlatform).toHaveLength(3);
    expect(r.perPlatform.every((p) => p.posts === 1 && p.accounts === 1)).toBe(true);
    expect(r.classification.evidence.some((e) => e.signal === 'crossPlatform')).toBe(true);
  });
});

describe('S4: lifecycle over three days with snapshots', () => {
  it('Monday Emerging, Tuesday Accelerating, Wednesday multi-platform; snapshots are preserved', async () => {
    const w = createWorld();
    const concept = (n: number) => vec(3, 0.02 * (n % 5));
    let n = 0;
    const add = (offset: number, platform: 'x' | 'instagram' | 'facebook' = 'x') =>
      w.addPost({ platform, handle: handleN(n), textVec: concept(n++), engagement: 900 + n * 10, firstSeenAt: offset });

    // Monday: 5 accounts
    for (let i = 0; i < 5; i++) await add(MON + 8 * HOUR + i * HOUR);
    const monEnd = MON + 23 * HOUR;
    const [cluster] = await w.repo.allClusters();
    const mon = (await w.analysis.report(cluster.id, monEnd))!;
    expect(mon.independentAccounts).toBe(5);
    expect(mon.lifecycle.stage).toBe('Emerging');
    await w.analysis.snapshotAll(monEnd);

    // Tuesday: +20 accounts
    for (let i = 0; i < 20; i++) await add(MON + DAY + 8 * HOUR + i * 30 * 60_000);
    const tueEnd = MON + DAY + 23 * HOUR;
    const tue = (await w.analysis.report(cluster.id, tueEnd))!;
    expect(tue.independentAccounts).toBe(25);
    expect(tue.lifecycle.stage).toBe('Accelerating');
    await w.analysis.snapshotAll(tueEnd);

    // Wednesday: spreads to other platforms
    for (let i = 0; i < 6; i++) await add(MON + 2 * DAY + 8 * HOUR + i * HOUR, i % 2 ? 'instagram' : 'facebook');
    const wedEnd = MON + 2 * DAY + 23 * HOUR;
    const wed = (await w.analysis.report(cluster.id, wedEnd))!;
    expect(wed.platforms.length).toBe(3);
    expect(wed.independentAccounts).toBe(31);
    await w.analysis.snapshotAll(wedEnd);

    expect(await w.repo.allClusters()).toHaveLength(1);
    const snaps = await w.repo.snapshotsFor(cluster.id);
    expect(snaps.map((s) => s.accounts)).toEqual([5, 25, 31]);
    expect(snaps.map((s) => s.day)).toEqual(['2025-03-10', '2025-03-11', '2025-03-12']);
    expect(snaps[2].platforms.length).toBe(3);

    // re-snapshotting the same day overwrites only that day
    await w.analysis.snapshotAll(wedEnd + 30 * 60_000);
    expect((await w.repo.snapshotsFor(cluster.id)).map((s) => s.accounts)).toEqual([5, 25, 31]);
  });

  it('turns Declining after 72h without sightings or two shrinking windows', () => {
    const posts = Array.from({ length: 6 }, (_, i) =>
      analysisPost({ handle: handleN(i), firstSeenAt: MON + i * HOUR, lastSeenAt: MON + i * HOUR }),
    );
    const stale = evaluateCluster(input(posts), MON + 5 * DAY);
    expect(stale.lifecycle.stage).toBe('Declining');

    // windows: 12 (oldest), 6, 2 -> ratios 0.5 and 0.33
    const falling: AnalysisPost[] = [];
    const add = (count: number, base: number) => {
      for (let i = 0; i < count; i++) {
        const t = base + i * 1000;
        falling.push(analysisPost({ handle: handleN(falling.length), firstSeenAt: t, lastSeenAt: t }));
      }
    };
    const now = MON + 3 * DAY;
    add(12, now - 2 * DAY - 12 * HOUR);
    add(6, now - DAY - 12 * HOUR);
    add(2, now - 12 * HOUR);
    expect(evaluateCluster(input(falling), now).lifecycle.stage).toBe('Declining');
  });

  it('reaches Established with steady growth over three or more days', () => {
    const now = MON + 4 * DAY;
    const posts: AnalysisPost[] = [];
    for (let d = 0; d < 4; d++) {
      for (let i = 0; i < 4; i++) {
        const t = now - (d + 1) * DAY + 6 * HOUR + i * HOUR;
        posts.push(analysisPost({ handle: handleN(posts.length), firstSeenAt: t, lastSeenAt: t + 20 * HOUR }));
      }
    }
    const r = evaluateCluster(input(posts), now);
    expect(r.lifecycle.stage).toBe('Established');
    expect(r.lifecycle.duration).toBe('sustained');
  });
});

describe('missing baseline', () => {
  const key = 'x:acmebrandhq';
  const make = (withHistory: boolean) =>
    classifyCluster(
      input(
        [analysisPost({ handle: 'acmebrandhq', engagement: exact(50_000) })],
        { [key]: { followers: exact(2_000_000), verified: true } },
        withHistory ? { [key]: history(key, 20, 50_000) } : { [key]: history(key, 2, 50_000) },
      ),
    );

  it('lowers confidence and lists "baseline unknown" when an account has under five sampled posts', () => {
    const known = make(true);
    const unknown = make(false);
    expect(unknown.confidence).toBeLessThan(known.confidence);
    expect(unknown.missingData.some((m) => m.startsWith('baseline unknown'))).toBe(true);
    expect(known.missingData.some((m) => m.startsWith('baseline unknown'))).toBe(false);
  });

  it('excludes the judged post from its own baseline', () => {
    const pts = history(key, 5, 100);
    expect(baselineExcluding(pts, pts[0].key, 5).baseline).toBeNull(); // 4 remain
    expect(baselineExcluding(pts, 'other', 5).baseline?.n).toBe(5);
  });

  it('uses median and scaled MAD of log-engagement with a floor', () => {
    const b = computeBaseline([4, 4, 4, 4, 4], 5)!;
    expect(b.median).toBe(4);
    expect(b.mad).toBeGreaterThan(0);
    expect(computeBaseline([1, 2], 5)).toBeNull();
  });
});

describe('independent accounts', () => {
  it('counts one per distinct author; duplicate posts by the same account add 0', () => {
    const a = analysisPost({ handle: 'mapleoakfox', firstSeenAt: MON });
    const dupes = [a, analysisPost({ handle: 'mapleoakfox', firstSeenAt: MON + HOUR, variantOf: a.key }), analysisPost({ handle: 'mapleoakfox', firstSeenAt: MON + 2 * HOUR })];
    const other = analysisPost({ handle: 'zenithradio', firstSeenAt: MON });
    expect(independentAccounts(dupes).accounts).toHaveLength(1);
    expect(independentAccounts([...dupes, other]).accounts).toHaveLength(2);
  });

  it('does not count reposts, quotes or brand-name families as independent', () => {
    const orig = analysisPost({ handle: 'zenithradio', repostedBy: ['x:someonelse'] });
    const quote = analysisPost({ handle: 'quillwright', kind: 'quote', refKey: orig.key });
    const family = [analysisPost({ handle: 'acme' }), analysisPost({ handle: 'acme_news' }), analysisPost({ handle: 'AcmeOfficial' })];
    const r = independentAccounts([orig, quote, ...family]);
    expect(r.accounts).toHaveLength(2); // zenithradio + the acme family
    expect(r.propagation).toContain('x:quillwright');
    expect(familyKey('Acme_Official')).toBe('acme');
  });

  it('keeps clearly different handles apart', () => {
    const posts = ['mapleoakfox', 'zenithradio', 'quillwright'].map((h) => analysisPost({ handle: h }));
    expect(independentAccounts(posts).accounts).toHaveLength(3);
  });
});
