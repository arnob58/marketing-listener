/** Selectors anchor on X's data-testid hooks. Bump VERSION whenever any of these change. */
export const VERSION = 'x-2025.1';

export const SEL = {
  post: 'article[data-testid="tweet"]',
  userName: '[data-testid="User-Name"]',
  profileUserName: '[data-testid="UserName"]',
  text: '[data-testid="tweetText"]',
  photo: '[data-testid="tweetPhoto"] img',
  videoPoster: '[data-testid="videoPlayer"] video, [data-testid="videoComponent"] video',
  reply: '[data-testid="reply"]',
  repost: '[data-testid="retweet"], [data-testid="unretweet"]',
  like: '[data-testid="like"], [data-testid="unlike"]',
  views: 'a[href$="/analytics"]',
  social: '[data-testid="socialContext"]',
  ad: '[data-testid="placementTracking"]',
  verified: '[data-testid="icon-verified"]',
  followers: 'a[href$="/verified_followers"], a[href$="/followers"]',
  quote: 'div[role="link"]',
  challenge:
    'iframe[src*="arkoselabs"], iframe[src*="recaptcha"], #challenge_form, [data-testid="ocfEnterTextTextInput"]',
  loginButton: '[data-testid="loginButton"]',
};

export const BLOCKED_FIRST_SEGMENTS = new Set([
  'messages',
  'notifications',
  'settings',
  'compose',
  'account',
  'login',
  'logout',
]);

/** `/i/<x>` routes that are private surfaces. */
export const BLOCKED_I_SEGMENTS = new Set(['chat', 'flow', 'notifications', 'bookmarks', 'premium_sign_up', 'jf']);

/** First path segments that are routes, not account handles. */
export const RESERVED = new Set([
  'home', 'explore', 'search', 'i', 'hashtag', 'lists', 'topics', 'tos', 'privacy', 'about', 'jobs',
  'communities', 'following', 'followers', 'bookmarks', ...BLOCKED_FIRST_SEGMENTS,
]);

export const PROFILE_TABS = new Set(['with_replies', 'media', 'highlights', 'articles', 'likes']);
