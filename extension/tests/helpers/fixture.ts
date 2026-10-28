import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import type { Platform } from '../../src/core/types';

const ROOT = join(__dirname, '..', 'fixtures');
const DIR: Record<Platform, string> = { x: 'x', instagram: 'instagram', facebook: 'facebook' };

export interface LoadedFixture<E = any> {
  doc: Document;
  url: string;
  expected: E | null;
}

/** Reads the fixture-url meta tag regardless of attribute order. */
export function fixtureUrl(html: string): string {
  const tag = html.match(/<meta[^>]*name="fixture-url"[^>]*>/)?.[0] ?? '';
  return (tag.match(/content="([^"]*)"/)?.[1] ?? 'about:blank').replace(/&amp;/g, '&');
}

export function loadFixture<E = any>(platform: Platform, name: string): LoadedFixture<E> {
  const html = readFileSync(join(ROOT, DIR[platform], `${name}.html`), 'utf-8');
  const url = fixtureUrl(html);
  // A dedicated window per fixture keeps pages isolated and never loads iframes or scripts.
  const win = new Window({
    url,
    settings: { disableIframePageLoading: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  win.document.write(html);
  const doc = win.document as unknown as Document;
  let expected: E | null = null;
  try {
    expected = JSON.parse(readFileSync(join(ROOT, DIR[platform], `${name}.expected.json`), 'utf-8'));
  } catch {
    expected = null;
  }
  return { doc, url, expected };
}
