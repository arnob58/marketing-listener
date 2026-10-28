import { collectPosts } from '../adapters/PlatformAdapter';
import type { PlatformAdapter } from '../adapters/PlatformAdapter';
import type { ProfileInfo, RawPost } from '../core/types';

export type BaselineSampleResult =
  | { ok: true; profile: ProfileInfo; posts: RawPost[] }
  | { ok: false; reason: 'not_a_profile' | 'blocked' | 'challenge' | 'profile_unreadable' };

/** The profile owner's own posts only: reposts, quotes and other accounts' posts do not describe their baseline. */
export function ownPosts(posts: RawPost[], handle: string): RawPost[] {
  return posts.filter(
    (p) => p.authorHandle.toLowerCase() === handle.toLowerCase() && p.kind === 'original' && !p.repostedBy,
  );
}

/** Reads follower count, verified flag and the posts already rendered on a profile page. */
export function sampleProfile(
  adapter: PlatformAdapter,
  doc: Document,
  url: string,
  now: number,
): BaselineSampleResult {
  const surface = adapter.surface(url);
  if (surface === 'blocked') return { ok: false, reason: 'blocked' };
  if (surface !== 'profile') return { ok: false, reason: 'not_a_profile' };
  if (adapter.isChallengePage(doc, url)) return { ok: false, reason: 'challenge' };
  const profile = adapter.extractProfile(doc, url);
  if (!profile) return { ok: false, reason: 'profile_unreadable' };
  return { ok: true, profile, posts: ownPosts(collectPosts(adapter, doc, { url, now }), profile.handle) };
}
