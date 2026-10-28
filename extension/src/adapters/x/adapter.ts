import { parseCount } from '../../core/metrics';
import type { Metric, ProfileInfo, RawPost, Surface } from '../../core/types';
import type { PlatformAdapter } from '../PlatformAdapter';
import { countFromText, extractHashtags, newResolved, normText, pathSegments } from '../shared';
import { BLOCKED_FIRST_SEGMENTS, BLOCKED_I_SEGMENTS, PROFILE_TABS, RESERVED, SEL, VERSION } from './selectors';

const HOST = /^(www\.|mobile\.)?(x|twitter)\.com$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Text of a node, keeping alt text for emoji rendered as images. */
function textWithAlt(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.tagName === 'IMG') out += e.getAttribute('alt') ?? '';
      else e.childNodes.forEach(walk);
    }
  };
  walk(el);
  return normText(out);
}

function quoteContainer(article: Element): Element | null {
  for (const c of article.querySelectorAll(SEL.quote)) {
    if (c.querySelector(SEL.userName)) return c;
  }
  return null;
}

const outside = (el: Element, container: Element | null) => !container || !container.contains(el);

function statusRef(a: Element | null): { handle: string; id: string } | null {
  const m = a?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  return m ? { handle: m[1], id: m[2] } : null;
}

/** X hides zero counts, so an existing button with no text means 0. */
function buttonCount(article: Element, selector: string): Metric | null {
  const btn = article.querySelector(selector);
  if (!btn) return null;
  const txt = normText(btn.textContent);
  return parseCount(txt || '0');
}

export const xAdapter: PlatformAdapter = {
  id: 'x',
  selectorVersion: VERSION,

  matches: (url) => HOST.test(hostOf(url)),

  surface(url): Surface {
    const seg = pathSegments(url);
    if (!seg.length) return 'feed';
    const first = seg[0].toLowerCase();
    if (BLOCKED_FIRST_SEGMENTS.has(first)) return 'blocked';
    if (first === 'i' && BLOCKED_I_SEGMENTS.has((seg[1] ?? '').toLowerCase())) return 'blocked';
    if (first === 'home') return 'feed';
    if (first === 'explore') return 'explore';
    if (first === 'search') return 'search';
    if (RESERVED.has(first)) return 'other';
    if (seg[1] === 'status') return 'post';
    if (seg.length === 1 || PROFILE_TABS.has(seg[1])) return 'profile';
    return 'other';
  },

  findPostRoots(node) {
    return [...node.querySelectorAll(SEL.post)].filter(
      (a) => !a.querySelector(SEL.ad) && !a.parentElement?.closest(SEL.post),
    );
  },

  extractPost(el, ctx): RawPost | null {
    const resolved = newResolved();
    const quote = quoteContainer(el);

    const userBlock = [...el.querySelectorAll(SEL.userName)].find((u) => outside(u, quote)) ?? null;
    const timeEl = [...el.querySelectorAll('time')].find((t) => outside(t, quote)) ?? null;
    const ref = statusRef(timeEl?.closest('a') ?? null);

    const authorLink = userBlock?.querySelector('a[href^="/"]') ?? null;
    const handle = (authorLink?.getAttribute('href') ?? '').split('/')[1] || ref?.handle || '';
    if (!ref || !handle) return null;
    resolved.author = true;
    resolved.url = true;
    const authorName = authorLink ? normText(authorLink.textContent) || null : null;

    const textEl = [...el.querySelectorAll(SEL.text)].find((t) => outside(t, quote)) ?? null;
    const text = textEl ? textWithAlt(textEl) : '';
    resolved.text = Boolean(textEl);

    const dt = timeEl?.getAttribute('datetime');
    const postedAt = dt ? Date.parse(dt) : NaN;
    resolved.timestamp = Number.isFinite(postedAt);

    const imageUrls = [...el.querySelectorAll(SEL.photo)]
      .filter((i) => outside(i, quote))
      .map((i) => i.getAttribute('src') ?? '')
      .filter(Boolean);
    const poster = [...el.querySelectorAll(SEL.videoPoster)]
      .find((v) => outside(v, quote))
      ?.getAttribute('poster');
    if (poster) imageUrls.push(poster);
    resolved.media = true;

    const viewsEl = el.querySelector(SEL.views);
    const metrics = {
      comments: buttonCount(el, SEL.reply),
      shares: buttonCount(el, SEL.repost),
      likes: buttonCount(el, SEL.like),
      views: viewsEl ? countFromText(viewsEl) : null,
    };
    resolved.metrics = metrics.likes !== null && metrics.shares !== null;

    let kind: RawPost['kind'] = 'original';
    let refPostId: string | null = null;
    let repostedBy: string | null = null;
    const social = el.querySelector(SEL.social);
    // A repost banner sits on the original post, so the author stays the original author.
    if (social && /repost/i.test(social.textContent ?? '')) {
      repostedBy = social.querySelector('a[href^="/"]')?.getAttribute('href')?.split('/')[1]?.toLowerCase() ?? 'unknown';
    } else if (quote) {
      const qRef = statusRef(quote.querySelector('time')?.closest('a') ?? null);
      if (qRef) {
        kind = 'quote';
        refPostId = qRef.id;
      }
    }

    return {
      platform: 'x',
      postId: ref.id,
      url: `https://x.com/${ref.handle}/status/${ref.id}`,
      authorHandle: handle.toLowerCase(),
      authorName,
      text,
      hashtags: extractHashtags(text),
      postedAt: resolved.timestamp ? postedAt : null,
      imageUrls,
      hasVideo: Boolean(el.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]')),
      metrics,
      audio: null,
      surface: xAdapter.surface(ctx.url),
      kind,
      refPostId,
      repostedBy,
      resolved,
      selectorVersion: VERSION,
    };
  },

  extractProfile(doc, url): ProfileInfo | null {
    if (this.surface(url) !== 'profile') return null;
    const block = doc.querySelector(SEL.profileUserName);
    const handle = pathSegments(url)[0]?.toLowerCase();
    if (!block || !handle) return null;
    const followersEl = doc.querySelector(SEL.followers);
    const m = normText(followersEl?.textContent).match(/^([\d.,\s]+\s?[kmb]?)\s*followers?/i);
    return {
      platform: 'x',
      handle,
      displayName: normText(block.querySelector('span')?.textContent) || null,
      followers: m ? parseCount(m[1]) : null,
      verified: Boolean(block.querySelector(SEL.verified)),
    };
  },

  isChallengePage(doc, url) {
    const seg = pathSegments(url);
    if (seg[0] === 'i' && seg[1] === 'flow') return true;
    if (seg[0] === 'login' || seg[0] === 'account') return true;
    return Boolean(doc.querySelector(SEL.challenge) || doc.querySelector(SEL.loginButton));
  },
};
