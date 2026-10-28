import type { PlatformAdapter } from '../adapters/PlatformAdapter';
import type { RawPost } from '../core/types';

export interface VisibilityEntry {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
}

export interface ObserverEnv {
  getUrl(): string;
  now(): number;
  createIntersectionObserver(cb: (entries: VisibilityEntry[]) => void): {
    observe(el: Element): void;
    unobserve(el: Element): void;
    disconnect(): void;
  };
  createMutationObserver(cb: (added: Node[]) => void): { observe(root: Node): void; disconnect(): void };
  /** Runs work when the page is idle (requestIdleCallback in production). */
  schedule(cb: () => void): void;
  /** Optional low-frequency timer; returns a stop function. Only used for adapters that rescan on URL change. */
  setInterval?(cb: () => void, ms: number): () => void;
}

export interface ObserverOptions {
  /** A post seen again after this long is re-emitted so its metrics can be observed. */
  revisitMs: number;
  visibleRatio: number;
}

const URL_POLL_MS = 1000;

export const DEFAULT_OBSERVER_OPTIONS: ObserverOptions = { revisitMs: 30 * 60_000, visibleRatio: 0.5 };

/**
 * Finds post roots as they appear, and extracts a post only once it is at least
 * half visible. Extraction is batched on idle time and de-duplicated per post key.
 */
export class PostObserver {
  private readonly tracked = new WeakSet<Element>();
  /** Strong refs, kept only so roots can be re-observed after an in-place URL change. */
  private readonly roots = new Set<Element>();
  private lastUrl = '';
  private stopTimer: (() => void) | null = null;
  private readonly visible = new Set<Element>();
  private readonly lastEmitted = new Map<string, number>();
  private io: ReturnType<ObserverEnv['createIntersectionObserver']> | null = null;
  private mo: ReturnType<ObserverEnv['createMutationObserver']> | null = null;
  private flushScheduled = false;

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly root: ParentNode & Node,
    private readonly env: ObserverEnv,
    private readonly emit: (posts: RawPost[]) => void,
    private readonly opts: ObserverOptions = DEFAULT_OBSERVER_OPTIONS,
  ) {}

  start(): void {
    this.io = this.env.createIntersectionObserver((entries) => this.onVisibility(entries));
    this.mo = this.env.createMutationObserver((added) => this.onAdded(added));
    this.mo.observe(this.root);
    this.lastUrl = this.env.getUrl();
    this.discover(this.root);
    if (this.adapter.rescansOnUrlChange && this.env.setInterval) {
      this.stopTimer = this.env.setInterval(() => this.checkUrl(), URL_POLL_MS);
    }
  }

  stop(): void {
    this.io?.disconnect();
    this.mo?.disconnect();
    this.io = this.mo = null;
    this.stopTimer?.();
    this.stopTimer = null;
    this.roots.clear();
    this.visible.clear();
  }

  /**
   * Viewers such as the Instagram reels viewer change the URL without replacing the post
   * elements. Re-observing a root makes IntersectionObserver report its visibility again,
   * which queues a fresh extraction under the new URL.
   */
  private checkUrl(): void {
    const url = this.env.getUrl();
    if (url === this.lastUrl) return;
    this.lastUrl = url;
    if (!this.io || !this.adapter.rescansOnUrlChange?.(url)) return;
    for (const el of this.roots) {
      if (!el.isConnected) {
        this.roots.delete(el);
        continue;
      }
      this.io.unobserve(el);
      this.io.observe(el);
    }
    this.discover(this.root);
  }

  private onAdded(added: Node[]): void {
    this.checkUrl();
    // An added node may itself be a post root, so search from its parent.
    const scopes = new Set<ParentNode>();
    for (const n of added) {
      if (n.nodeType !== 1) continue;
      scopes.add((n as Element).parentElement ?? (n as Element));
    }
    scopes.forEach((scope) => this.discover(scope));
  }

  private discover(scope: ParentNode): void {
    if (!this.io || this.adapter.surface(this.env.getUrl()) === 'blocked') return;
    for (const el of this.adapter.findPostRoots(scope, this.env.getUrl())) {
      if (this.tracked.has(el)) continue;
      this.tracked.add(el);
      this.roots.add(el);
      this.io.observe(el);
    }
  }

  private onVisibility(entries: VisibilityEntry[]): void {
    this.checkUrl();
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= this.opts.visibleRatio) this.visible.add(e.target);
      else this.visible.delete(e.target);
    }
    if (this.visible.size && !this.flushScheduled) {
      this.flushScheduled = true;
      this.env.schedule(() => this.flush());
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    this.checkUrl();
    const url = this.env.getUrl();
    if (this.adapter.surface(url) === 'blocked') {
      this.visible.clear();
      return;
    }
    const now = this.env.now();
    const batch: RawPost[] = [];
    for (const el of this.visible) {
      if (!el.isConnected) continue;
      const post = this.adapter.extractPost(el, { url, now });
      if (!post) continue;
      const key = `${post.platform}:${post.postId}`;
      const last = this.lastEmitted.get(key);
      if (last !== undefined && now - last < this.opts.revisitMs) continue;
      this.lastEmitted.set(key, now);
      batch.push(post);
    }
    this.visible.clear();
    if (batch.length) this.emit(batch);
  }
}
