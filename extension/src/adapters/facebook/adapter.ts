import { parseCount } from '../../core/metrics';
import type { Metric, ProfileInfo, RawPost, Surface } from '../../core/types';
import type { PlatformAdapter } from '../PlatformAdapter';
import {
  countBeforeWord,
  extractHashtags,
  newResolved,
  normText,
  parseRelativeTime,
  pathSegments,
} from '../shared';
import {
  BLOCKED_FIRST_SEGMENTS,
  NON_PROFILE_SEGMENTS,
  PERMALINK_ANCHOR,
  PROFILE_TABS,
  RESERVED,
  SEL,
  VERSION,
} from './selectors';

const HOST = /^(www\.|m\.|web\.)?facebook\.com$/i;
const BASE = 'https://www.facebook.com';
/** Stored when no valid handle could be read; resolved.author is false for these posts. */
const UNKNOWN_AUTHOR = 'unknown';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

interface PermalinkRef {
  postId: string;
  url: string;
}

function parsePermalink(href: string): PermalinkRef | null {
  let u: URL;
  try {
    u = new URL(href, BASE);
  } catch {
    return null;
  }
  const path = u.pathname;
  const q = u.searchParams;
  let postId: string | null = null;
  const storyFbid = q.get('story_fbid');
  if (storyFbid) {
    postId = storyFbid;
    return { postId, url: `${BASE}${path}?story_fbid=${storyFbid}${q.get('id') ? `&id=${q.get('id')}` : ''}` };
  }
  const fbid = q.get('fbid');
  if (fbid) return { postId: fbid, url: `${BASE}${path}?fbid=${fbid}` };
  const m = path.match(/\/(?:posts|permalink|videos|reel)\/([\w-]+)/);
  if (m) {
    postId = m[1];
    return { postId, url: `${BASE}${path.replace(/\/$/, '')}/` };
  }
  return null;
}

function handleFromHref(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, BASE);
  } catch {
    return null;
  }
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg[0] === 'profile.php') {
    const id = u.searchParams.get('id');
    return id ? `id${id}` : null;
  }
  if (seg[0] === 'groups' && seg[2] === 'user' && seg[3]) return `id${seg[3]}`;
  const first = seg[0]?.toLowerCase();
  // A page word such as "groups", "photo" or "watch" is not a person; refusing it beats storing a bogus author.
  return first && !RESERVED.has(first) ? first : null;
}

function parseFacebookTime(anchor: Element, now: number): number | null {
  const label = anchor.getAttribute('aria-label');
  if (label) {
    const abs = Date.parse(label);
    if (Number.isFinite(abs)) return abs;
  }
  const text = normText(anchor.textContent);
  const rel = parseRelativeTime(text, now);
  if (rel !== null) return rel;
  if (/^just now$/i.test(text)) return now;
  return null;
}

function metricFromSpans(article: Element, word: RegExp): Metric | null {
  for (const s of article.querySelectorAll('span')) {
    const t = normText(s.textContent);
    if (t.length < 24 && new RegExp(`^[\\d.,\\s]+[kmb]?\\s*${word.source}$`, 'i').test(t)) {
      return countBeforeWord(t, word);
    }
  }
  return null;
}

export const facebookAdapter: PlatformAdapter = {
  id: 'facebook',
  selectorVersion: VERSION,

  matches: (url) => HOST.test(hostOf(url)),

  surface(url): Surface {
    const seg = pathSegments(url).map((s) => s.toLowerCase());
    if (!seg.length) return 'feed';
    const first = seg[0];
    if (BLOCKED_FIRST_SEGMENTS.has(first)) return 'blocked';
    if (first === 'marketplace' && seg.includes('checkout')) return 'blocked';
    if (first === 'watch') return 'explore';
    if (first === 'search') return 'search';
    if (first === 'groups') {
      if (seg[1] === 'feed' || seg.length <= 2) return 'feed';
      return seg[2] === 'posts' || seg[2] === 'permalink' ? 'post' : 'other';
    }
    if (['permalink.php', 'story.php', 'photo', 'photo.php', 'reel'].includes(first)) return 'post';
    if (first === 'profile.php') return 'profile';
    if (NON_PROFILE_SEGMENTS.has(first)) return 'other';
    if (seg[1] === 'posts' || seg[1] === 'videos') return seg[2] ? 'post' : 'profile';
    if (seg.length === 1 || PROFILE_TABS.has(seg[1])) return 'profile';
    return 'other';
  },

  findPostRoots(node) {
    return [...node.querySelectorAll(SEL.post)].filter((a) => {
      if (a.parentElement?.closest(SEL.post)) return false;
      const label = (a.getAttribute('aria-label') ?? '').toLowerCase();
      return !label.startsWith('comment') && !label.startsWith('reply');
    });
  },

  extractPost(el, ctx): RawPost | null {
    const resolved = newResolved();
    // A group name link can precede the poster's own link, so take the first link that names a person.
    let authorLink: Element | null = null;
    let handle: string | null = null;
    for (const a of el.querySelectorAll(SEL.author)) {
      handle = handleFromHref(a.getAttribute('href') ?? '');
      if (handle) {
        authorLink = a;
        break;
      }
    }

    let ref: PermalinkRef | null = null;
    let stamp: Element | null = null;
    for (const a of el.querySelectorAll(PERMALINK_ANCHOR)) {
      const parsed = parsePermalink(a.getAttribute('href') ?? '');
      if (!parsed) continue;
      if (!ref) {
        ref = parsed;
        stamp = a;
      }
      if (normText(a.textContent) && !stamp?.textContent?.trim()) stamp = a;
    }
    if (!ref) return null;
    resolved.author = handle !== null;
    resolved.url = true;

    const messageEl = el.querySelector(SEL.message);
    const text = normText(messageEl?.textContent);
    resolved.text = Boolean(messageEl);

    const postedAt = stamp ? parseFacebookTime(stamp, ctx.now) : null;
    resolved.timestamp = postedAt !== null;

    const header = el.querySelector(SEL.header);
    const imageUrls = [...el.querySelectorAll(SEL.media)]
      .filter((i) => !header?.contains(i) && !i.closest('svg'))
      .map((i) => i.getAttribute('src') ?? '')
      .filter(Boolean);
    resolved.media = true;

    const reactions = el.querySelector(SEL.reactions);
    const metrics = {
      likes: reactions ? parseCount(normText(reactions.textContent)) : null,
      comments: metricFromSpans(el, /comments?/),
      shares: metricFromSpans(el, /shares?/),
      views: null,
    };
    resolved.metrics = metrics.likes !== null || metrics.comments !== null;

    const shared = /\bshared\b/i.test(normText(header?.textContent));

    return {
      platform: 'facebook',
      postId: ref.postId,
      url: ref.url,
      authorHandle: handle ?? UNKNOWN_AUTHOR,
      authorName: normText(authorLink?.textContent) || null,
      text,
      hashtags: extractHashtags(text),
      postedAt,
      imageUrls,
      hasVideo: Boolean(el.querySelector('video')) || ref.url.includes('/videos/') || ref.url.includes('/reel/'),
      metrics,
      audio: null,
      surface: facebookAdapter.surface(ctx.url),
      kind: shared ? 'quote' : 'original',
      refPostId: null,
      repostedBy: null,
      resolved,
      selectorVersion: VERSION,
    };
  },

  extractProfile(doc, url): ProfileInfo | null {
    if (this.surface(url) !== 'profile') return null;
    const handle = handleFromHref(url);
    const nameEl = doc.querySelector(SEL.profileName);
    if (!handle || !nameEl) return null;
    let followers: Metric | null = null;
    for (const a of doc.querySelectorAll('a, span')) {
      const t = normText(a.textContent);
      if (t.length < 30 && /followers?$/i.test(t)) {
        followers = countBeforeWord(t, /followers?/);
        if (followers) break;
      }
    }
    return {
      platform: 'facebook',
      handle,
      displayName: normText(nameEl.textContent) || null,
      followers,
      verified: Boolean(doc.querySelector(SEL.verified)),
    };
  },

  isChallengePage(doc, url) {
    const first = pathSegments(url)[0]?.toLowerCase();
    if (first === 'checkpoint' || first === 'login' || first === 'recover') return true;
    return Boolean(doc.querySelector(SEL.challenge));
  },
};
