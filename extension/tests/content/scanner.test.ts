import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scanner, WATCH_INTERVAL_MS, type ScanState, type ScannerEnv } from '../../src/content/scanner';
import { SCAN_LIMITS, sanitizeScan } from '../../src/core/settings';

function makeEnv() {
  const flags = { hidden: false, challenge: false, blocked: false };
  const input = new Set<() => void>();
  const vis = new Set<() => void>();
  let scrollY = 0;
  let maxScroll = Infinity;
  const scrolls = vi.fn();
  const env: ScannerEnv = {
    now: () => Date.now(),
    scrollOneViewport: () => {
      scrolls();
      scrollY = Math.min(maxScroll, scrollY + 800);
      return scrollY;
    },
    isHidden: () => flags.hidden,
    isChallenge: () => flags.challenge,
    isBlocked: () => flags.blocked,
    onUserInput: (h) => (input.add(h), () => input.delete(h)),
    onVisibilityChange: (h) => (vis.add(h), () => vis.delete(h)),
  };
  return {
    env,
    flags,
    scrolls,
    userInput: () => input.forEach((h) => h()),
    visibilityChange: () => vis.forEach((h) => h()),
    setMaxScroll: (n: number) => (maxScroll = n),
    listeners: () => input.size + vis.size,
  };
}

describe('Scanner safety', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('scrolls one viewport per interval (default 3s)', async () => {
    const t = makeEnv();
    const s = new Scanner(t.env, {});
    s.start();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(t.scrolls).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.scrolls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.scrolls).toHaveBeenCalledTimes(4);
    s.stop();
  });

  it('never admits more posts than the cap and stops the moment it is reached', () => {
    const t = makeEnv();
    const s = new Scanner(t.env, { maxPosts: 5 });
    s.start();
    const admitted = Array.from({ length: 20 }, () => s.admit()).filter(Boolean).length;
    expect(admitted).toBe(5);
    expect(s.getState()).toMatchObject({ status: 'stopped', reason: 'post_cap', collected: 5 });
  });

  it('clamps the post cap to the hard limit of 200 and the time cap to its maximum', async () => {
    const cfg = sanitizeScan({ maxPosts: 10_000, maxMs: 10 * 60 * 60_000, intervalMs: 1 });
    expect(cfg.maxPosts).toBe(SCAN_LIMITS.maxPosts);
    expect(cfg.maxMs).toBe(SCAN_LIMITS.maxMs);
    expect(cfg.intervalMs).toBeGreaterThanOrEqual(SCAN_LIMITS.minIntervalMs);
    expect(sanitizeScan({ maxPosts: Number.NaN }).maxPosts).toBe(50);

    vi.useFakeTimers();
    const t = makeEnv();
    const s = new Scanner(t.env, { maxPosts: 10_000 });
    s.start();
    for (let i = 0; i < 500; i++) s.admit();
    expect(s.getState().collected).toBe(200);
  });

  it('stops at the time cap and does not scroll afterwards', async () => {
    const t = makeEnv();
    const s = new Scanner(t.env, { maxMs: 20_000, intervalMs: 3_000 });
    s.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.getState()).toMatchObject({ status: 'stopped', reason: 'time_cap' });
    const calls = t.scrolls.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(7);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.scrolls.mock.calls.length).toBe(calls);
  });

  it('stops immediately on real user input (well within 1s)', async () => {
    const t = makeEnv();
    const s = new Scanner(t.env, {});
    s.start();
    await vi.advanceTimersByTimeAsync(4_000);
    t.userInput();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.getState()).toMatchObject({ status: 'stopped', reason: 'user_input' });
    const calls = t.scrolls.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.scrolls.mock.calls.length).toBe(calls);
  });

  it('stops when the tab is hidden, via the event and via the polling backstop', async () => {
    const a = makeEnv();
    const s1 = new Scanner(a.env, {});
    s1.start();
    a.flags.hidden = true;
    a.visibilityChange();
    expect(s1.getState().reason).toBe('tab_hidden');

    const b = makeEnv();
    const s2 = new Scanner(b.env, {});
    s2.start();
    b.flags.hidden = true; // no event delivered
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s2.getState()).toMatchObject({ status: 'stopped', reason: 'tab_hidden' });
  });

  it('stops within 1s of a challenge or login wall appearing', async () => {
    const t = makeEnv();
    const s = new Scanner(t.env, {});
    s.start();
    await vi.advanceTimersByTimeAsync(5_000);
    t.flags.challenge = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.getState()).toMatchObject({ status: 'stopped', reason: 'challenge' });
    expect(WATCH_INTERVAL_MS).toBeLessThanOrEqual(1_000);
  });

  it('does not even start on a challenge page, a hidden tab or a blocked surface', () => {
    for (const [flag, reason] of [['challenge', 'challenge'], ['hidden', 'tab_hidden'], ['blocked', 'blocked_surface']] as const) {
      const t = makeEnv();
      t.flags[flag] = true;
      const s = new Scanner(t.env, {});
      expect(s.start()).toBe(false);
      expect(s.getState()).toMatchObject({ status: 'stopped', reason });
      expect(t.listeners()).toBe(0);
    }
  });

  it('stops at the end of the feed when scrolling no longer advances', async () => {
    const t = makeEnv();
    t.setMaxScroll(1600);
    const s = new Scanner(t.env, {});
    s.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.getState()).toMatchObject({ status: 'stopped', reason: 'end_of_feed' });
  });

  it('reports state and removes its listeners on stop', async () => {
    const t = makeEnv();
    const states: ScanState[] = [];
    const s = new Scanner(t.env, { maxPosts: 3 }, (st) => states.push(st));
    s.start();
    expect(t.listeners()).toBe(2);
    s.admit();
    s.stop('manual');
    expect(t.listeners()).toBe(0);
    expect(states.at(-1)).toMatchObject({ status: 'stopped', reason: 'manual', collected: 1, maxPosts: 3 });
    expect(s.admit()).toBe(false);
  });

  it('ignores a second start while running', () => {
    const t = makeEnv();
    const s = new Scanner(t.env, {});
    expect(s.start()).toBe(true);
    expect(s.start()).toBe(false);
    s.stop();
  });
});
