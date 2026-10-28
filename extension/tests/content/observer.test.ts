import { describe, expect, it } from 'vitest';
import '../../src/adapters';
import { getAdapterForUrl } from '../../src/adapters';
import { PostObserver, type ObserverEnv, type VisibilityEntry } from '../../src/content/observer';
import { sampleProfile } from '../../src/content/baseline';
import type { RawPost } from '../../src/core/types';
import { loadFixture } from '../helpers/fixture';

function harness(fixtureName = 'feed', platform: 'x' | 'instagram' | 'facebook' = 'x', urlOverride?: string) {
  const { doc, url: fixtureUrl, expected } = loadFixture(platform, fixtureName);
  const url = urlOverride ?? fixtureUrl;
  const adapter = getAdapterForUrl(url)!;
  let now = expected?.now ?? 1_700_000_000_000;
  let ioCb: (e: VisibilityEntry[]) => void = () => {};
  let moCb: (n: Node[]) => void = () => {};
  const observed = new Set<Element>();
  const idle: Array<() => void> = [];
  const emitted: RawPost[][] = [];

  const env: ObserverEnv = {
    getUrl: () => url,
    now: () => now,
    createIntersectionObserver: (cb) => ((ioCb = cb), { observe: (el) => observed.add(el), unobserve: (el) => observed.delete(el), disconnect: () => observed.clear() }),
    createMutationObserver: (cb) => ((moCb = cb), { observe: () => {}, disconnect: () => {} }),
    schedule: (cb) => void idle.push(cb),
  };
  const observer = new PostObserver(adapter, doc, env, (p) => emitted.push(p));
  const show = (els: Element[], ratio = 0.8) =>
    ioCb(els.map((target) => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio })));
  const runIdle = () => idle.splice(0).forEach((cb) => cb());
  return { expected, observer, doc, observed, show, runIdle, emitted, advance: (ms: number) => (now += ms), mutate: (n: Node[]) => moCb(n), adapter };
}

describe('PostObserver', () => {
  it('tracks post roots but extracts nothing until they are at least half visible', () => {
    const h = harness();
    h.observer.start();
    expect(h.observed.size).toBe(h.expected.rootCount);
    h.runIdle();
    expect(h.emitted).toHaveLength(0);

    const [first, second] = [...h.observed];
    h.show([first], 0.3);
    h.runIdle();
    expect(h.emitted).toHaveLength(0);

    h.show([first, second], 0.5);
    h.runIdle();
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toHaveLength(2);
  });

  it('batches visible posts into one idle callback', () => {
    const h = harness();
    h.observer.start();
    const els = [...h.observed];
    h.show(els.slice(0, 3));
    h.show(els.slice(3, 6));
    h.runIdle();
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toHaveLength(6);
  });

  it('does not re-emit a post that scrolls back into view within 30 minutes, but re-emits after', () => {
    const h = harness();
    h.observer.start();
    const el = [...h.observed][0];
    h.show([el]);
    h.runIdle();
    h.advance(29 * 60_000);
    h.show([el]);
    h.runIdle();
    expect(h.emitted).toHaveLength(1);
    h.advance(2 * 60_000);
    h.show([el]);
    h.runIdle();
    expect(h.emitted).toHaveLength(2);
    expect(h.emitted[1][0].postId).toBe(h.emitted[0][0].postId);
  });

  it('treats a virtualized re-render of the same post (new DOM node) as the same post', () => {
    const h = harness();
    h.observer.start();
    const el = [...h.observed][0];
    h.show([el]);
    h.runIdle();
    const clone = el.cloneNode(true) as Element;
    el.parentElement!.appendChild(clone);
    h.mutate([clone]);
    expect(h.observed.has(clone)).toBe(true);
    h.show([clone]);
    h.runIdle();
    expect(h.emitted).toHaveLength(1);
  });

  it('discovers posts added later through mutations', () => {
    const h = harness();
    h.observer.start();
    const before = h.observed.size;
    const clone = [...h.observed][0].cloneNode(true) as Element;
    h.doc.body.appendChild(clone);
    h.mutate([clone]);
    expect(h.observed.size).toBe(before + 1);
  });

  it('reads nothing on blocked surfaces, even if the page contains post markup', () => {
    for (const [platform, name] of [['x', 'blocked_dm'], ['instagram', 'blocked_notifications'], ['facebook', 'blocked_settings']] as const) {
      const h = harness(name, platform);
      h.observer.start();
      expect(h.observed.size).toBe(0);
      h.show([...h.doc.querySelectorAll('article, [role="article"]')]);
      h.runIdle();
      expect(h.emitted).toHaveLength(0);
    }
  });

  it('stops reading when an in-app navigation reaches a blocked surface', () => {
    const { doc, url } = loadFixture('x', 'feed');
    const adapter = getAdapterForUrl(url)!;
    let current = url;
    let ioCb: (e: VisibilityEntry[]) => void = () => {};
    const observed: Element[] = [];
    const idle: Array<() => void> = [];
    const emitted: RawPost[][] = [];
    const observer = new PostObserver(
      adapter,
      doc,
      {
        getUrl: () => current,
        now: () => 1,
        createIntersectionObserver: (cb) => ((ioCb = cb), { observe: (el) => observed.push(el), unobserve: () => {}, disconnect: () => {} }),
        createMutationObserver: () => ({ observe: () => {}, disconnect: () => {} }),
        schedule: (cb) => void idle.push(cb),
      },
      (p) => emitted.push(p),
    );
    observer.start();
    ioCb([{ target: observed[0], isIntersecting: true, intersectionRatio: 1 }]);
    current = 'https://x.com/messages/123';
    idle.splice(0).forEach((cb) => cb());
    expect(emitted).toHaveLength(0);
  });

  it('stop() disconnects observers', () => {
    const h = harness();
    h.observer.start();
    h.observer.stop();
    expect(h.observed.size).toBe(0);
  });
});

describe('baseline sampling', () => {
  it('reads follower count, verified flag and only the owner\'s own posts on a profile', () => {
    const { doc, url, expected } = loadFixture('x', 'profile');
    const adapter = getAdapterForUrl(url)!;
    const r = sampleProfile(adapter, doc, url, 1_741_600_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.followers?.value).toBe(expected.profile.followers);
    expect(r.profile.verified).toBe(true);
    expect(r.posts).toHaveLength(6);
    expect(r.posts.every((p) => p.authorHandle === 'citrus_daily' && p.kind === 'original')).toBe(true);
  });

  it('drops reposts and posts by other accounts from the owner baseline', () => {
    const { doc, url } = loadFixture('x', 'profile');
    const adapter = getAdapterForUrl(url)!;
    const banner = doc.createElement('div');
    banner.setAttribute('data-testid', 'socialContext');
    banner.textContent = 'Someone reposted';
    doc.querySelector('article')!.prepend(banner);
    const r = sampleProfile(adapter, doc, url, 1_741_600_000_000);
    if (!r.ok) throw new Error('expected ok');
    expect(r.posts).toHaveLength(5);
  });

  it('refuses non-profile pages, blocked surfaces and challenge pages', () => {
    const feed = loadFixture('x', 'feed');
    expect(sampleProfile(getAdapterForUrl(feed.url)!, feed.doc, feed.url, 0)).toEqual({ ok: false, reason: 'not_a_profile' });
    const dm = loadFixture('x', 'blocked_dm');
    expect(sampleProfile(getAdapterForUrl(dm.url)!, dm.doc, dm.url, 0)).toEqual({ ok: false, reason: 'blocked' });
    const wall = loadFixture('x', 'profile');
    const btn = wall.doc.createElement('a');
    btn.setAttribute('data-testid', 'loginButton');
    wall.doc.body.appendChild(btn);
    expect(sampleProfile(getAdapterForUrl(wall.url)!, wall.doc, wall.url, 0)).toEqual({ ok: false, reason: 'challenge' });
  });

  it('works for Facebook profiles too', () => {
    const { doc, url } = loadFixture('facebook', 'profile');
    const r = sampleProfile(getAdapterForUrl(url)!, doc, url, 1_741_600_000_000);
    expect(r.ok && r.profile.followers?.value).toBe(23000);
  });
});
