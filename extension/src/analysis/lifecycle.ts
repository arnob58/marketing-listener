import type { LifecycleStage } from '../core/types';
import { independentAccounts } from './independence';
import type { AnalysisPost } from './types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type Duration = 'short-lived' | 'sustained';

export interface Lifecycle {
  stage: LifecycleStage | null;
  duration: Duration | null;
  /** New independent accounts in the last three 24h windows, newest first. */
  windows: [number, number, number];
  firstSeenAt: number;
  lastSightingAt: number;
  growthRatio: number | null;
}

/** First-appearance times of independent accounts. */
function adoptionTimes(posts: AnalysisPost[]): number[] {
  return independentAccounts(posts).originals.map((p) => p.firstSeenAt);
}

function windowCount(times: number[], now: number, i: number): number {
  const hi = now - i * DAY_MS;
  const lo = hi - DAY_MS;
  return times.filter((t) => t > lo && t <= hi).length;
}

export function computeLifecycle(posts: AnalysisPost[], now: number, minAccounts = 3): Lifecycle {
  const times = adoptionTimes(posts).filter((t) => t <= now);
  const firstSeenAt = Math.min(...posts.map((p) => p.firstSeenAt));
  const lastSightingAt = Math.max(...posts.filter((p) => p.firstSeenAt <= now).map((p) => p.lastSeenAt), firstSeenAt);
  const [n0, n1, n2] = [0, 1, 2].map((i) => windowCount(times, now, i));
  const accounts = times.length;
  const growthRatio = n1 > 0 ? n0 / n1 : null;

  let stage: LifecycleStage | null = null;
  if (accounts >= minAccounts) {
    const age = now - firstSeenAt;
    const ratio0 = n1 > 0 ? n0 / n1 : n0 > 0 ? Infinity : 1;
    const ratio1 = n2 > 0 ? n1 / n2 : null;
    const stale = now - lastSightingAt >= 72 * HOUR_MS;
    const falling = n1 > 0 && ratio0 < 0.67 && ratio1 !== null && ratio1 < 0.67;
    if (stale || falling) stage = 'Declining';
    else if (n1 > 0 && n0 >= 1.5 * n1) stage = 'Accelerating';
    else if (age < 48 * HOUR_MS) stage = 'Emerging';
    else if (age >= 3 * DAY_MS && ratio0 >= 0.67 && ratio0 <= 1.5) stage = 'Established';
    else stage = age < 3 * DAY_MS ? 'Emerging' : 'Established';
  }

  return {
    stage,
    duration: durationOf(times, firstSeenAt, lastSightingAt),
    windows: [n0, n1, n2],
    firstSeenAt,
    lastSightingAt,
    growthRatio,
  };
}

/** Short-lived vs sustained from the peak-to-span ratio of daily new accounts. */
function durationOf(times: number[], first: number, last: number): Duration | null {
  const span = last - first;
  if (span < DAY_MS || times.length < 3) return null;
  const perDay = new Map<number, number>();
  for (const t of times) perDay.set(Math.floor(t / DAY_MS), (perDay.get(Math.floor(t / DAY_MS)) ?? 0) + 1);
  const peakShare = Math.max(...perDay.values()) / times.length;
  return span >= 3 * DAY_MS && peakShare < 0.7 ? 'sustained' : 'short-lived';
}
