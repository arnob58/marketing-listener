import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { fixtureUrl } from '../helpers/fixture';
import { describe, expect, it } from 'vitest';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import type { Platform } from '../../src/core/types';

const PROJECT = join(__dirname, '..', '..', '..');
const TOOL = join(PROJECT, 'tools', 'sanitize_fixture.py');
const OUT = join(PROJECT, '.tmp', 'test-sanitize');
const FIXTURES = join(__dirname, '..', 'fixtures');

function python(): string | null {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['-c', 'import bs4'], { encoding: 'utf-8' });
    if (r.status === 0) return cmd;
  }
  return null;
}
const PY = python();

describe.skipIf(!PY || !existsSync(TOOL))('tools/sanitize_fixture.py', () => {
  const sanitize = (platform: Platform, name: string, extra: string[] = []) => {
    mkdirSync(OUT, { recursive: true });
    const input = join(FIXTURES, platform, `${name}.html`);
    const out = join(OUT, `${platform}-${name}.html`);
    const url = fixtureUrl(readFileSync(input, 'utf-8'));
    const r = spawnSync(PY!, ['-I', TOOL, input, '--platform', platform, '--url', url, '--out', out, ...extra], { encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    return { html: readFileSync(out, 'utf-8'), original: readFileSync(input, 'utf-8'), url };
  };

  const extract = (html: string, now: number) => {
    const url = fixtureUrl(html);
    const win = new Window({ url, settings: { disableIframePageLoading: true } });
    win.document.write(html);
    return collectPosts(getAdapterForUrl(url)!, win.document as unknown as Document, { url, now });
  };

  it.each([
    ['x', ['alder_fox', 'bluebird_lab', 'citrus_daily', 'Alder Fox']],
    ['instagram', ['alder_fox', 'bluebird_lab', 'Alder Fox']],
    ['facebook', ['alder.fox', 'bluebird.lab', 'Alder Fox']],
  ] as Array<[Platform, string[]]>)('%s: replaces identities but keeps the structure the extractor needs', (platform, secrets) => {
    const { html, original } = sanitize(platform, 'feed');
    for (const s of secrets) {
      expect(original).toContain(s);
      expect(html.toLowerCase()).not.toContain(s.toLowerCase());
    }
    const now = JSON.parse(readFileSync(join(FIXTURES, platform, 'feed.expected.json'), 'utf-8')).now;
    const before = extract(original, now);
    const after = extract(html, now);
    expect(after).toHaveLength(before.length);
    expect(after.map((p) => p.metrics.likes?.value ?? null)).toEqual(before.map((p) => p.metrics.likes?.value ?? null));
    expect(after.map((p) => p.postedAt)).toEqual(before.map((p) => p.postedAt));
    expect(new Set(after.map((p) => p.authorHandle)).size).toBe(new Set(before.map((p) => p.authorHandle)).size);
    expect(after.every((p) => !before.some((b) => b.postId === p.postId))).toBe(true);
  });

  it('is deterministic: the same input always yields the same fakes', () => {
    expect(sanitize('x', 'feed').html).toBe(sanitize('x', 'feed').html);
  });

  it('--fake-text replaces captions and hashtags but keeps counts, aria-labels and structure', () => {
    const { html, original } = sanitize('instagram', 'feed', ['--fake-text']);
    expect(original).toContain('Morning light over the harbor');
    expect(html).not.toContain('Morning light');
    const now = JSON.parse(readFileSync(join(FIXTURES, 'instagram', 'feed.expected.json'), 'utf-8')).now;
    const before = extract(original, now);
    const after = extract(html, now);
    expect(after).toHaveLength(before.length);
    expect(after.map((p) => p.metrics.likes?.value ?? null)).toEqual(before.map((p) => p.metrics.likes?.value ?? null));
    expect(after.map((p) => p.metrics.comments?.value ?? null)).toEqual(before.map((p) => p.metrics.comments?.value ?? null));
    expect(after.map((p) => p.text.length > 0)).toEqual(before.map((p) => p.text.length > 0));
    // deterministic: the same caption always gets the same fake
    expect(sanitize('instagram', 'feed', ['--fake-text']).html).toBe(html);
  });

  it('drops scripts and styles and can redact post text', () => {
    const { html } = sanitize('x', 'feed', ['--redact-post-text']);
    expect(html).not.toMatch(/<script|<style/i);
    expect(html).not.toContain('sourdough');
    expect(html).toContain('Lorem');
  });
});
