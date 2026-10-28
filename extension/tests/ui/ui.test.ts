import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterReport } from '../../src/analysis/evaluate';
import { classifyCluster } from '../../src/analysis/attribution';
import { exact } from '../../src/core/metrics';
import { Limitations, Sparkline } from '../../src/ui/shared/components';
import { applyFilters, NO_FILTERS, Trends } from '../../src/ui/dashboard/Trends';
import { fmtMetric, fmtNumber } from '../../src/ui/shared/format';
import { MON } from '../helpers/world';

function report(over: Partial<ClusterReport> & { id: string }): ClusterReport {
  const classification = classifyCluster({
    clusterId: over.id,
    posts: [{ key: 'x:a', platform: 'x', authorKey: 'x:mapleoakfox', authorHandle: 'mapleoakfox', engagement: exact(900), postedAt: null, firstSeenAt: MON, lastSeenAt: MON, kind: 'original', refKey: null, variantOf: null, repostedBy: [] }],
    accounts: new Map(),
    history: new Map(),
  });
  return {
    clusterId: over.id, kind: 'trend', independentAccounts: 4, totalPosts: 5, variants: 1, platforms: ['x'], perPlatform: [], trendScore: 5,
    velocity24h: 2, lifecycle: { stage: 'Emerging', duration: null, windows: [4, 0, 0], firstSeenAt: MON, lastSightingAt: MON, growthRatio: null },
    classification, lead: null, firstSeenAt: MON, lastSeenAt: MON + 1000, ...over,
  };
}

describe('dashboard filters', () => {
  const reports = [
    report({ id: 'a', platforms: ['x'] }),
    report({ id: 'b', platforms: ['instagram', 'facebook'], kind: 'candidate' }),
    report({ id: 'c', platforms: ['x'], lifecycle: { stage: 'Declining', duration: null, windows: [0, 0, 0], firstSeenAt: MON, lastSightingAt: MON, growthRatio: null }, firstSeenAt: MON + 10 * 86_400_000, lastSeenAt: MON + 11 * 86_400_000 }),
  ];
  it('filters by platform, lifecycle, kind and date', () => {
    expect(applyFilters(reports, { ...NO_FILTERS, platform: 'facebook' }).map((r) => r.clusterId)).toEqual(['b']);
    expect(applyFilters(reports, { ...NO_FILTERS, lifecycle: 'Declining' }).map((r) => r.clusterId)).toEqual(['c']);
    expect(applyFilters(reports, { ...NO_FILTERS, trendsOnly: true }).map((r) => r.clusterId)).toEqual(['a', 'c']);
    expect(applyFilters(reports, { ...NO_FILTERS, from: '2025-03-18' }).map((r) => r.clusterId)).toEqual(['c']);
    expect(applyFilters(reports, { ...NO_FILTERS, attribution: 'Likely content-driven' })).toEqual([]);
    expect(applyFilters(reports, NO_FILTERS)).toHaveLength(3);
  });
});

describe('UI rendering', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it('renders the trends table with attribution, confidence and the sampling caveat', async () => {
    const onOpen = vi.fn();
    await act(() => render(h(Trends, { reports: [report({ id: 'a' })], onOpen }), root));
    const text = root.textContent ?? '';
    expect(text).toContain('Trend');
    expect(text).toMatch(/Insufficient evidence|Likely|Mixed/);
    expect(text).toMatch(/\d+%/);
    expect(text).toMatch(/Based on 1 clusters from posts your own feeds showed/);
    root.querySelector<HTMLElement>('tr.clickable')!.click();
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('shows an empty state instead of a blank table', async () => {
    await act(() => render(h(Trends, { reports: [], onOpen: () => {} }), root));
    expect(root.textContent).toContain('Nothing matches');
  });

  it('always shows the limitation notice and handles sparse snapshots', async () => {
    await act(() => render(h('div', null, h(Limitations, null), h(Sparkline, { snapshots: [] })), root));
    expect(root.textContent).toContain('trending within the posts your own feeds showed');
    expect(root.textContent).toContain('no snapshots yet');
  });

  it('draws a polyline once there are two or more snapshots', async () => {
    const snap = (day: string, accounts: number) => ({ clusterId: 'c', day, at: 0, accounts, posts: accounts, medianEngagement: 1, platforms: ['x' as const] });
    await act(() => render(h(Sparkline, { snapshots: [snap('2025-03-10', 5), snap('2025-03-11', 25)] }), root));
    expect(root.querySelector('polyline')).not.toBeNull();
    expect(root.querySelectorAll('circle')).toHaveLength(2);
  });
});

describe('formatting', () => {
  it('abbreviates large numbers and flags ranges', () => {
    expect(fmtNumber(999)).toBe('999');
    expect(fmtNumber(12_500)).toBe('12.5K');
    expect(fmtNumber(2_400_000)).toBe('2.4M');
    expect(fmtMetric(null)).toBe('n/a');
    expect(fmtMetric({ value: 1200, low: 1150, high: 1250 })).toBe('~1,200');
    expect(fmtMetric(exact(40))).toBe('40');
  });
});
