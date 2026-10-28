import { median } from '../core/metrics';
import type { HistoryPoint } from './types';

export interface BaselineStats {
  n: number;
  /** Median of log-engagement. */
  median: number;
  /** Scaled median absolute deviation (consistent with a normal sigma), floored. */
  mad: number;
}

/** Floor in log units (~35% spread) so a tightly clustered history cannot make every post look extreme. */
export const MIN_MAD = 0.3;
const MAD_SCALE = 1.4826;

/** Baseline from an account's log-engagement history; null below the minimum sample. */
export function computeBaseline(logEs: number[], minPosts: number): BaselineStats | null {
  if (logEs.length < minPosts) return null;
  const m = median(logEs);
  const mad = MAD_SCALE * median(logEs.map((x) => Math.abs(x - m)));
  return { n: logEs.length, median: m, mad: Math.max(MIN_MAD, mad) };
}

/** Baseline that excludes the post being judged, so a post cannot raise its own bar. */
export function baselineExcluding(
  history: HistoryPoint[] | undefined,
  excludeKey: string,
  minPosts: number,
): { baseline: BaselineStats | null; sample: number } {
  const others = (history ?? []).filter((h) => h.key !== excludeKey).map((h) => h.logE);
  return { baseline: computeBaseline(others, minPosts), sample: others.length };
}

export const zScore = (logE: number, b: BaselineStats): number => (logE - b.median) / b.mad;
