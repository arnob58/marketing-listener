import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { collectPosts, getAdapterForUrl } from '../../src/adapters';
import {
  FetchBlockedError,
  IMAGE_CDN_HOSTS,
  MODEL_HOSTS,
  PLATFORM_HOSTS,
  createGuardedFetch,
  isAllowedFetchUrl,
  isAllowedHost,
} from '../../src/net/allowlist';
import { fetchImageBytes } from '../../src/features/imageFetch';
import { CONTENT_MATCHES, HOST_PERMISSIONS, OPTIONAL_HOST_PERMISSIONS, OPTIONAL_PERMISSIONS, PERMISSIONS, buildManifest } from '../../src/manifest';
import { loadFixture } from '../helpers/fixture';

const SRC = join(__dirname, '..', '..', 'src');

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'public' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');
const read = (p: string) => readFileSync(p, 'utf-8');

describe('fetch allowlist', () => {
  const closed = { allowModelHosts: false };
  const open = { allowModelHosts: true };

  it.each([
    'https://pbs.twimg.com/media/abc?format=jpg&name=small',
    'https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/a.jpg',
    'https://scontent.fbcdn.net/v/t39/a.jpg',
    'https://scontent-lax3-1.xx.fbcdn.net/v/a.jpg',
  ])('allows CDN image %s', (url) => expect(isAllowedFetchUrl(url, closed)).toBe(true));

  it.each([
    'https://example.com/a.png',
    'https://pbs.twimg.com.evil.example/a.png',
    'https://evilpbs.twimg.com.example/a.png',
    'https://notfbcdn.net/a.png',
    'https://fbcdn.net/a.png', // wildcard hosts require a subdomain
    'http://pbs.twimg.com/a.png',
    'https://www.facebook.com/api/graphql/',
    'https://x.com/i/api/2/timeline.json',
    'https://www.instagram.com/graphql/query',
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers/dist/ort.wasm',
    'ftp://pbs.twimg.com/a',
    'not a url',
  ])('blocks %s', (url) => expect(isAllowedFetchUrl(url, open)).toBe(false));

  it('allows model hosts only after the user opted in', () => {
    const url = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx';
    expect(isAllowedFetchUrl(url, closed)).toBe(false);
    expect(isAllowedFetchUrl(url, open)).toBe(true);
    expect(isAllowedFetchUrl('https://cdn-lfs.hf.co/repos/ab/cd/file', open)).toBe(true);
    expect(isAllowedFetchUrl('https://cdn-lfs.hf.co/repos/ab/cd/file', closed)).toBe(false);
  });

  it('allows the extension\'s own files and inline data', () => {
    expect(isAllowedFetchUrl('chrome-extension://abc/ort/ort-wasm-simd-threaded.wasm', closed)).toBe(true);
    expect(isAllowedFetchUrl('blob:chrome-extension://abc/123', closed)).toBe(true);
    expect(isAllowedFetchUrl('data:image/png;base64,AAAA', closed)).toBe(true);
  });

  it('guarded fetch rejects off-list targets without calling the network', async () => {
    const inner = vi.fn(async () => new Response('ok'));
    const guarded = createGuardedFetch(inner, () => closed);
    await expect(guarded('https://evil.example/x')).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(guarded(new Request('https://api.example.com/data'))).rejects.toBeInstanceOf(FetchBlockedError);
    expect(inner).not.toHaveBeenCalled();
    await guarded('https://pbs.twimg.com/media/a');
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('every image URL the adapters extract from the fixtures passes the allowlist', async () => {
    const targets = new Set<string>();
    for (const platform of ['x', 'instagram', 'facebook'] as const) {
      const { doc, url, expected } = loadFixture(platform, 'feed');
      for (const post of collectPosts(getAdapterForUrl(url)!, doc, { url, now: expected.now })) post.imageUrls.forEach((u) => targets.add(u));
    }
    expect(targets.size).toBeGreaterThan(20);
    const seen: string[] = [];
    const inner = vi.fn(async (input: RequestInfo | URL) => (seen.push(String(input)), new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))));
    const guarded = createGuardedFetch(inner, () => closed);
    for (const u of targets) await fetchImageBytes(guarded, u);
    expect(seen).toHaveLength(targets.size);
    for (const u of seen) expect(isAllowedFetchUrl(u, closed), u).toBe(true);
  });

  it('image fetches carry no cookies or referrer', async () => {
    const inner = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' })));
    await fetchImageBytes(inner, 'https://pbs.twimg.com/a');
    expect(inner.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});

describe('source-level network audit', () => {
  const files = sourceFiles();

  it('network primitives appear only where expected', () => {
    const hits = files.flatMap((f) => {
      const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      return /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/.test(code) ? [rel(f)] : [];
    });
    expect(hits).toEqual([]);
  });

  it('no code calls the global fetch directly; the offscreen document hands it over only after installing the guard', () => {
    const direct = files
      .filter((f) => /(?<![\w.])fetch\s*\(/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
      .map(rel);
    expect(direct).toEqual([]);
    const users = files.filter((f) => /(?:globalThis\.fetch|fetchImageBytes\(fetch)/.test(read(f))).map(rel).sort();
    expect(users).toEqual(['entrypoints/offscreen/main.ts', 'features/embeddings.ts']);
    const main = read(join(SRC, 'entrypoints', 'offscreen', 'main.ts'));
    expect(main.indexOf('installGuardedFetch(')).toBeGreaterThan(-1);
    expect(main.indexOf('installGuardedFetch(')).toBeLessThan(main.indexOf('fetchImageBytes(fetch'));
  });

  it('every hard-coded URL host is a platform, CDN or model host', () => {
    const all = [...PLATFORM_HOSTS, ...IMAGE_CDN_HOSTS, ...MODEL_HOSTS, 'www.facebook.com', 'www.instagram.com'];
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1];
        if (host.startsWith('example') || host === 'localhost') continue;
        if (!isAllowedHost(host, all) && !all.some((a) => host.endsWith(a.replace('*.', '')))) offenders.push(`${rel(f)}: ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the embedding library is imported only by the embedder, which only the offscreen document constructs', () => {
    const importers = files.filter((f) => /from ['"]@huggingface\/transformers['"]|import\(['"]@huggingface\/transformers['"]\)/.test(read(f))).map(rel);
    expect(importers).toEqual(['features/embeddings.ts']);
    const constructors = files.filter((f) => /new TransformersEmbedder\(/.test(read(f))).map(rel);
    expect(constructors).toEqual(['entrypoints/offscreen/main.ts']);
  });

  it('contains no evasion or anti-detection code', () => {
    const banned = /Math\.random|navigator\.webdriver|defineProperty\(\s*navigator|userAgent\s*=|toDataURL|2captcha|anticaptcha|solveCaptcha/;
    expect(files.filter((f) => banned.test(read(f))).map(rel)).toEqual([]);
  });

  it('there is no telemetry or analytics code', () => {
    const banned = /google-analytics|gtag\(|mixpanel|sentry|segment\.com|amplitude|posthog/i;
    expect(files.filter((f) => banned.test(read(f))).map(rel)).toEqual([]);
  });
});

describe('manifest', () => {
  const m = buildManifest();

  it('requests exactly the documented permissions', () => {
    expect([...m.permissions].sort()).toEqual(['alarms', 'offscreen', 'sidePanel', 'storage', 'unlimitedStorage']);
    expect(PERMISSIONS).toEqual(m.permissions);
    for (const forbidden of ['tabs', 'activeTab', 'cookies', 'webRequest', 'history', 'downloads', 'scripting', 'declarativeNetRequest', 'identity']) {
      expect(m.permissions).not.toContain(forbidden);
    }
  });

  it('downloads is an optional permission only, never required', () => {
    expect(m.optional_permissions).toEqual(['downloads']);
    expect(OPTIONAL_PERMISSIONS).toEqual(['downloads']);
    expect(m.permissions).not.toContain('downloads');
  });

  it('host access is limited to the three platforms and their image CDNs', () => {
    expect(HOST_PERMISSIONS).toEqual([...CONTENT_MATCHES, 'https://pbs.twimg.com/*', 'https://*.cdninstagram.com/*', 'https://*.fbcdn.net/*']);
    for (const p of [...HOST_PERMISSIONS, ...OPTIONAL_HOST_PERMISSIONS]) {
      expect(p.startsWith('https://')).toBe(true);
      expect(p).not.toMatch(/<all_urls>|\*:\/\/\*\//);
    }
  });

  it('the model host is optional, never granted at install', () => {
    expect(m.host_permissions.some((h) => /huggingface|hf\.co/.test(h))).toBe(false);
    expect(m.optional_host_permissions).toEqual(['https://huggingface.co/*', 'https://*.huggingface.co/*', 'https://*.hf.co/*']);
  });

  it('content scripts run only on the three platforms', () => {
    expect(CONTENT_MATCHES).toEqual(['https://*.facebook.com/*', 'https://*.instagram.com/*', 'https://x.com/*', 'https://twitter.com/*']);
  });

  it('keeps the host lists in step with the fetch allowlist', () => {
    for (const h of IMAGE_CDN_HOSTS) expect(HOST_PERMISSIONS).toContain(`https://${h}/*`);
    for (const h of MODEL_HOSTS) expect(OPTIONAL_HOST_PERMISSIONS).toContain(`https://${h}/*`);
  });

  const built = join(__dirname, '..', '..', '.output', 'chrome-mv3', 'manifest.json');
  it.skipIf(!existsSync(built))('the built manifest matches (run `npm run build` first)', () => {
    const b = JSON.parse(readFileSync(built, 'utf-8'));
    expect([...b.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect(b.optional_permissions).toEqual(['downloads']);
    expect(b.host_permissions).toEqual(HOST_PERMISSIONS);
    expect(b.optional_host_permissions).toEqual(OPTIONAL_HOST_PERMISSIONS);
    expect(b.content_scripts).toHaveLength(1);
    expect([...b.content_scripts[0].matches].sort()).toEqual([...CONTENT_MATCHES].sort());
    expect(b.manifest_version).toBe(3);
    expect(b.side_panel.default_path).toBe('sidepanel.html');
    expect(JSON.stringify(b)).not.toMatch(/externally_connectable|web_accessible_resources|<all_urls>/);
  });
});
