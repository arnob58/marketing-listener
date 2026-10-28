/** Facebook is the most fragile adapter: it relies on role/aria hooks and permalink URL shapes. */
export const VERSION = 'fb-2025.1';

export const SEL = {
  post: 'div[role="article"]',
  author: '[data-ad-rendering-role="profile_name"] a[href], h2 a[href], h3 a[href], h4 a[href]',
  header: 'h2, h3, h4, [data-ad-rendering-role="profile_name"]',
  message: '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]',
  media: 'img[data-visualcompletion="media-vc-image"], img[src*="fbcdn.net"]',
  reactions: '[aria-label="See who reacted to this"]',
  profileName: 'h1',
  verified: 'svg[aria-label="Verified account"], [aria-label="Verified account"]',
  challenge: 'iframe[src*="recaptcha"], form#login_form, [id*="captcha" i]',
};

/** Anchors that point at a post permalink. */
export const PERMALINK_ANCHOR =
  'a[href*="/posts/"], a[href*="/permalink"], a[href*="story_fbid"], a[href*="/videos/"], a[href*="/reel/"], a[href*="/photo"]';

export const BLOCKED_FIRST_SEGMENTS = new Set([
  'messages',
  'messenger',
  'notifications',
  'settings',
  'checkout',
  'payments',
  'ads',
  'help',
  'bookmarks',
  'login',
  'checkpoint',
  'recover',
  'privacy',
  'security',
]);

export const NON_PROFILE_SEGMENTS = new Set([
  'watch', 'gaming', 'events', 'pages', 'friends', 'stories', 'reel', 'marketplace', 'groups', 'search',
  'photo', 'photo.php', 'story.php', 'permalink.php', 'hashtag', 'sharer', 'dialog', 'l.php', 'home.php',
  ...BLOCKED_FIRST_SEGMENTS,
]);

export const PROFILE_TABS = new Set(['posts', 'photos', 'videos', 'about', 'reels', 'friends', 'followers']);

/**
 * First path words that are pages, not people. A handle equal to one of these is a mis-read
 * (e.g. the "groups" in /groups/<id>/), so it is never accepted as an author.
 */
export const RESERVED = new Set([
  ...NON_PROFILE_SEGMENTS,
  'photos', 'videos', 'posts', 'reels', 'share', 'sharer.php', 'public', 'people', 'profile', 'profile.php',
  'live', 'feed', 'about', 'business', 'policies', 'legal', 'ads', 'saved', 'memories', 'comment', 'plugins',
  'permalink', 'story', 'media', 'notes', 'offers', 'fundraisers', 'lite', 'login.php', 'recover', 'two_step_verification',
]);
