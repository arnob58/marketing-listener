import type { Metric, PostMetrics } from './types';

const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};

export function exact(value: number): Metric {
  return { value, low: value, high: value };
}

/**
 * Parses displayed counts: "999", "1,234", "1.2K", "12K", "1.2M", "1,2 k".
 * Abbreviated values become ranges, e.g. "1.2K" -> {1200, 1150, 1250}.
 */
export function parseCount(input: string | null | undefined): Metric | null {
  if (input == null) return null;
  const s = input.replace(/ /g, ' ').trim().toLowerCase();
  const m = s.match(/^(\d[\d.,\s]*)\s*(thousand|million|billion|mm|k|m|b)?$/);
  if (!m) return null;
  const numeric = m[1].trim();
  const mult = m[2] ? SUFFIX_MULTIPLIER[m[2]] : 1;

  if (mult === 1) {
    // Plain integer with thousands separators: "1,234", "1.234", "1 234".
    if (/^\d{1,3}([,.\s]\d{3})+$/.test(numeric)) return exact(Number(numeric.replace(/[,.\s]/g, '')));
    if (/^\d+$/.test(numeric)) return exact(Number(numeric));
    return null;
  }

  // Abbreviated: either "." or "," acts as the decimal mark.
  if (!/^\d+([.,]\d+)?$/.test(numeric)) return null;
  const decimals = numeric.includes('.') || numeric.includes(',') ? numeric.split(/[.,]/)[1].length : 0;
  const base = Number(numeric.replace(',', '.'));
  const halfStep = (0.5 * 10 ** -decimals) * mult;
  const value = Math.round(base * mult);
  return { value, low: Math.max(0, Math.round(value - halfStep)), high: Math.round(value + halfStep) };
}

export function addMetrics(...ms: Array<Metric | null | undefined>): Metric {
  return ms.reduce<Metric>(
    (acc, m) => (m ? { value: acc.value + m.value, low: acc.low + m.low, high: acc.high + m.high } : acc),
    exact(0),
  );
}

export function scaleMetric(m: Metric, k: number): Metric {
  return { value: m.value * k, low: m.low * k, high: m.high * k };
}

export const emptyMetrics = (): PostMetrics => ({ likes: null, comments: null, shares: null, views: null });

export const ENGAGEMENT_WEIGHTS = { likes: 1, comments: 2, shares: 3 } as const;

/** Weighted interaction count. Views are excluded: only X exposes them. */
export function engagementScore(m: PostMetrics): Metric {
  return addMetrics(
    m.likes && scaleMetric(m.likes, ENGAGEMENT_WEIGHTS.likes),
    m.comments && scaleMetric(m.comments, ENGAGEMENT_WEIGHTS.comments),
    m.shares && scaleMetric(m.shares, ENGAGEMENT_WEIGHTS.shares),
  );
}

export const logEngagement = (m: Metric): number => Math.log1p(Math.max(0, m.value));

/** Relative width of the uncertainty range in [0,1]; 0 means exact. */
export function relativeUncertainty(m: Metric): number {
  if (m.value <= 0) return 0;
  return Math.min(1, (m.high - m.low) / (2 * m.value));
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
