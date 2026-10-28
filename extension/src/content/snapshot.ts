import type { PlatformAdapter } from '../adapters/PlatformAdapter';
import type { TabReply } from '../core/messages';

/**
 * Serializes the page for offline selector work. Scripts, styles and vector path data are
 * dropped to keep the file small; aria-labels, roles and text stay because selectors use them.
 */
export function snapshotHtml(doc: Document, url?: string): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  // Single-page apps keep their first URL in <head>; record the real one so fixtures know the surface.
  if (url) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'fixture-url');
    meta.setAttribute('content', url);
    root.querySelector('head')?.prepend(meta);
  }
  root.querySelectorAll('script, style, noscript, link[rel~="stylesheet"], link[rel~="preload"]').forEach((n) => n.remove());
  root.querySelectorAll('svg path[d]').forEach((p) => p.removeAttribute('d'));
  // Inline images can be megabytes of base64 and carry nothing a selector needs.
  root.querySelectorAll('[src^="data:"]').forEach((n) => n.setAttribute('src', 'data:,'));
  return `<!doctype html>\n${root.outerHTML}`;
}

/** Private surfaces are never read, not even for a diagnostic snapshot. */
export function handleSnapshotCommand(adapter: PlatformAdapter, doc: Document, url: string): TabReply {
  if (adapter.surface(url) === 'blocked') return { ok: false, reason: 'This is a private surface; no snapshot is taken here.' };
  return { ok: true, html: snapshotHtml(doc, url) };
}
