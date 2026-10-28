import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyCluster } from '../../src/analysis/attribution';
import type { ClusterReport } from '../../src/analysis/evaluate';
import { emptyMetrics, exact, parseCount } from '../../src/core/metrics';
import type { StoredPost } from '../../src/core/types';
import { Trends } from '../../src/ui/dashboard/Trends';
import { PostItem } from '../../src/ui/shared/components';
import { metricParts } from '../../src/ui/shared/format';
import { MON } from '../helpers/world';

const LONG = 'A long caption that keeps going so it needs the expander. '.repeat(6).trim();

function post(over: Partial<StoredPost> = {}): StoredPost {
  return {
    key: 'instagram:abc', platform: 'instagram', postId: 'abc', url: 'https://www.instagram.com/reel/abc/', authorKey: 'instagram:mapleoakfox',
    authorHandle: 'mapleoakfox', text: LONG, hashtags: ['dance', 'summer'], postedAt: MON, imageUrls: [], hasVideo: true,
    metrics: { ...emptyMetrics(), likes: parseCount('12K'), comments: exact(45), views: parseCount('1.2M') }, engagement: exact(12_100),
    audio: { id: '9001', title: 'Summer Loop', isOriginal: false }, surface: 'feed', kind: 'original', refKey: null, repostedBy: [],
    firstSeenAt: MON, lastSeenAt: MON, featureState: 'done', imageHash: null, textHash: null, clusterId: 'c', variantOf: null, ...over,
  };
}

describe('post content in the dashboard', () => {
  let root: HTMLElement;
  let created: string[];
  let revoked: string[];
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    created = [];
    revoked = [];
    URL.createObjectURL = vi.fn(() => {
      const u = `blob:fake/${created.length}`;
      created.push(u);
      return u;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  it('shows the thumbnail from a stored Blob, caption, hashtags, time, per-metric counts, sound and link', async () => {
    const blob = new Blob(['jpg'], { type: 'image/jpeg' });
    const load = vi.fn(async () => blob);
    await act(() => render(h(PostItem, { post: post(), load }), root));
    await act(async () => { await Promise.resolve(); });

    expect(load).toHaveBeenCalledWith('instagram:abc');
    expect(root.querySelector<HTMLImageElement>('img.thumb')?.getAttribute('src')).toBe('blob:fake/0');
    const text = root.textContent ?? '';
    expect(text).toContain('A long caption that keeps going');
    expect(text).toContain('#dance #summer');
    expect(text).toContain('2025-03-10 00:00');
    expect(text).toContain('likes ~12.0K');
    expect(text).toContain('comments 45');
    expect(text).toContain('views ~1.2M');
    expect(text).toContain('Sound: Summer Loop');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://www.instagram.com/reel/abc/');
  });

  it('clamps the caption to three lines and expands on request', async () => {
    await act(() => render(h(PostItem, { post: post(), load: async () => undefined }), root));
    const caption = () => root.querySelector('.caption')!;
    expect(caption().className).toContain('clamp3');
    await act(() => root.querySelector<HTMLButtonElement>('button.link')!.click());
    expect(caption().className).not.toContain('clamp3');
    expect(root.querySelector('button.link')?.textContent).toBe('Show less');
  });

  it('offers no expander for a short caption and shows an empty frame without a thumbnail', async () => {
    await act(() => render(h(PostItem, { post: post({ text: 'short one', audio: null, postedAt: null }), load: async () => undefined }), root));
    await act(async () => { await Promise.resolve(); });
    expect(root.querySelector('button.link')).toBeNull();
    expect(root.querySelector('.thumb-empty')).not.toBeNull();
    expect(root.textContent).toContain('post time unknown');
    expect(root.textContent).not.toContain('Sound:');
  });

  it('revokes the object URL when the component unmounts', async () => {
    await act(() => render(h(PostItem, { post: post(), load: async () => new Blob(['x']) }), root));
    await act(async () => { await Promise.resolve(); });
    expect(created).toHaveLength(1);
    expect(revoked).toEqual([]);
    await act(() => render(null, root));
    expect(revoked).toEqual(['blob:fake/0']);
  });

  it('lists only the counts the page showed', () => {
    expect(metricParts({ ...emptyMetrics(), likes: exact(5) })).toEqual(['likes 5']);
    expect(metricParts(emptyMetrics())).toEqual([]);
  });

  it('trend rows show the lead caption and sound', async () => {
    const classification = classifyCluster({ clusterId: 'c', posts: [{ key: 'instagram:abc', platform: 'instagram', authorKey: 'instagram:mapleoakfox', authorHandle: 'mapleoakfox', engagement: exact(900), postedAt: null, firstSeenAt: MON, lastSeenAt: MON, kind: 'original', refKey: null, variantOf: null, repostedBy: [] }], accounts: new Map(), history: new Map() });
    const report: ClusterReport = {
      clusterId: 'c', kind: 'trend', independentAccounts: 3, totalPosts: 3, variants: 0, platforms: ['instagram'], perPlatform: [], trendScore: 4, velocity24h: 1,
      lifecycle: { stage: 'Emerging', duration: null, windows: [3, 0, 0], firstSeenAt: MON, lastSightingAt: MON, growthRatio: null },
      classification, lead: { key: 'instagram:abc', url: 'https://www.instagram.com/reel/abc/', text: 'lead caption here', audioTitle: 'Summer Loop' },
      firstSeenAt: MON, lastSeenAt: MON,
    };
    await act(() => render(h(Trends, { reports: [report], onOpen: () => {} }), root));
    expect(root.textContent).toContain('lead caption here');
    expect(root.textContent).toContain('Sound: Summer Loop');
    expect(root.querySelector('.thumb')).not.toBeNull();
  });
});
