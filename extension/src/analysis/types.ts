import type { Metric, Platform, PostAudio, PostKind } from '../core/types';

/** The slice of a stored post the analysis layer needs; keeps analysis free of storage concerns. */
export interface AnalysisPost {
  key: string;
  platform: Platform;
  authorKey: string;
  authorHandle: string;
  engagement: Metric;
  postedAt: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  kind: PostKind;
  refKey: string | null;
  variantOf: string | null;
  repostedBy: string[];
  url?: string;
  text?: string;
  hashtags?: string[];
  audio?: PostAudio | null;
}

export interface AccountInfo {
  followers: Metric | null;
  verified: boolean;
}

/** logEngagement of an account's other known posts, used for its baseline. */
export interface HistoryPoint {
  key: string;
  logE: number;
}

export interface ClusterInput {
  clusterId: string;
  posts: AnalysisPost[];
  accounts: Map<string, AccountInfo>;
  history: Map<string, HistoryPoint[]>;
}

export interface AnalysisConfig {
  minTrendAccounts: number;
  minBaselinePosts: number;
  /** Engagement at or above this counts as "high" for the no-adoption signal. */
  highEngagement: number;
  smallAccountFollowers: number;
  largeAccountFollowers: number;
}

export const DEFAULT_ANALYSIS: AnalysisConfig = {
  minTrendAccounts: 3,
  minBaselinePosts: 5,
  highEngagement: 1000,
  smallAccountFollowers: 10_000,
  largeAccountFollowers: 1_000_000,
};
