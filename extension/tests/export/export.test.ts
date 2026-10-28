import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_MAX, EXPORT_SCHEMA_VERSION, buildExportBundle, toCsv, type ExportBundle } from '../../src/export/export';
import { parseCount } from '../../src/core/metrics';
import { HOUR, DAY, MON, createWorld, handleN, vec } from '../helpers/world';

async function seededBundle() {
  const w = createWorld();
  const sound = { id: '9001', title: 'Summer Loop', isOriginal: false };
  const specs = [
    { i: 1, text: 'first caption #dance #summer', tags: ['dance', 'summer'], likes: '12K', comments: '45', views: '1.2M', audio: sound, media: ['https://scontent.cdninstagram.com/a.jpg'] },
    { i: 2, text: 'second caption #dance', tags: ['dance'], likes: '800', comments: null, views: null, audio: sound, media: [] },
    { i: 3, text: 'x'.repeat(400), tags: ['summer', 'dance', 'fun'], likes: '3', comments: null, views: null, audio: sound, media: [] },
  ];
  for (const s of specs) {
    const p = await w.addPost({ platform: 'instagram', handle: handleN(s.i), textVec: vec(1, 0.02 * s.i), firstSeenAt: MON + s.i * HOUR, audio: s.audio });
    await w.repo.patchPost(p.key, {
      text: s.text, hashtags: s.tags, imageUrls: s.media, hasVideo: s.i === 1, postedAt: MON - s.i * DAY, surface: 'feed',
      metrics: { likes: parseCount(s.likes), comments: parseCount(s.comments), shares: null, views: parseCount(s.views) },
      engagement: parseCount(s.likes)!,
    });
  }
  const now = MON + DAY;
  const bundle = buildExportBundle({ reports: await w.analysis.allReports(now), posts: await w.repo.allPosts(), accounts: await w.repo.allAccounts(), now });
  return { bundle, posts: await w.repo.allPosts() };
}

describe('export schema v2', () => {
  it('has schema version 2 with posts instead of clusters, and the expiring-media note', async () => {
    const { bundle } = await seededBundle();
    expect(EXPORT_SCHEMA_VERSION).toBe(2);
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle).not.toHaveProperty('clusters');
    expect(bundle.posts).toHaveLength(3);
    expect(bundle.notes.join(' ')).toMatch(/media URLs.*expire.*post URLs are stable/i);
  });

  it('carries caption, hashtags, post time, per-metric counts, media URLs and audio on every post', async () => {
    const { bundle } = await seededBundle();
    const first = bundle.posts.find((p) => p.text.startsWith('first caption'))!;
    expect(first).toMatchObject({
      platform: 'instagram', surface: 'feed', hashtags: ['dance', 'summer'], hasVideo: true,
      mediaUrls: ['https://scontent.cdninstagram.com/a.jpg'], audioTitle: 'Summer Loop', audioId: '9001',
      likes: 12_000, comments: 45, shares: '', views: 1_200_000,
    });
    expect(first.postedAt).toBe(new Date(MON - DAY).toISOString());
    // Low/high only appear when the platform abbreviated the count.
    expect(first.likesLow).toBeLessThan(12_000);
    expect(first.likesHigh).toBeGreaterThan(12_000);
    expect(first.commentsLow).toBe('');
    expect(first.commentsHigh).toBe('');
    expect(first.sharesLow).toBe('');
    const second = bundle.posts.find((p) => p.text.startsWith('second'))!;
    expect(second).toMatchObject({ likes: 800, likesLow: '', likesHigh: '', comments: '', views: '' });
  });

  it('gives each trend row its lead caption (<=280 chars), top hashtags (<=5, by frequency), sound and every post link', async () => {
    const { bundle, posts } = await seededBundle();
    expect(bundle.trends).toHaveLength(1);
    const t = bundle.trends[0];
    expect(t.representativeCaption).toMatch(/^first caption/); // highest engagement (12K)
    expect(t.topHashtags).toEqual(['dance', 'summer', 'fun']);
    expect(t.audioTitle).toBe('Summer Loop');
    expect([...t.postUrls].sort()).toEqual(posts.map((p) => p.url).sort());
    expect(t.leadPostUrl).toBe(posts.find((p) => p.text.startsWith('first'))!.url);
  });

  it('truncates a long lead caption to 280 characters', async () => {
    const w = createWorld();
    const p = await w.addPost({ handle: handleN(1), textVec: vec(1), firstSeenAt: MON });
    await w.repo.patchPost(p.key, { text: 'y'.repeat(900) });
    const bundle = buildExportBundle({ reports: await w.analysis.allReports(MON + HOUR), posts: await w.repo.allPosts(), accounts: [], now: MON + HOUR });
    expect(bundle.trends[0].representativeCaption).toHaveLength(CAPTION_MAX);
  });

  it('survives JSON and joins list fields in CSV; thumbnails are not part of the bundle', async () => {
    const { bundle } = await seededBundle();
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
    expect(bundle.posts.every((p) => !Object.keys(p).some((k) => /thumb/i.test(k)))).toBe(true);
    const csv = toCsv(bundle.posts);
    expect(csv.split('\r\n')[0]).toContain('hashtags');
    expect(csv).toContain('dance | summer');
  });
});

const PROJECT = join(__dirname, '..', '..', '..');
const TOOL = join(PROJECT, 'tools', 'export_to_sheets.py');
const OUT = join(PROJECT, '.tmp', 'test-export');

function python(): string | null {
  for (const cmd of ['python', 'py', 'python3']) if (spawnSync(cmd, ['--version']).status === 0) return cmd;
  return null;
}
const PY = python();

describe.skipIf(!PY)('tools/export_to_sheets.py --dry-run', () => {
  const dry = (name: string, bundle: unknown) => {
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, name);
    writeFileSync(file, JSON.stringify(bundle));
    return spawnSync(PY!, ['-I', TOOL, file, '--dry-run'], { encoding: 'utf-8' });
  };

  it('reads a v2 export and reports the Posts tab with the new columns', async () => {
    const { bundle } = await seededBundle();
    const r = dry('v2.json', bundle);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Posts: 3 rows');
    expect(r.stdout).toContain(`x ${Object.keys(bundle.posts[0]).length} columns`);
    expect(r.stdout).toContain(`Trends: 1 rows x ${Object.keys(bundle.trends[0]).length} columns`);
    expect(r.stdout).toContain('Dry run: nothing was sent.');
  });

  it('still reads a v1 export (clusters tab) unchanged', () => {
    const v1 = {
      schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', notes: ['n'],
      trends: [{ clusterId: 'c', kind: 'trend' }], clusters: [{ clusterId: 'c', postKey: 'x:1' }, { clusterId: 'c', postKey: 'x:2' }], accounts: [],
    };
    const r = dry('v1.json', v1);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Clusters: 2 rows x 2 columns');
  });

  it('rejects an unknown version, and a v2 file missing posts', () => {
    expect(dry('v3.json', { schemaVersion: 3, trends: [], posts: [], accounts: [] }).status).toBe(2);
    const bad = dry('v2-bad.json', { schemaVersion: 2, trends: [], clusters: [], accounts: [] });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("'posts'");
  });

  it('keeps every column even when the first row lacks a key later rows have', () => {
    const bundle: Partial<ExportBundle> = { schemaVersion: 2, generatedAt: 'x', notes: [], trends: [], accounts: [], posts: [{ a: 1 }, { a: 2, b: ['u', 'v'] }] as never };
    expect(dry('cols.json', bundle).stdout).toContain('Posts: 2 rows x 2 columns');
  });
});
