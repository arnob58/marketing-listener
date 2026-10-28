import { describe, expect, it } from 'vitest';
import '../../src/adapters';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import type { Platform, RawPost } from '../../src/core/types';
import { loadFixture } from '../helpers/fixture';

interface ExpectedPost {
  postId: string;
  authorHandle: string;
  text: string;
  postedAt: number;
  url: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  kind: string;
}

const PLATFORMS: Platform[] = ['x', 'instagram', 'facebook'];

function extractFeed(platform: Platform, name = 'feed') {
  const { doc, url, expected } = loadFixture<{ rootCount: number; posts: ExpectedPost[]; now: number }>(platform, name);
  const adapter = getAdapterForUrl(url)!;
  const roots = adapter.findPostRoots(doc);
  const posts = collectPosts(adapter, doc, { url, now: expected!.now });
  return { adapter, roots, posts, expected: expected! };
}

describe.each(PLATFORMS)('%s extraction', (platform) => {
  it('resolves the adapter from the fixture url', () => {
    const { url } = loadFixture(platform, 'feed');
    expect(getAdapterForUrl(url)?.id).toBe(platform);
  });

  it('detects at least 95% of post roots', () => {
    const { roots, expected } = extractFeed(platform);
    expect(roots.length / expected.rootCount).toBeGreaterThanOrEqual(0.95);
    // no phantom roots (comments, ads) either
    expect(roots.length).toBeLessThanOrEqual(expected.rootCount);
  });

  it('extracts author, text, timestamp and url with at least 95% accuracy each', () => {
    const { posts, expected } = extractFeed(platform);
    const byId = new Map<string, RawPost>(posts.map((p) => [p.postId, p]));
    const fields = {
      author: (p: RawPost, e: ExpectedPost) => p.authorHandle === e.authorHandle,
      text: (p: RawPost, e: ExpectedPost) => p.text === e.text,
      timestamp: (p: RawPost, e: ExpectedPost) => p.postedAt === e.postedAt,
      url: (p: RawPost, e: ExpectedPost) => p.url === e.url,
    };
    for (const [field, ok] of Object.entries(fields)) {
      const hits = expected.posts.filter((e) => {
        const p = byId.get(e.postId);
        return p && ok(p, e);
      }).length;
      const accuracy = hits / expected.posts.length;
      expect(accuracy, `${platform} ${field} accuracy`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('extracts engagement counts', () => {
    const { posts, expected } = extractFeed(platform);
    const byId = new Map(posts.map((p) => [p.postId, p]));
    let checked = 0;
    let correct = 0;
    for (const e of expected.posts) {
      const p = byId.get(e.postId);
      if (!p) continue;
      for (const k of ['likes', 'comments', 'shares', 'views'] as const) {
        checked++;
        const got = p.metrics[k]?.value ?? null;
        if (got === e[k]) correct++;
      }
    }
    expect(correct / checked).toBeGreaterThanOrEqual(0.95);
  });

  it('records extraction health per field and the selector version', () => {
    const { posts, adapter } = extractFeed(platform);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.selectorVersion).toBe(adapter.selectorVersion);
      expect(p.resolved.author && p.resolved.url).toBe(true);
    }
    const textResolved = posts.filter((p) => p.resolved.text).length / posts.length;
    expect(textResolved).toBeGreaterThanOrEqual(0.95);
  });

  it('extracts the profile', () => {
    const { doc, url, expected } = loadFixture(platform, 'profile');
    const adapter = getAdapterForUrl(url)!;
    expect(adapter.surface(url)).toBe('profile');
    const profile = adapter.extractProfile(doc, url)!;
    expect(profile).not.toBeNull();
    expect(profile.handle).toBe(expected.profile.handle);
    expect(profile.followers?.value).toBe(expected.profile.followers);
    expect(profile.verified).toBe(expected.profile.verified);
  });
});

describe('platform specifics', () => {
  it('X: skips ads, tags reposts and quotes, keeps media', () => {
    const { posts, expected } = extractFeed('x');
    expect(posts).toHaveLength(expected.rootCount);
    const reposted = posts.filter((p) => p.repostedBy);
    expect(reposted.length).toBeGreaterThan(0);
    expect(reposted.every((p) => p.kind === 'original')).toBe(true);
    const quotes = posts.filter((p) => p.kind === 'quote');
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((p) => p.refPostId && p.refPostId !== p.postId)).toBe(true);
    expect(posts.some((p) => p.imageUrls.some((u) => u.startsWith('https://pbs.twimg.com/')))).toBe(true);
    expect(posts.some((p) => p.hasVideo && p.imageUrls.length > 0)).toBe(true);
  });

  it('X: hidden zero counts read as exact zero', () => {
    const { posts } = extractFeed('x', 'zero_counts');
    expect(posts[0].metrics.likes).toEqual({ value: 0, low: 0, high: 0 });
    expect(posts[0].metrics.views?.value).toBe(1200);
  });

  it('X: emoji images keep their alt text', () => {
    const { posts } = extractFeed('x');
    expect(posts.some((p) => p.text.includes('\u{1F525}'))).toBe(true);
  });

  it('Instagram: hidden likes stay null instead of becoming zero', () => {
    const { posts } = extractFeed('instagram');
    const hidden = posts.filter((p) => p.metrics.likes === null);
    expect(hidden.length).toBeGreaterThan(0);
    expect(posts.some((p) => p.metrics.likes !== null)).toBe(true);
  });

  it('Instagram: reels carry views and a poster frame', () => {
    const { posts } = extractFeed('instagram');
    const reels = posts.filter((p) => p.url.includes('/reel/'));
    expect(reels.length).toBeGreaterThan(0);
    expect(reels.every((p) => p.hasVideo && p.metrics.views && p.imageUrls.length === 1)).toBe(true);
  });

  it('Instagram: avatars are not treated as post media', () => {
    const { posts } = extractFeed('instagram');
    expect(posts.every((p) => p.imageUrls.every((u) => !u.includes('_s150x150')))).toBe(true);
  });

  it('Facebook: comments are not post roots, shares are flagged, both permalink styles resolve', () => {
    const { posts, expected } = extractFeed('facebook');
    expect(posts).toHaveLength(expected.rootCount);
    expect(posts.some((p) => p.kind === 'quote')).toBe(true);
    expect(posts.some((p) => p.url.includes('permalink.php'))).toBe(true);
    expect(posts.some((p) => p.url.includes('/posts/'))).toBe(true);
    expect(posts.every((p) => p.imageUrls.every((u) => !u.includes('s40x40')))).toBe(true);
  });
});
