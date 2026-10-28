import type { Platform, ProfileInfo, RawPost, Surface } from '../core/types';

export interface ExtractContext {
  /** Page URL at extraction time. */
  url: string;
  /** Epoch ms used to resolve relative timestamps ("2h"). */
  now: number;
}

export interface PlatformAdapter {
  readonly id: Platform;
  /** Bump when selectors change; recorded with every extraction for health tracking. */
  readonly selectorVersion: string;
  matches(url: string): boolean;
  surface(url: string): Surface;
  /** `url` lets an adapter pick a strategy per surface; callers that have none may omit it. */
  findPostRoots(node: ParentNode, url?: string): Element[];
  extractPost(el: Element, ctx: ExtractContext): RawPost | null;
  extractProfile(doc: Document, url: string): ProfileInfo | null;
  isChallengePage(doc: Document, url: string): boolean;
  /**
   * True for viewers that swap the post in place while the URL changes (the Instagram reels
   * viewer). The observer then re-reads the visible posts whenever the URL changes.
   */
  rescansOnUrlChange?(url: string): boolean;
}

const adapters = new Map<Platform, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapterForUrl(url: string): PlatformAdapter | null {
  for (const a of adapters.values()) if (a.matches(url)) return a;
  return null;
}

export function listAdapters(): PlatformAdapter[] {
  return [...adapters.values()];
}

/** Returns [] on blocked surfaces: private pages are never read. */
export function collectPosts(
  adapter: PlatformAdapter,
  root: ParentNode,
  ctx: ExtractContext,
): RawPost[] {
  if (adapter.surface(ctx.url) === 'blocked') return [];
  const out: RawPost[] = [];
  for (const el of adapter.findPostRoots(root, ctx.url)) {
    const post = adapter.extractPost(el, ctx);
    if (post) out.push(post);
  }
  return out;
}
