import { median } from '../core/metrics';
import type { Classification, Platform, Snapshot } from '../core/types';
import { classifyCluster } from './attribution';
import { independentAccounts } from './independence';
import { computeLifecycle, type Lifecycle } from './lifecycle';
import { platformBreakdown, trendScore, type PlatformBreakdown } from './trendScore';
import { DEFAULT_ANALYSIS, type AnalysisConfig, type AnalysisPost, type ClusterInput } from './types';

export type ClusterKind = 'trend' | 'candidate';

/** The cluster's strongest post, shown as its face in lists. */
export interface ClusterLead {
  key: string;
  url: string | null;
  text: string;
  audioTitle: string | null;
}

export interface ClusterReport {
  clusterId: string;
  kind: ClusterKind;
  independentAccounts: number;
  totalPosts: number;
  variants: number;
  platforms: Platform[];
  perPlatform: PlatformBreakdown[];
  trendScore: number;
  velocity24h: number;
  lifecycle: Lifecycle;
  classification: Classification;
  lead: ClusterLead | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function leadOf(posts: AnalysisPost[]): ClusterLead | null {
  const lead = posts.reduce<AnalysisPost | null>((a, p) => (!a || p.engagement.value > a.engagement.value ? p : a), null);
  return lead && { key: lead.key, url: lead.url ?? null, text: lead.text ?? '', audioTitle: lead.audio?.title ?? null };
}

/** Pure per-cluster evaluation: everything the dashboard shows comes from here. */
export function evaluateCluster(
  input: ClusterInput,
  now: number,
  cfg: AnalysisConfig = DEFAULT_ANALYSIS,
): ClusterReport {
  const posts = input.posts.filter((p) => p.firstSeenAt <= now);
  const scoped: ClusterInput = { ...input, posts };
  const ind = independentAccounts(posts);
  const score = trendScore(posts, now);
  return {
    clusterId: input.clusterId,
    kind: ind.accounts.length >= cfg.minTrendAccounts ? 'trend' : 'candidate',
    independentAccounts: ind.accounts.length,
    totalPosts: posts.length,
    variants: posts.filter((p) => p.variantOf).length,
    platforms: [...new Set(posts.map((p) => p.platform))],
    perPlatform: platformBreakdown(posts),
    trendScore: score.score,
    velocity24h: score.newAccounts24h,
    lifecycle: computeLifecycle(posts, now, cfg.minTrendAccounts),
    classification: classifyCluster(scoped, cfg),
    lead: leadOf(posts),
    firstSeenAt: Math.min(...posts.map((p) => p.firstSeenAt)),
    lastSeenAt: Math.max(...posts.map((p) => p.lastSeenAt)),
  };
}

/** Daily snapshot of a cluster; stored per day so history is never overwritten by later days. */
export function buildSnapshot(clusterId: string, posts: AnalysisPost[], now: number): Snapshot {
  const visible = posts.filter((p) => p.firstSeenAt <= now);
  return {
    clusterId,
    day: dayKey(now),
    at: now,
    accounts: independentAccounts(visible).accounts.length,
    posts: visible.length,
    medianEngagement: visible.length ? median(visible.map((p) => p.engagement.value)) : 0,
    platforms: [...new Set(visible.map((p) => p.platform))],
  };
}
