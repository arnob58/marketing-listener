import { describe, expect, it } from 'vitest';
import { classifyCluster } from '../../src/analysis/attribution';
import type { AnalysisPost, ClusterInput } from '../../src/analysis/types';
import { exact, logEngagement, parseCount } from '../../src/core/metrics';
import type { Metric } from '../../src/core/types';
import { MON } from '../helpers/world';

const post = (handle: string, engagement: Metric, platform: 'x' | 'instagram' | 'facebook' = 'x'): AnalysisPost => ({
  key: `${platform}:${handle}`,
  platform,
  authorKey: `${platform}:${handle}`,
  authorHandle: handle,
  engagement,
  postedAt: null,
  firstSeenAt: MON,
  lastSeenAt: MON,
  kind: 'original',
  refKey: null,
  variantOf: null,
  repostedBy: [],
});

const hist = (key: string, n: number, v: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `${key}-${i}`, logE: logEngagement(exact(v * (0.9 + 0.02 * i))) }));

const CASES: Record<string, ClusterInput> = {
  'three accounts, no baselines': {
    clusterId: 'a',
    posts: [post('mapleoakfox', parseCount('8K')!), post('zenithradio', parseCount('12K')!), post('quillwright', parseCount('6.5K')!)],
    accounts: new Map(),
    history: new Map(),
  },
  'brand with baseline': {
    clusterId: 'b',
    posts: [post('acmebrandhq', exact(50_000))],
    accounts: new Map([['x:acmebrandhq', { followers: exact(2e6), verified: true }]]),
    history: new Map([['x:acmebrandhq', hist('x:acmebrandhq', 20, 50_000)]]),
  },
  'cross platform with unknowns': {
    clusterId: 'c',
    posts: [post('mapleoakfox', exact(900)), post('zenithradio', exact(700), 'instagram')],
    accounts: new Map(),
    history: new Map(),
  },
  'single abbreviated post': {
    clusterId: 'd',
    posts: [post('mapleoakfox', parseCount('1K')!)],
    accounts: new Map(),
    history: new Map(),
  },
};

describe('explainability', () => {
  it.each(Object.entries(CASES))('%s: evidence, confidence, sample sizes and missing-data list are present', (_name, input) => {
    const c = classifyCluster(input);
    expect(c.evidence.length).toBeGreaterThanOrEqual(1);
    expect(c.evidence.every((e) => e.text.length > 10 && ['content', 'publisher', 'neutral'].includes(e.direction))).toBe(true);
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThan(1);
    expect(Array.isArray(c.missingData)).toBe(true);
    expect(c.sampleSizes.posts).toBe(input.posts.length);
    expect(c.sampleSizes.independentAccounts).toBeGreaterThanOrEqual(1);
    expect(c.sampleSizes.platforms).toBeGreaterThanOrEqual(1);
    expect(c.sampleSizes.baselineSamples).toBeTypeOf('object');
    expect(c.summary.length).toBeGreaterThan(10);
  });

  it('reports "Insufficient evidence" when confidence falls under 0.35', () => {
    const c = classifyCluster(CASES['single abbreviated post']);
    expect(c.confidence).toBeLessThan(0.35);
    expect(c.label).toBe('Insufficient evidence');
    expect(c.summary).toMatch(/too thin/i);
  });

  it('lists unknown follower counts and abbreviated counts as missing data', () => {
    const c = classifyCluster(CASES['three accounts, no baselines']);
    expect(c.missingData.some((m) => m.startsWith('baseline unknown'))).toBe(true);
    expect(c.missingData.some((m) => m.startsWith('follower count unknown'))).toBe(true);
    expect(c.missingData.some((m) => /abbreviated/.test(m))).toBe(true);
  });

  it('records baseline sample sizes per account', () => {
    const c = classifyCluster(CASES['brand with baseline']);
    expect(c.sampleSizes.baselineSamples['x:acmebrandhq']).toBe(20);
  });
});
