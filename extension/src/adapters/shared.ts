import { emptyMetrics, parseCount } from '../core/metrics';
import type { ExtractedField, Metric, PostMetrics } from '../core/types';

export const normText = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

export function extractHashtags(text: string): string[] {
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((t) => t.slice(1).toLowerCase()))];
}

export function newResolved(): Record<ExtractedField, boolean> {
  return { author: false, text: false, timestamp: false, url: false, metrics: false, media: false };
}

export function blankMetrics(): PostMetrics {
  return emptyMetrics();
}

export function countFromText(el: Element | null): Metric | null {
  return el ? parseCount(normText(el.textContent)) : null;
}

/** Pulls "<count> <word>" out of free text such as "View all 45 comments". */
export function countBeforeWord(text: string, word: RegExp): Metric | null {
  const pattern = String.raw`(\d[\d.,\s]*\s?(?:[kmb]|thousand|million)?)\s*` + word.source;
  const m = normText(text).match(new RegExp(pattern, 'i'));
  return m ? parseCount(m[1]) : null;
}

export function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolves relative stamps like "2h", "5m", "3 hrs", "1d" against `now`. */
export function parseRelativeTime(text: string, now: number): number | null {
  const m = normText(text).toLowerCase().match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|w)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms =
    unit.startsWith('s') ? 1e3 : unit.startsWith('m') ? 6e4 : unit.startsWith('h') ? 36e5 : unit === 'd' ? 864e5 : 6048e5;
  return now - n * ms;
}

/** Text of a node without anything inside <svg> (icon titles would otherwise read as words). */
function textOutsideSvg(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 || (node as Element).tagName.toLowerCase() === 'svg') return '';
  return [...node.childNodes].map(textOutsideSvg).join(' ');
}

/** A node's text only when it is nothing but a count: "1,234", "12K", "3.4M". */
function pureCount(node: Element): Metric | null {
  const t = normText(textOutsideSvg(node));
  return t.length <= 12 ? parseCount(t) : null;
}

const hasOtherControl = (el: Element) => Boolean(el.querySelector('svg[aria-label], button, [role="button"]'));

/**
 * Reads the number shown beside an action icon (Like, Comment, Share ...). Instagram and
 * Facebook render these as an `svg[aria-label]` inside a button with the count in the button
 * or in the next element. A neighbour that holds another control is never read, so one
 * icon's count is not mistaken for the next one's.
 */
export function countNearIcon(root: ParentNode, ariaLabels: string[]): Metric | null {
  const wanted = new Set(ariaLabels.map((l) => l.toLowerCase()));
  for (const icon of root.querySelectorAll('svg[aria-label]')) {
    if (!wanted.has((icon.getAttribute('aria-label') ?? '').toLowerCase())) continue;
    const control = icon.closest('button, [role="button"], a') ?? icon;
    const inside = pureCount(control);
    if (inside) return inside;
    let node: Element | null = control;
    for (let depth = 0; node && node !== root && depth < 3; depth++, node = node.parentElement) {
      const next: Element | null = node.nextElementSibling;
      if (next && !hasOtherControl(next)) {
        const m = pureCount(next);
        if (m) return m;
      }
    }
  }
  return null;
}
