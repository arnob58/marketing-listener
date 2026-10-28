import { describe, expect, it } from 'vitest';
import '../../src/adapters';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import { isReelsViewer } from '../../src/adapters/instagram/adapter';
import { sampleProfile } from '../../src/content/baseline';
import { PostObserver, type ObserverEnv, type VisibilityEntry } from '../../src/content/observer';
import type { RawPost } from '../../src/core/types';
import { loadFixture } from '../helpers/fixture';

// Fixtures real-*.html are sanitized captures of the live Instagram web app (see workflows/capture_fixture.md).

interface ExpectedPost {
  postId: string;
  authorHandle: string;
  text: string;
  postedAt: number | null;
  url: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  hasVideo: boolean;
  audio: { id: string; title: string; isOriginal: boolean } | null;
}

const share = (hits: number, total: number) => hits / total;

describe('instagram real feed capture', () => {
  const { doc, url, expected } = loadFixture<{ rootCount: number; adsWithoutPostLink: number; posts: ExpectedPost[] }>(
    'instagram',
    'real-feed',
  );
  const adapter = getAdapterForUrl(url)!;
  const posts = collectPosts(adapter, doc, { url, now: 0 });
  const byId = new Map(posts.map((p) => [p.postId, p]));

  it('finds every post root and skips the sponsored article that has no post link', () => {
    const roots = adapter.findPostRoots(doc, url);
    expect(doc.querySelectorAll('article')).toHaveLength(expected!.rootCount + expected!.adsWithoutPostLink);
    expect(share(roots.length, expected!.rootCount)).toBeGreaterThanOrEqual(0.95);
    expect(roots.length).toBeLessThanOrEqual(expected!.rootCount);
    expect(doc.querySelector('header')).toBeNull(); // the old adapter required one
  });

  it('reads id, author, caption, time, url and sound for at least 95% of posts', () => {
    const fields: Array<[string, (p: RawPost, e: ExpectedPost) => boolean]> = [
      ['author', (p, e) => p.authorHandle === e.authorHandle],
      ['text', (p, e) => p.text === e.text],
      ['timestamp', (p, e) => p.postedAt === e.postedAt],
      ['url', (p, e) => p.url === e.url],
      ['audio', (p, e) => JSON.stringify(p.audio) === JSON.stringify(e.audio)],
      ['video', (p, e) => p.hasVideo === e.hasVideo],
    ];
    for (const [name, ok] of fields) {
      const hits = expected!.posts.filter((e) => byId.has(e.postId) && ok(byId.get(e.postId)!, e)).length;
      expect(share(hits, expected!.posts.length), name).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('reads the bare numbers beside the Like, Comment and Repost icons', () => {
    let nonZero = 0;
    for (const e of expected!.posts) {
      const p = byId.get(e.postId)!;
      expect(p.metrics.likes?.value ?? null, `${e.postId} likes`).toBe(e.likes);
      expect(p.metrics.comments?.value ?? null, `${e.postId} comments`).toBe(e.comments);
      expect(p.metrics.shares?.value ?? null, `${e.postId} shares`).toBe(e.shares);
      expect(p.metrics.views).toBeNull(); // Instagram does not render a play count on the feed
      if ((p.metrics.likes?.value ?? 0) > 0 || (p.metrics.comments?.value ?? 0) > 0) nonZero++;
    }
    expect(share(nonZero, expected!.posts.length)).toBeGreaterThanOrEqual(0.9);
  });

  it('marks the surface, resolves fields and drops avatars from media', () => {
    expect(posts.every((p) => p.surface === 'feed' && p.resolved.author && p.resolved.url && p.resolved.metrics)).toBe(true);
    expect(posts.every((p) => p.imageUrls.length > 0 && p.imageUrls.every((u) => !u.includes('profile')))).toBe(true);
    expect(posts.find((p) => p.audio?.isOriginal)?.audio?.id).toBeTruthy();
  });
});

describe('instagram real reels viewer capture', () => {
  const { doc, url, expected } = loadFixture<{ rootCount: number; reelTwoUrl: string; posts: ExpectedPost[] }>(
    'instagram',
    'real-reels',
  );
  const adapter = getAdapterForUrl(url)!;

  /** Gives the two reel containers a layout: reel `active` is in view, the other is off screen. */
  function layout(first: Element, second: Element, active: 0 | 1) {
    const vh = doc.defaultView!.innerHeight;
    const rect = (top: number) => () => ({ top, bottom: top + vh, left: 0, right: 400, width: 400, height: vh }) as DOMRect;
    first.getBoundingClientRect = rect(active === 0 ? 0 : -vh);
    second.getBoundingClientRect = rect(active === 1 ? 0 : vh);
  }

  it('is the reels viewer: a feed surface with no article, found by its video container', () => {
    expect(adapter.surface(url)).toBe('feed');
    expect(isReelsViewer(url)).toBe(true);
    expect(isReelsViewer('https://www.instagram.com/reels/audio/123/')).toBe(false);
    expect(isReelsViewer('https://www.instagram.com/')).toBe(false);
    expect(doc.querySelectorAll('article')).toHaveLength(0);
    expect(doc.querySelectorAll('video')).toHaveLength(2);
    const roots = adapter.findPostRoots(doc, url);
    expect(roots).toHaveLength(expected!.rootCount);
    expect(roots.every((r) => r.querySelectorAll('video').length === 1 && r.querySelector('svg[aria-label="Like"]'))).toBe(true);
    // without a url the adapter keeps to articles, so other surfaces never pay for the video climb
    expect(adapter.findPostRoots(doc)).toHaveLength(0);
  });

  it('reads shortcode, caption, likes, comments, shares and sound of the reel in view, and of the next one after a scroll', () => {
    const [first, second] = adapter.findPostRoots(doc, url);
    let correct = 0;
    for (const [active, pageUrl] of [[0, url], [1, expected!.reelTwoUrl]] as const) {
      layout(first, second, active);
      const e = expected!.posts[active];
      const p = adapter.extractPost(active === 0 ? first : second, { url: pageUrl, now: 0 })!;
      const ok =
        p.postId === e.postId &&
        p.url === e.url &&
        p.authorHandle === e.authorHandle &&
        p.text === e.text &&
        p.metrics.likes?.value === e.likes &&
        p.metrics.comments?.value === e.comments &&
        p.metrics.shares?.value === e.shares &&
        JSON.stringify(p.audio) === JSON.stringify(e.audio);
      if (ok) correct++;
      expect(p.surface).toBe('feed');
      expect(p.hasVideo).toBe(true);
      expect(p.postedAt).toBeNull(); // the viewer shows no time
      expect(p.metrics.views).toBeNull(); // and no play count
    }
    expect(share(correct, 2)).toBeGreaterThanOrEqual(0.9);
  });

  it('never gives the shortcode in the URL to a reel that is not in view', () => {
    const [first, second] = adapter.findPostRoots(doc, url);
    layout(first, second, 0);
    expect(adapter.extractPost(second, { url, now: 0 })).toBeNull();
    expect(collectPosts(adapter, doc, { url, now: 0 }).map((p) => p.postId)).toEqual([expected!.posts[0].postId]);
  });

  it('reads nothing until the URL names a reel', () => {
    const [first, second] = adapter.findPostRoots(doc, url);
    layout(first, second, 0);
    expect(adapter.extractPost(first, { url: 'https://www.instagram.com/reels/', now: 0 })).toBeNull();
  });

  it('re-reads the visible reel when the URL changes in place (no DOM mutation, no new roots)', () => {
    let current = url;
    let ioCb: (e: VisibilityEntry[]) => void = () => {};
    let tick: () => void = () => {};
    let moCb: (n: Node[]) => void = () => {};
    const observeCalls: Element[] = [];
    const idle: Array<() => void> = [];
    const emitted: RawPost[] = [];
    const env: ObserverEnv = {
      getUrl: () => current,
      now: () => 1_000,
      createIntersectionObserver: (cb) => ((ioCb = cb), { observe: (el) => void observeCalls.push(el), unobserve: () => {}, disconnect: () => {} }),
      createMutationObserver: (cb) => ((moCb = cb), { observe: () => {}, disconnect: () => {} }),
      schedule: (cb) => void idle.push(cb),
      setInterval: (cb) => ((tick = cb), () => {}),
    };
    const run = () => idle.splice(0).forEach((cb) => cb());
    const [first, second] = adapter.findPostRoots(doc, url);
    layout(first, second, 0);

    const observer = new PostObserver(adapter, doc, env, (p) => emitted.push(...p));
    observer.start();
    expect(observeCalls).toHaveLength(2);
    ioCb([{ target: first, isIntersecting: true, intersectionRatio: 1 }]);
    run();
    expect(emitted.map((p) => p.postId)).toEqual([expected!.posts[0].postId]);

    tick(); // same URL: nothing is re-observed
    expect(observeCalls).toHaveLength(2);

    // The viewer scrolls to the next reel and only the URL changes.
    layout(first, second, 1);
    current = expected!.reelTwoUrl;
    tick();
    expect(observeCalls).toHaveLength(4); // both roots were re-observed, which makes IntersectionObserver report again
    ioCb([
      { target: first, isIntersecting: false, intersectionRatio: 0 },
      { target: second, isIntersecting: true, intersectionRatio: 1 },
    ]);
    run();
    expect(emitted.map((p) => p.postId)).toEqual(expected!.posts.map((e) => e.postId));
    expect(emitted[1].authorHandle).toBe(expected!.posts[1].authorHandle);
    observer.stop();

    // The mutation path notices a URL change too.
    current = url;
    observeCalls.length = 0;
    const again = new PostObserver(adapter, doc, env, () => {});
    again.start();
    const before = observeCalls.length;
    current = expected!.reelTwoUrl;
    moCb([doc.body]);
    expect(observeCalls.length).toBeGreaterThan(before + 1);
    again.stop();
  });
});

describe('instagram real explore/search grid capture', () => {
  const { doc, url } = loadFixture('instagram', 'real-search');
  const adapter = getAdapterForUrl(url)!;

  it('is a search surface whose tiles carry no author or counts, so no post is emitted', () => {
    expect(adapter.surface(url)).toBe('search');
    expect(doc.querySelectorAll('a[href*="/p/"]').length).toBeGreaterThan(20);
    expect(doc.querySelectorAll('video').length).toBeGreaterThan(10);
    expect(adapter.findPostRoots(doc, url)).toHaveLength(0);
    expect(collectPosts(adapter, doc, { url, now: 0 })).toHaveLength(0);
  });
});

describe('instagram real profile capture', () => {
  const { doc, url, expected } = loadFixture('instagram', 'real-profile');
  const adapter = getAdapterForUrl(url)!;

  it('reads the follower count from the rendered header', () => {
    expect(adapter.surface(url)).toBe('profile');
    const profile = adapter.extractProfile(doc, url)!;
    expect(profile.handle).toBe(expected.profile.handle);
    expect(profile.followers?.value).toBe(expected.profile.followers);
    expect(profile.verified).toBe(expected.profile.verified);
    expect(profile.displayName).toBeNull(); // the h2 is the handle, not a name
  });

  it('samples the profile without emitting grid tiles as posts (they have an id but no counts)', () => {
    expect(doc.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').length).toBeGreaterThan(10);
    const r = sampleProfile(adapter, doc, url, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.followers?.value).toBe(expected.profile.followers);
      expect(r.posts).toHaveLength(expected.rootCount);
    }
  });
});
