import { defineContentScript } from 'wxt/sandbox';
import { getAdapterForUrl } from '../adapters';
import { sampleProfile, ownPosts } from '../content/baseline';
import { PostObserver } from '../content/observer';
import { handleSnapshotCommand } from '../content/snapshot';
import { Scanner, type ScannerEnv } from '../content/scanner';
import type { ContentMessage, TabCommand, TabReply } from '../core/messages';
import type { Settings } from '../core/settings';
import type { RawPost } from '../core/types';
import { CONTENT_MATCHES } from '../manifest';

const USER_INPUT_EVENTS = ['wheel', 'keydown', 'mousedown', 'touchstart'] as const;

export default defineContentScript({
  matches: CONTENT_MATCHES,
  runAt: 'document_idle',
  main() {
    const adapter = getAdapterForUrl(location.href);
    if (!adapter) return;

    const send = (msg: ContentMessage) => void chrome.runtime.sendMessage(msg).catch(() => {});
    let scanner: Scanner | null = null;
    let scanFilterHandle: string | null = null;

    const emit = (posts: RawPost[]) => {
      let out = posts;
      if (scanner?.getState().status === 'running') {
        if (scanFilterHandle) out = ownPosts(out, scanFilterHandle);
        out = out.filter(() => scanner!.admit());
      }
      if (out.length) send({ type: 'posts', posts: out });
    };

    const observer = new PostObserver(
      adapter,
      document,
      {
        getUrl: () => location.href,
        now: () => Date.now(),
        createIntersectionObserver: (cb) =>
          new IntersectionObserver((entries) => cb(entries), { threshold: [0.5] }),
        createMutationObserver: (cb) => {
          const mo = new MutationObserver((records) => cb(records.flatMap((r) => [...r.addedNodes])));
          return { observe: (root) => mo.observe(root, { childList: true, subtree: true }), disconnect: () => mo.disconnect() };
        },
        schedule: (cb) => requestIdleCallback(() => cb(), { timeout: 1000 }),
        setInterval: (cb, ms) => {
          const id = window.setInterval(cb, ms);
          return () => window.clearInterval(id);
        },
      },
      emit,
    );
    observer.start();

    const scannerEnv: ScannerEnv = {
      now: () => Date.now(),
      scrollOneViewport: () => {
        window.scrollBy({ top: window.innerHeight, behavior: 'instant' });
        return window.scrollY;
      },
      isHidden: () => document.hidden,
      isChallenge: () => adapter.isChallengePage(document, location.href),
      isBlocked: () => adapter.surface(location.href) === 'blocked',
      onUserInput: (handler) => {
        const listener = (e: Event) => e.isTrusted && handler();
        USER_INPUT_EVENTS.forEach((t) => window.addEventListener(t, listener, { passive: true, capture: true }));
        return () => USER_INPUT_EVENTS.forEach((t) => window.removeEventListener(t, listener, { capture: true }));
      },
      onVisibilityChange: (handler) => {
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
      },
    };

    const beginScan = (settings: Settings['scan'], handle: string | null) => {
      if (scanner?.getState().status === 'running') return;
      scanFilterHandle = handle;
      scanner = new Scanner(scannerEnv, settings, (state) => send({ type: 'scan:state', state }));
      scanner.start();
    };

    chrome.runtime.onMessage.addListener((msg: TabCommand, _sender, sendResponse: (r: TabReply) => void) => {
      switch (msg?.type) {
        case 'scan:start':
          beginScan(msg.settings, null);
          sendResponse({ ok: true, state: scanner?.getState() });
          return false;
        case 'scan:stop':
          scanner?.stop('manual');
          sendResponse({ ok: true, state: scanner?.getState() });
          return false;
        case 'scan:status':
          sendResponse({ ok: true, state: scanner?.getState() });
          return false;
        case 'baseline:sample': {
          const r = sampleProfile(adapter, document, location.href, Date.now());
          if (!r.ok) {
            sendResponse({ ok: false, reason: r.reason });
            return false;
          }
          send({ type: 'profile', profile: r.profile });
          if (r.posts.length) send({ type: 'posts', posts: r.posts });
          sendResponse({ ok: true, sampled: r.posts.length, handle: r.profile.handle, followers: r.profile.followers?.value ?? null });
          return false;
        }
        case 'baseline:scan': {
          const r = sampleProfile(adapter, document, location.href, Date.now());
          if (!r.ok) {
            sendResponse({ ok: false, reason: r.reason });
            return false;
          }
          send({ type: 'profile', profile: r.profile });
          beginScan(msg.settings, r.profile.handle);
          sendResponse({ ok: true, state: scanner?.getState(), handle: r.profile.handle });
          return false;
        }
        case 'debug:snapshot':
          sendResponse(handleSnapshotCommand(adapter, document, location.href));
          return false;
        default:
          return false;
      }
    });
  },
});
