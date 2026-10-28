import { sanitizeScan, type ScanSettings } from '../core/settings';

export type ScanStopReason =
  | 'post_cap'
  | 'time_cap'
  | 'user_input'
  | 'tab_hidden'
  | 'challenge'
  | 'blocked_surface'
  | 'end_of_feed'
  | 'manual';

export interface ScanState {
  status: 'idle' | 'running' | 'stopped';
  collected: number;
  elapsedMs: number;
  maxPosts: number;
  maxMs: number;
  reason?: ScanStopReason;
}

export interface ScannerEnv {
  now(): number;
  /** Scrolls one viewport and returns the resulting scroll offset. */
  scrollOneViewport(): number;
  isHidden(): boolean;
  isChallenge(): boolean;
  isBlocked(): boolean;
  /** Subscribes to real user input; returns an unsubscribe function. */
  onUserInput(handler: () => void): () => void;
  onVisibilityChange(handler: () => void): () => void;
}

/** How often safety conditions are re-checked while a scan runs. */
export const WATCH_INTERVAL_MS = 250;
const END_OF_FEED_STEPS = 2;

/**
 * User-initiated, bounded scroll. Scrolls one viewport per fixed interval and
 * stops at the first of: post cap, time cap, user input, hidden tab,
 * challenge or login wall, blocked surface, or end of feed.
 */
export class Scanner {
  private readonly cfg: ScanSettings;
  private state: ScanState;
  private startedAt = 0;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private cleanup: Array<() => void> = [];
  private lastOffset = Number.NaN;
  private stalledSteps = 0;

  constructor(
    private readonly env: ScannerEnv,
    settings: Partial<ScanSettings>,
    private readonly onState: (s: ScanState) => void = () => {},
  ) {
    this.cfg = sanitizeScan(settings);
    this.state = { status: 'idle', collected: 0, elapsedMs: 0, maxPosts: this.cfg.maxPosts, maxMs: this.cfg.maxMs };
  }

  getState(): ScanState {
    return { ...this.state, elapsedMs: this.state.status === 'running' ? this.env.now() - this.startedAt : this.state.elapsedMs };
  }

  start(): boolean {
    if (this.state.status === 'running') return false;
    this.startedAt = this.env.now();
    this.state = { ...this.state, status: 'running', collected: 0, elapsedMs: 0, reason: undefined };
    if (this.env.isBlocked()) return this.halt('blocked_surface');
    if (this.env.isChallenge()) return this.halt('challenge');
    if (this.env.isHidden()) return this.halt('tab_hidden');

    this.cleanup.push(this.env.onUserInput(() => this.stop('user_input')));
    this.cleanup.push(this.env.onVisibilityChange(() => this.env.isHidden() && this.stop('tab_hidden')));
    this.watchTimer = setInterval(() => this.checkSafety(), WATCH_INTERVAL_MS);
    this.capTimer = setTimeout(() => this.stop('time_cap'), this.cfg.maxMs);
    this.stepTimer = setTimeout(() => this.step(), this.cfg.intervalMs);
    this.publish();
    return true;
  }

  /**
   * Asks permission to forward one more post. Returns false once the post cap
   * is reached, so the number of collected posts never exceeds the cap.
   */
  admit(): boolean {
    if (this.state.status !== 'running') return false;
    if (this.state.collected >= this.cfg.maxPosts) return false;
    this.state.collected++;
    if (this.state.collected >= this.cfg.maxPosts) this.stop('post_cap');
    else this.publish();
    return true;
  }

  stop(reason: ScanStopReason = 'manual'): void {
    if (this.state.status !== 'running') return;
    this.halt(reason);
  }

  private halt(reason: ScanStopReason): false {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.capTimer) clearTimeout(this.capTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.stepTimer = this.capTimer = this.watchTimer = null;
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.state = { ...this.state, status: 'stopped', reason, elapsedMs: this.env.now() - this.startedAt };
    this.publish();
    return false;
  }

  private checkSafety(): void {
    if (this.env.isHidden()) this.stop('tab_hidden');
    else if (this.env.isChallenge()) this.stop('challenge');
    else if (this.env.isBlocked()) this.stop('blocked_surface');
  }

  private step(): void {
    if (this.state.status !== 'running') return;
    this.checkSafety();
    if (this.state.status !== 'running') return;

    const offset = this.env.scrollOneViewport();
    this.stalledSteps = offset === this.lastOffset ? this.stalledSteps + 1 : 0;
    this.lastOffset = offset;
    if (this.stalledSteps >= END_OF_FEED_STEPS) {
      this.stop('end_of_feed');
      return;
    }
    this.publish();
    this.stepTimer = setTimeout(() => this.step(), this.cfg.intervalMs);
  }

  private publish(): void {
    this.onState(this.getState());
  }
}
