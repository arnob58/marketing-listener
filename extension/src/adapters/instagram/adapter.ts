import { parseCount } from '../../core/metrics';
import type { Metric, PostAudio, ProfileInfo, RawPost, Surface } from '../../core/types';
import type { PlatformAdapter } from '../PlatformAdapter';
import { countBeforeWord, countNearIcon, extractHashtags, newResolved, normText, pathSegments } from '../shared';
import { BLOCKED_FIRST_SEGMENTS, ICON, PROFILE_TABS, RESERVED, SEL, VERSION } from './selectors';

const HOST = /^(www\.)?instagram\.com$/i;
const POST_PATH = /\/(p|reels?|tv)\/([\w-]+)/;
const PROFILE_HREF = /^\/([\w.]{1,30})\/(?:reels\/)?(?:\?.*)?$/;
const AUDIO_ID = /\/reels\/audio\/(\d+)/;
const COUNT_ONLY = /^[\d.,\s]+[kmb]?$/i;
const NOISE_ONLY = /^[•·\-–|.]+$/;
/** The reels viewer nests a reel about 15 levels deep; the climb from its <video> is bounded. */
const MAX_CLIMB = 24;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

interface PostRef {
  id: string;
  /** /reel/, /reels/ or /tv/ rather than /p/. */
  reel: boolean;
}

function postRef(href: string | null | undefined): PostRef | null {
  const m = href?.match(POST_PATH);
  // "/reels/audio/<id>/" is the sound page, not a reel.
  if (!m || m[2] === 'audio') return null;
  return { id: m[2], reel: m[1] !== 'p' };
}

/** The reels viewer swaps reels in place under /reels/<code>/; the sound page /reels/audio/<id>/ is not it. */
export function isReelsViewer(url: string): boolean {
  const seg = pathSegments(url);
  return seg[0]?.toLowerCase() === 'reels' && seg[1]?.toLowerCase() !== 'audio';
}

/** The post a single-post or reels-viewer URL points at: /reels/<c>/, /p/<c>/, /reel/<c>/ or /<handle>/p/<c>/. */
function pathRef(url: string): PostRef | null {
  const seg = pathSegments(url).map((s) => s.toLowerCase());
  const at = ['p', 'reel', 'reels', 'tv'].includes(seg[0]) ? 0 : ['p', 'reel'].includes(seg[1]) ? 1 : -1;
  const raw = pathSegments(url);
  if (at < 0 || !raw[at + 1] || seg[at + 1] === 'audio') return null;
  return { id: raw[at + 1], reel: seg[at] !== 'p' };
}

function hasPostLink(root: Element): boolean {
  for (const a of root.querySelectorAll(SEL.postLink)) if (postRef(a.getAttribute('href'))) return true;
  return false;
}

/** Text without icon titles; separate nodes are joined by spaces so "Artist" and "Song" do not run together. */
function spacedText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 || (node as Element).tagName.toLowerCase() === 'svg') return '';
  return [...node.childNodes].map(spacedText).join(' ');
}

/** Caption text: icons and inline buttons ("more") are left out and line breaks become spaces. */
function captionText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'svg' || el.getAttribute('role') === 'button') return '';
  if (tag === 'br') return ' ';
  return [...el.childNodes].map(captionText).join('');
}

/**
 * A reel in the viewer is the highest ancestor of its <video> that still holds only that one
 * video and contains the action bar (the Like icon). Videos inside an <article> belong to that post.
 */
function reelContainers(node: ParentNode): Element[] {
  const out: Element[] = [];
  for (const video of node.querySelectorAll('video')) {
    if (video.closest(SEL.post)) continue;
    let found: Element | null = null;
    let el = video.parentElement;
    for (let depth = 0; el && depth < MAX_CLIMB && el.tagName !== 'BODY' && el.tagName !== 'MAIN'; depth++, el = el.parentElement) {
      if (el.querySelectorAll('video').length > 1) break;
      if (el.querySelector(SEL.likeIcon)) found = el;
    }
    if (found && !out.includes(found)) out.push(found);
  }
  return out;
}

/** The reel in view. Without layout (tests, hidden tabs) every reel counts as in view. */
function isInView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const vh = el.ownerDocument.defaultView?.innerHeight ?? 0;
  if ((!r.width && !r.height) || !vh) return true;
  const mid = (r.top + r.bottom) / 2;
  return mid >= 0 && mid <= vh;
}

function findAuthor(root: Element): { handle: string; name: string | null } | null {
  const header = root.querySelector(SEL.header);
  for (const scope of header ? [header, root] : [root]) {
    for (const a of scope.querySelectorAll('a[href^="/"]')) {
      const m = a.getAttribute('href')?.match(PROFILE_HREF);
      if (m && !RESERVED.has(m[1].toLowerCase())) return { handle: m[1].toLowerCase(), name: null };
    }
  }
  return null;
}

function findCaption(root: Element, handle: string): string {
  const header = root.querySelector(SEL.header);
  let best = '';
  for (const el of root.querySelectorAll(SEL.caption)) {
    if (header?.contains(el) || el.closest('a')) continue;
    // Wrappers of the author line, location, sound and media are not the caption.
    if (el.querySelector('time, svg, img, video, a[href*="/reels/audio/"], a[href*="/explore/locations/"]')) continue;
    let text = normText(captionText(el)).replace(/\s*(?:…|\.{3})\s*(?:more)?$/i, '');
    if (text.toLowerCase().startsWith(handle)) text = normText(text.slice(handle.length));
    if (!text || text.toLowerCase() === handle || COUNT_ONLY.test(text) || NOISE_ONLY.test(text)) continue;
    if (text.length > best.length) best = text;
  }
  return best;
}

function findAudio(root: Element): PostAudio | null {
  let id: string | null = null;
  let title = '';
  for (const a of root.querySelectorAll(SEL.audioLink)) {
    id ??= a.getAttribute('href')?.match(AUDIO_ID)?.[1] ?? null;
    const t = normText(spacedText(a));
    if (t.length > title.length) title = t;
  }
  if (!id && !title) return null;
  return { id, title, isOriginal: /original audio/i.test(title) };
}

function findLikes(root: Element): Metric | null {
  const near = countNearIcon(root, ICON.likes);
  if (near) return near;
  const link = root.querySelector(SEL.likesLink);
  if (link) return countBeforeWord(link.textContent ?? '', /likes?/);
  for (const s of root.querySelectorAll('section span')) {
    const m = countBeforeWord(s.textContent ?? '', /likes?\b/);
    if (m) return m;
  }
  return null; // "Liked by x and others" or hidden likes
}

function findComments(root: Element): Metric | null {
  const near = countNearIcon(root, ICON.comments);
  if (near) return near;
  for (const a of root.querySelectorAll(SEL.commentsLink)) {
    const m = countBeforeWord(a.textContent ?? '', /comments?/);
    if (m) return m;
  }
  return null;
}

function findViews(root: Element): Metric | null {
  for (const s of root.querySelectorAll('span')) {
    const t = normText(s.textContent);
    if (t.length < 24 && /\b(plays?|views?)$/i.test(t)) return countBeforeWord(t, /(?:plays?|views?)/);
  }
  return null;
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  selectorVersion: VERSION,

  matches: (url) => HOST.test(hostOf(url)),

  surface(url): Surface {
    const seg = pathSegments(url);
    if (!seg.length) return 'feed';
    const first = seg[0].toLowerCase();
    if (BLOCKED_FIRST_SEGMENTS.has(first)) return 'blocked';
    if (first === 'explore') return seg[1] === 'search' ? 'search' : 'explore';
    if (first === 'p' || first === 'reel' || first === 'tv') return 'post';
    if (first === 'reels') return seg[1] === 'audio' ? 'other' : 'feed';
    if (RESERVED.has(first)) return 'other';
    if (seg.length === 1 || PROFILE_TABS.has(seg[1])) return 'profile';
    if (seg[1] === 'p' || seg[1] === 'reel') return 'post';
    return 'other';
  },

  rescansOnUrlChange: isReelsViewer,

  findPostRoots(node, url) {
    const single = url !== undefined && this.surface(url) === 'post';
    const roots = [...node.querySelectorAll(SEL.post)].filter(
      // Sponsored posts carry no post link, so they drop out here, as does any article that is not a post.
      (a) => !a.parentElement?.closest(SEL.post) && (single || hasPostLink(a)),
    );
    if (url !== undefined && (single || isReelsViewer(url))) roots.push(...reelContainers(node));
    return roots;
  },

  extractPost(el, ctx): RawPost | null {
    const resolved = newResolved();
    const surface = instagramAdapter.surface(ctx.url);
    const viewer = isReelsViewer(ctx.url);
    const isArticle = el.tagName === 'ARTICLE';

    // Prefer the link that wraps the timestamp. A reel in the viewer has no link of its own,
    // so the URL names it, but only for the reel that is actually in view.
    let ref: PostRef | null = null;
    let reelLink = false;
    for (const a of el.querySelectorAll(SEL.postLink)) {
      const r = postRef(a.getAttribute('href'));
      if (!r) continue;
      if (r.reel) reelLink = true;
      if (!ref || a.querySelector('time')) ref = r;
    }
    if (!ref && (isArticle ? surface === 'post' : viewer || surface === 'post') && (isArticle || isInView(el))) {
      ref = pathRef(ctx.url);
    }
    const author = findAuthor(el);
    if (!author || !ref) return null;
    resolved.author = true;
    resolved.url = true;

    const text = findCaption(el, author.handle);
    resolved.text = text.length > 0;

    const dt = el.querySelector('time')?.getAttribute('datetime');
    const postedAt = dt ? Date.parse(dt) : NaN;
    resolved.timestamp = Number.isFinite(postedAt);

    const header = el.querySelector(SEL.header);
    const imageUrls = [...el.querySelectorAll(SEL.images)]
      .filter((i) => {
        const alt = i.getAttribute('alt') ?? '';
        return !header?.contains(i) && !/profile picture$/i.test(alt) && alt !== 'Audio image' && !i.closest(SEL.audioLink);
      })
      .map((i) => i.getAttribute('src') ?? '')
      .filter(Boolean);
    const video = el.querySelector('video');
    const poster = video?.getAttribute('poster');
    if (poster) imageUrls.push(poster);
    resolved.media = true;

    const isReel = ref.reel || reelLink;
    const metrics = {
      likes: findLikes(el),
      comments: findComments(el),
      shares: countNearIcon(el, ICON.shares),
      views: findViews(el),
    };
    resolved.metrics = metrics.likes !== null || metrics.comments !== null;

    return {
      platform: 'instagram',
      postId: ref.id,
      url: `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${ref.id}/`,
      authorHandle: author.handle,
      authorName: author.name,
      text,
      hashtags: extractHashtags(text),
      postedAt: resolved.timestamp ? postedAt : null,
      imageUrls,
      hasVideo: Boolean(video) || isReel,
      metrics,
      audio: findAudio(el),
      surface,
      kind: 'original',
      refPostId: null,
      repostedBy: null,
      resolved,
      selectorVersion: VERSION,
    };
  },

  extractProfile(doc, url): ProfileInfo | null {
    if (this.surface(url) !== 'profile') return null;
    const handle = pathSegments(url)[0]?.toLowerCase();
    if (!handle) return null;
    const og = doc.querySelector(SEL.ogDescription)?.getAttribute('content') ?? '';
    const m = og.match(/^([\d.,\s]+\s?[kmb]?)\s*followers?/i);
    const header = doc.querySelector(SEL.header);
    let followers = m ? parseCount(m[1]) : null;
    if (!followers && header) {
      // Rendered as <a><span>9,119</span> followers</a>; the og:description meta is absent after hydration.
      for (const el of header.querySelectorAll('a, li, span')) {
        const f = normText(el.textContent).match(/^([\d.,\s]+\s?[kmb]?)\s*followers?$/i);
        if (f) {
          followers = parseCount(f[1]);
          break;
        }
      }
    }
    if (!followers && !header) return null;
    // The h1/h2 on a profile is the handle itself, which is not a display name.
    const name = normText(header?.querySelector('h1, h2')?.textContent);
    return {
      platform: 'instagram',
      handle,
      displayName: name && name.toLowerCase() !== handle ? name : null,
      followers,
      verified: Boolean(header?.querySelector(SEL.verified)),
    };
  },

  isChallengePage(doc, url) {
    const first = pathSegments(url)[0]?.toLowerCase();
    if (first === 'challenge') return true;
    if (first === 'accounts' && /login|suspended|onetap|challenge/.test(url)) return true;
    return Boolean(doc.querySelector(SEL.challenge));
  },
};
