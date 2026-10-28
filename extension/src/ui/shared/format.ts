import type { AttributionLabel, Metric, PostMetrics } from '../../core/types';

export const fmtNumber = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString('en-US');

export function fmtMetric(m: Metric | null): string {
  if (!m) return 'n/a';
  return m.low === m.high ? fmtNumber(m.value) : `~${fmtNumber(m.value)}`;
}

export const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export const fmtPct = (x: number): string => `${Math.round(x * 100)}%`;

export function labelClass(label: AttributionLabel): string {
  switch (label) {
    case 'Likely content-driven':
      return 'tag tag-content';
    case 'Likely publisher-driven':
      return 'tag tag-publisher';
    case 'Mixed':
      return 'tag tag-mixed';
    default:
      return 'tag tag-unknown';
  }
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `<platform>-<surface>-<iso>.html`, with the colons and dots of the timestamp made filename-safe. */
export const snapshotFileName = (platform: string, surface: string, now: number): string =>
  `${platform}-${surface || 'page'}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.html`;

/** "likes 1.2K", "comments 45": only the counts the page actually showed. */
export function metricParts(m: PostMetrics): string[] {
  return (['likes', 'comments', 'shares', 'views'] as const).filter((k) => m[k]).map((k) => `${k} ${fmtMetric(m[k])}`);
}
