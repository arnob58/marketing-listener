import { describe, expect, it, vi } from 'vitest';
import { FeatureQueue } from '../../src/background/featureQueue';
import { IngestService } from '../../src/background/ingest';
import { createRouter } from '../../src/background/router';
import { runDailyMaintenance } from '../../src/background/scheduler';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/core/settings';
import { emptyMetrics, parseCount } from '../../src/core/metrics';
import type { RawPost } from '../../src/core/types';
import { EXPORT_NOTES, buildExportBundle, toCsv } from '../../src/export/export';
import { DAY, HOUR, MON, createWorld, handleN, vec } from '../helpers/world';

const rawPost = (i: number): RawPost => ({
  platform: 'x', postId: `${i}`, url: `https://x.com/${handleN(i)}/status/${i}`, authorHandle: handleN(i), authorName: null,
  text: `tweet number ${i} with enough words to count as a caption`, hashtags: [], postedAt: MON, imageUrls: [], hasVideo: false,
  metrics: { ...emptyMetrics(), likes: parseCount('1.2K') }, audio: null, surface: 'feed', kind: 'original', refPostId: null, repostedBy: null,
  resolved: { author: true, text: true, timestamp: true, url: true, metrics: true, media: true }, selectorVersion: 'x-test',
});

function routerFor(w: ReturnType<typeof createWorld>, now = MON + HOUR) {
  const queue = new FeatureQueue(w.repo, { compute: async (jobs) => jobs.map((j) => ({ postKey: j.postKey, imageHash: null, textHash: null })) }, w.cluster, {
    batchSize: 3, now: () => now, embeddingsEnabled: () => false,
  });
  const ingest = new IngestService(w.repo, { notify: () => {} });
  let settings = DEFAULT_SETTINGS;
  return createRouter({
    repo: w.repo, ingest, analysis: w.analysis, queue, now: () => now,
    loadSettings: async () => settings,
    saveSettings: async (patch) => (settings = mergeSettings({ ...settings, ...patch })),
  });
}

describe('router', () => {
  it('ingests posts from content scripts and serves stats, reports and cluster details', async () => {
    const w = createWorld();
    const router = routerFor(w);
    await router.handleContent({ type: 'posts', posts: [rawPost(1), rawPost(2)] });
    await router.drain();

    const stats = await router.handleUi({ type: 'ui:stats' });
    expect(stats).toMatchObject({ posts: 2, pendingFeatures: 0 });
    const reports = await router.handleUi({ type: 'ui:reports' });
    expect(reports.length).toBeGreaterThan(0);
    const detail = await router.handleUi({ type: 'ui:cluster', id: reports[0].clusterId });
    expect(detail?.posts.length).toBeGreaterThan(0);
    expect(await router.handleUi({ type: 'ui:cluster', id: 'missing' })).toBeNull();
  });

  it('saves settings through the same clamps as everywhere else', async () => {
    const router = routerFor(createWorld());
    const s = await router.handleUi({ type: 'ui:saveSettings', patch: { scan: { maxPosts: 5000, intervalMs: 3000, maxMs: 60_000 } } });
    expect(s.scan.maxPosts).toBe(200);
  });

  it('purges everything on request', async () => {
    const w = createWorld();
    const router = routerFor(w);
    await router.handleContent({ type: 'posts', posts: [rawPost(1)] });
    await router.drain();
    await router.handleUi({ type: 'ui:purgeAll' });
    expect(await w.db.posts.count()).toBe(0);
    expect(await w.db.clusters.count()).toBe(0);
    expect(await w.db.health.count()).toBe(0);
  });
});

describe('daily maintenance', () => {
  it('snapshots clusters, merges converged ones and applies retention', async () => {
    const w = createWorld();
    await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON });
    await w.addPost({ handle: handleN(2), textVec: vec(0, 0.05), firstSeenAt: MON + HOUR });
    const old = await w.addPost({ handle: handleN(3), textVec: vec(7), firstSeenAt: MON - 120 * DAY });

    const res = await runDailyMaintenance({ repo: w.repo, cluster: w.cluster, analysis: w.analysis, retentionDays: async () => 90 }, MON + 2 * HOUR);
    expect(res.purged).toBe(1);
    expect(await w.repo.getPost(old.key)).toBeUndefined();
    expect(await w.repo.getCluster(old.clusterId!)).toBeUndefined(); // empty cluster removed with its snapshots
    expect(res.snapshots).toBeGreaterThanOrEqual(1);
    expect((await w.repo.allSnapshots()).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps history inside the retention window', async () => {
    const w = createWorld();
    await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON - 30 * DAY });
    const res = await runDailyMaintenance({ repo: w.repo, cluster: w.cluster, analysis: w.analysis, retentionDays: async () => 90 }, MON);
    expect(res.purged).toBe(0);
    expect(await w.db.posts.count()).toBe(1);
  });
});

describe('export', () => {
  it('builds a bundle with trends, cluster posts and accounts, and the limitation notes', async () => {
    const w = createWorld();
    for (let i = 0; i < 3; i++) await w.addPost({ handle: handleN(i), textVec: vec(1, 0.03 * i), engagement: parseCount('1.2K')!, firstSeenAt: MON + i * HOUR, followers: 500 * (i + 1) });
    const now = MON + DAY;
    const bundle = buildExportBundle({ reports: await w.analysis.allReports(now), posts: await w.repo.allPosts(), accounts: await w.repo.allAccounts(), now });

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.notes).toEqual(EXPORT_NOTES);
    expect(bundle.trends).toHaveLength(1);
    expect(bundle.trends[0]).toMatchObject({ kind: 'trend', independentAccounts: 3, platforms: 'x' });
    expect(bundle.trends[0].attribution).toMatch(/content|Mixed|Insufficient|publisher/);
    expect(bundle.trends[0].evidence.length).toBeGreaterThan(0);
    expect(bundle.trends[0].leadPostUrl).toMatch(/^https:\/\//);
    expect(bundle.posts).toHaveLength(3);
    expect(bundle.posts[0]).toHaveProperty('engagementLow');
    expect(bundle.accounts.map((a) => Number(a.followers)).sort((a, b) => a - b)).toEqual([500, 1000, 1500]);
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });

  it('CSV quotes properly and neutralizes spreadsheet formulas', () => {
    const csv = toCsv([{ a: 'plain', b: 'has, comma', c: 'say "hi"', d: '=HYPERLINK("x")', e: -5, f: '+cmd' }]);
    const [head, row] = csv.split('\r\n');
    expect(head).toBe('a,b,c,d,e,f');
    expect(row).toBe('plain,"has, comma","say ""hi""","\'=HYPERLINK(""x"")",-5,\'+cmd');
    expect(toCsv([])).toBe('');
  });

  it('settings clamps keep every threshold in a safe range', () => {
    const s = mergeSettings({ thresholds: { ...DEFAULT_SETTINGS.thresholds, imageSimilarity: 5, minTrendAccounts: 0, dhashMaxDistance: 999 }, retentionDays: -4 } as never);
    expect(s.thresholds.imageSimilarity).toBe(1);
    expect(s.thresholds.minTrendAccounts).toBe(2);
    expect(s.thresholds.dhashMaxDistance).toBe(32);
    expect(s.retentionDays).toBe(1);
    expect(s.modelOptIn).toBe(false);
  });
});

describe('model opt-in', () => {
  it('embeddings are requested from the offscreen document only when enabled', async () => {
    const w = createWorld();
    const compute = vi.fn(async (jobs: Array<{ postKey: string }>, _o: { embeddings: boolean }) => jobs.map((j) => ({ postKey: j.postKey, imageHash: null, textHash: null })));
    const ingest = new IngestService(w.repo, { notify: () => {} });
    await ingest.ingestPost(rawPost(1), MON);
    for (const enabled of [false, true]) {
      await w.repo.patchPost('x:1', { featureState: 'pending' });
      await new FeatureQueue(w.repo, { compute }, w.cluster, { batchSize: 3, now: () => MON, embeddingsEnabled: () => enabled }).drain();
    }
    expect(compute.mock.calls.map((c) => c[1].embeddings)).toEqual([false, true]);
  });
});
