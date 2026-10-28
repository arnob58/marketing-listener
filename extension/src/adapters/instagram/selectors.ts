/**
 * Instagram ships obfuscated class names, so selectors rely on semantic tags, aria and URL shapes.
 * ig-2026.1 was written against real captures (home feed, reels viewer, explore grid, profile):
 * posts are `<article>` elements with NO `<header>`, counts are bare numbers beside the
 * `svg[aria-label=Like|Comment|Repost]` icons, and the reels viewer has no `<article>` at all.
 */
export const VERSION = 'ig-2026.1';

export const SEL = {
  post: 'article',
  header: 'header',
  /** /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, also behind a /<handle>/ prefix. */
  postLink: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]',
  caption: 'h1, span[dir="auto"], div[dir="auto"]',
  likesLink: 'a[href$="/liked_by/"]',
  commentsLink: 'a[href*="/comments"]',
  images: 'img[src*="cdninstagram.com"], img[src*="fbcdn.net"]',
  audioLink: 'a[href*="/reels/audio/"]',
  likeIcon: 'svg[aria-label="Like"], svg[aria-label="Unlike"]',
  verified: 'svg[aria-label="Verified"]',
  ogDescription: 'meta[property="og:description"]',
  challenge: 'iframe[src*="recaptcha"], form[action*="challenge"], #loginForm',
};

/** aria-labels of the action-bar icons whose neighbouring number is the count. */
export const ICON = {
  likes: ['Like', 'Unlike'],
  comments: ['Comment'],
  // The Repost icon carries a count; a bare Share icon usually does not.
  shares: ['Repost', 'Share'],
};

export const BLOCKED_FIRST_SEGMENTS = new Set([
  'direct',
  'accounts',
  'notifications',
  'emails',
  'settings',
  'challenge',
]);

export const RESERVED = new Set([
  'explore', 'p', 'reel', 'reels', 'tv', 'stories', 'about', 'legal', 'web', 'developer', 'api', 'ar',
  ...BLOCKED_FIRST_SEGMENTS,
]);

export const PROFILE_TABS = new Set(['reels', 'tagged', 'saved', 'guides', 'channel']);
