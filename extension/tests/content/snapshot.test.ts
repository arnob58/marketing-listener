import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import '../../src/adapters';
import { getAdapterForUrl } from '../../src/adapters';
import { PERMISSIONS } from '../../src/manifest';
import { handleSnapshotCommand, snapshotHtml } from '../../src/content/snapshot';
import { snapshotFileName } from '../../src/ui/shared/format';

const PAGE = `<html><head><title>t</title><style>.a{}</style><link rel="stylesheet" href="x.css"><script>var secret=1</script></head>
<body><article><svg aria-label="Like" role="img"><path d="M1 2 L3 4 ${'0'.repeat(500)}"/></svg><span>1,234</span>
<img src="data:image/png;base64,${'A'.repeat(2000)}"><img src="https://cdn.example/a.jpg"><noscript>x</noscript></article></body></html>`;

function doc(url: string): Document {
  const win = new Window({ url });
  win.document.write(PAGE);
  return win.document as unknown as Document;
}

describe('page snapshot', () => {
  it('drops scripts, styles, path data and inline images but keeps aria-labels and text', () => {
    const html = snapshotHtml(doc('https://www.instagram.com/'));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('stylesheet');
    expect(html).not.toContain('M1 2');
    expect(html).not.toContain('AAAA');
    expect(html).toContain('aria-label="Like"');
    expect(html).toContain('1,234');
    expect(html).toContain('https://cdn.example/a.jpg');
    expect(html.length).toBeLessThan(600);
  });

  it('records the page URL so a fixture knows its surface (single-page apps keep the first URL in <head>)', () => {
    const html = snapshotHtml(doc('https://www.instagram.com/reels/abc/'), 'https://www.instagram.com/reels/abc/');
    expect(html).toContain('name="fixture-url"');
    expect(html).toContain('content="https://www.instagram.com/reels/abc/"');
  });

  it('does not modify the live page', () => {
    const d = doc('https://x.com/home');
    snapshotHtml(d);
    expect(d.querySelector('script')).not.toBeNull();
    expect(d.querySelector('path')?.getAttribute('d')).toContain('M1 2');
  });

  it('replies with the html on a normal surface and refuses private ones', () => {
    const ok = handleSnapshotCommand(getAdapterForUrl('https://www.instagram.com/')!, doc('https://www.instagram.com/'), 'https://www.instagram.com/');
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.html).toContain('<article>');
    for (const url of ['https://www.instagram.com/direct/inbox/', 'https://x.com/messages', 'https://www.facebook.com/messages/t/1']) {
      expect(handleSnapshotCommand(getAdapterForUrl(url)!, doc(url), url)).toMatchObject({ ok: false });
    }
  });

  it('names the file <platform>-<surface>-<iso>.html and needs no new permission', () => {
    expect(snapshotFileName('instagram', 'feed', Date.UTC(2026, 9, 28, 4, 49, 26, 270))).toBe('instagram-feed-2026-10-28T04-49-26-270Z.html');
    expect(snapshotFileName('x', '', 0)).toMatch(/^x-page-1970-01-01T00-00-00-000Z\.html$/);
    expect([...PERMISSIONS].sort()).toEqual(['alarms', 'offscreen', 'sidePanel', 'storage', 'unlimitedStorage']);
  });
});
