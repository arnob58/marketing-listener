import { median } from '../core/metrics';
import type { Platform } from '../core/types';
import { independentAccounts } from './independence';
import type { AnalysisPost } from './types';

const DAY_MS = 86_400_000;

export interface PlatformBreakdown {
  platform: Platform;
  posts: number;
  accounts: number;
  medianEngagement: number;
}

export function platformBreakdown(posts: AnalysisPost[]): PlatformBreakdown[] {
  const byPlatform = new Map<Platform, AnalysisPost[]>();
  for (const p of posts) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  return [...byPlatform.entries()].map(([platform, ps]) => ({
    platform,
    posts: ps.length,
    accounts: independentAccounts(ps).accounts.length,
    medianEngagement: median(ps.map((p) => p.engagement.value)),
  }));
}

/** Median of per-account median engagement, so a single prolific or large account cannot dominate. */
export function robustEngagement(posts: AnalysisPost[]): number {
  const byAuthor = new Map<string, number[]>();
  for (const p of posts) byAuthor.set(p.authorKey, [...(byAuthor.get(p.authorKey) ?? []), p.engagement.value]);
  const perAccount = [...byAuthor.values()].map(median);
  return perAccount.length ? median(perAccount) : 0;
}

export interface TrendScoreParts {
  accounts: number;
  robustEngagement: number;
  platforms: number;
  newAccounts24h: number;
  score: number;
}

/**
 * Trend score from distinct independent accounts, robust engagement, platform
 * spread and 24h velocity. Duplicate posts never raise it.
 */
export function trendScore(posts: AnalysisPost[], now: number): TrendScoreParts {
  const ind = independentAccounts(posts);
  const accounts = ind.accounts.length;
  const robust = robustEngagement(ind.originals);
  const platforms = new Set(posts.map((p) => p.platform)).size;
  const newAccounts24h = ind.originals.filter((p) => now - p.firstSeenAt < DAY_MS).length;
  const score =
    2 * Math.log1p(accounts) + 0.6 * Math.log1p(robust) + 0.8 * (platforms - 1) + 0.5 * Math.log1p(newAccounts24h);
  return { accounts, robustEngagement: robust, platforms, newAccounts24h, score };
}
