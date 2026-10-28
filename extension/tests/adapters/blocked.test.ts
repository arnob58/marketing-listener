import { describe, expect, it } from 'vitest';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import type { Platform } from '../../src/core/types';
import { loadFixture } from '../helpers/fixture';

const BLOCKED: Array<[Platform, string]> = [
  ['x', 'blocked_dm'],
  ['x', 'blocked_notifications'],
  ['x', 'blocked_settings'],
  ['instagram', 'blocked_dm'],
  ['instagram', 'blocked_notifications'],
  ['instagram', 'blocked_settings'],
  ['facebook', 'blocked_dm'],
  ['facebook', 'blocked_notifications'],
  ['facebook', 'blocked_settings'],
  ['facebook', 'blocked_checkout'],
];

describe('blocked surfaces', () => {
  it.each(BLOCKED)('%s %s: 0 posts extracted even though post-like markup is present', (platform, name) => {
    const { doc, url } = loadFixture(platform, name);
    const adapter = getAdapterForUrl(url)!;
    expect(adapter.surface(url)).toBe('blocked');
    // the fixture really contains something that looks like a post
    expect(adapter.findPostRoots(doc).length).toBeGreaterThan(0);
    expect(collectPosts(adapter, doc, { url, now: Date.now() })).toHaveLength(0);
  });

  it.each([
    ['https://x.com/messages', 'x'],
    ['https://x.com/i/chat/abc', 'x'],
    ['https://twitter.com/notifications', 'x'],
    ['https://x.com/settings/privacy', 'x'],
    ['https://www.instagram.com/direct/t/123/', 'instagram'],
    ['https://www.instagram.com/accounts/edit/', 'instagram'],
    ['https://www.facebook.com/messages/t/1', 'facebook'],
    ['https://www.facebook.com/payments/', 'facebook'],
    ['https://www.facebook.com/settings', 'facebook'],
  ])('%s is blocked', (url, platform) => {
    const adapter = getAdapterForUrl(url)!;
    expect(adapter.id).toBe(platform);
    expect(adapter.surface(url)).toBe('blocked');
  });

  it('classifies ordinary surfaces correctly', () => {
    const x = getAdapterForUrl('https://x.com/')!;
    expect(x.surface('https://x.com/home')).toBe('feed');
    expect(x.surface('https://x.com/explore')).toBe('explore');
    expect(x.surface('https://x.com/search?q=cats')).toBe('search');
    expect(x.surface('https://x.com/someone')).toBe('profile');
    expect(x.surface('https://x.com/someone/status/123')).toBe('post');
    const ig = getAdapterForUrl('https://www.instagram.com/')!;
    expect(ig.surface('https://www.instagram.com/')).toBe('feed');
    expect(ig.surface('https://www.instagram.com/explore/')).toBe('explore');
    expect(ig.surface('https://www.instagram.com/p/ABC/')).toBe('post');
    expect(ig.surface('https://www.instagram.com/someone/')).toBe('profile');
    const fb = getAdapterForUrl('https://www.facebook.com/')!;
    expect(fb.surface('https://www.facebook.com/')).toBe('feed');
    expect(fb.surface('https://www.facebook.com/some.page')).toBe('profile');
    expect(fb.surface('https://www.facebook.com/some.page/posts/pfbid0abc')).toBe('post');
    expect(fb.surface('https://www.facebook.com/groups/12345')).toBe('feed');
  });

  it('does not match foreign hosts', () => {
    expect(getAdapterForUrl('https://example.com/')).toBeNull();
    expect(getAdapterForUrl('https://notx.com/home')).toBeNull();
  });
});

describe('challenge pages', () => {
  it.each([
    ['x', 'challenge_login'],
    ['x', 'login_wall'],
    ['instagram', 'challenge'],
    ['facebook', 'challenge_checkpoint'],
  ] as Array<[Platform, string]>)('%s %s is detected', (platform, name) => {
    const { doc, url } = loadFixture(platform, name);
    expect(getAdapterForUrl(url)!.isChallengePage(doc, url)).toBe(true);
  });

  it.each([
    ['x', 'feed'],
    ['instagram', 'feed'],
    ['facebook', 'feed'],
  ] as Array<[Platform, string]>)('%s %s is not a challenge', (platform, name) => {
    const { doc, url } = loadFixture(platform, name);
    expect(getAdapterForUrl(url)!.isChallengePage(doc, url)).toBe(false);
  });
});
