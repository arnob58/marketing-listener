import type { ClusterReport } from '../analysis/evaluate';
import type { Account, Metric, StoredPost } from '../core/types';

export const EXPORT_SCHEMA_VERSION = 2;

export interface TrendRow {
  clusterId: string;
  kind: string;
  trendScore: number;
  independentAccounts: number;
  totalPosts: number;
  platforms: string;
  lifecycle: string;
  duration: string;
  attribution: string;
  contentScore: number;
  confidence: number;
  evidence: string;
  missingData: string;
  summary: string;
  firstSeen: string;
  lastSeen: string;
  leadPostUrl: string;
  /** The lead post's caption, at most CAPTION_MAX characters. */
  representativeCaption: string;
  /** Up to five hashtags used across the cluster, most frequent first. */
  topHashtags: string[];
  audioTitle: string;
  /** Every member post link; unlike media URLs these stay valid. */
  postUrls: string[];
}

/** One post with its content. A count's Low/High columns are filled only when the platform showed an abbreviated value. */
export interface PostRow {
  clusterId: string;
  postKey: string;
  platform: string;
  surface: string;
  author: string;
  url: string;
  text: string;
  hashtags: string[];
  postedAt: string;
  likes: number | '';
  likesLow: number | '';
  likesHigh: number | '';
  comments: number | '';
  commentsLow: number | '';
  commentsHigh: number | '';
  shares: number | '';
  sharesLow: number | '';
  sharesHigh: number | '';
  views: number | '';
  viewsLow: number | '';
  viewsHigh: number | '';
  engagement: number;
  engagementLow: number;
  engagementHigh: number;
  hasVideo: boolean;
  mediaUrls: string[];
  audioTitle: string;
  audioId: string;
  kind: string;
  variantOf: string;
  firstSeen: string;
}

export interface AccountRow {
  key: string;
  platform: string;
  handle: string;
  followers: number | '';
  verified: boolean;
  postsSeen: number;
}

export interface ExportBundle {
  schemaVersion: number;
  generatedAt: string;
  notes: string[];
  trends: TrendRow[];
  posts: PostRow[];
  accounts: AccountRow[];
}

const iso = (ms: number) => new Date(ms).toISOString();

export const CAPTION_MAX = 280;
const TOP_HASHTAGS = 5;

export const EXPORT_NOTES = [
  'Counts reflect only what appeared in the exporting user\'s own feeds (sampling bias).',
  'Abbreviated engagement counts are ranges; see engagementLow/engagementHigh.',
  'Attribution is an estimate with a confidence value, not a certainty.',
  'Media URLs from Instagram and Facebook expire; post URLs are stable. Thumbnails are not exported.',
];

function metricCols<K extends string>(name: K, m: Metric | null) {
  const range = m && m.low !== m.high;
  return {
    [name]: m?.value ?? '',
    [`${name}Low`]: range ? m.low : '',
    [`${name}High`]: range ? m.high : '',
  } as Record<K | `${K}Low` | `${K}High`, number | ''>;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function topHashtags(posts: StoredPost[]): string[] {
  const counts = new Map<string, number>();
  for (const p of posts) for (const h of p.hashtags) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_HASHTAGS).map(([h]) => h);
}

export function buildExportBundle(input: {
  reports: ClusterReport[];
  posts: StoredPost[];
  accounts: Account[];
  now: number;
}): ExportBundle {
  const { reports, posts, accounts, now } = input;
  const byCluster = new Map<string, StoredPost[]>();
  for (const p of posts) if (p.clusterId) byCluster.set(p.clusterId, [...(byCluster.get(p.clusterId) ?? []), p]);

  const trends: TrendRow[] = reports.map((r) => {
    const members = byCluster.get(r.clusterId) ?? [];
    const lead = members.reduce<StoredPost | null>((a, p) => (!a || p.engagement.value > a.engagement.value ? p : a), null);
    return {
      clusterId: r.clusterId,
      kind: r.kind === 'trend' ? 'trend' : 'viral post candidate',
      trendScore: Number(r.trendScore.toFixed(3)),
      independentAccounts: r.independentAccounts,
      totalPosts: r.totalPosts,
      platforms: r.platforms.join(','),
      lifecycle: r.lifecycle.stage ?? '',
      duration: r.lifecycle.duration ?? '',
      attribution: r.classification.label,
      contentScore: Number(r.classification.score.toFixed(3)),
      confidence: Number(r.classification.confidence.toFixed(3)),
      evidence: r.classification.evidence.map((e) => e.text).join(' | '),
      missingData: r.classification.missingData.join(' | '),
      summary: r.classification.summary,
      firstSeen: iso(r.firstSeenAt),
      lastSeen: iso(r.lastSeenAt),
      leadPostUrl: lead?.url ?? '',
      representativeCaption: clip(lead?.text ?? '', CAPTION_MAX),
      topHashtags: topHashtags(members),
      audioTitle: (lead?.audio ?? members.find((m) => m.audio)?.audio)?.title ?? '',
      postUrls: members.map((m) => m.url),
    };
  });

  const postRows: PostRow[] = posts
    .filter((p) => p.clusterId)
    .map((p) => ({
      clusterId: p.clusterId!,
      postKey: p.key,
      platform: p.platform,
      surface: p.surface ?? '',
      author: p.authorHandle,
      url: p.url,
      text: p.text,
      hashtags: p.hashtags,
      postedAt: p.postedAt === null ? '' : iso(p.postedAt),
      ...metricCols('likes', p.metrics.likes),
      ...metricCols('comments', p.metrics.comments),
      ...metricCols('shares', p.metrics.shares),
      ...metricCols('views', p.metrics.views),
      engagement: p.engagement.value,
      engagementLow: p.engagement.low,
      engagementHigh: p.engagement.high,
      hasVideo: p.hasVideo,
      mediaUrls: p.imageUrls,
      audioTitle: p.audio?.title ?? '',
      audioId: p.audio?.id ?? '',
      kind: p.kind,
      variantOf: p.variantOf ?? '',
      firstSeen: iso(p.firstSeenAt),
    }));

  const counts = new Map<string, number>();
  for (const p of posts) counts.set(p.authorKey, (counts.get(p.authorKey) ?? 0) + 1);
  const accountRows: AccountRow[] = accounts.map((a) => ({
    key: a.key,
    platform: a.platform,
    handle: a.handle,
    followers: a.followers?.value ?? '',
    verified: a.verified,
    postsSeen: counts.get(a.key) ?? 0,
  }));

  return { schemaVersion: EXPORT_SCHEMA_VERSION, generatedAt: iso(now), notes: EXPORT_NOTES, trends, posts: postRows, accounts: accountRows };
}

/** CSV with RFC 4180 quoting; cells that a spreadsheet could read as formulas are neutralized. */
export function toCsv(rows: readonly object[], columns?: string[]): string {
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const cell = (v: unknown): string => {
    let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' | ') : String(v);
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(','))].join('\r\n');
}

export function exportFileName(kind: 'json' | 'trends.csv' | 'posts.csv' | 'accounts.csv', now: number): string {
  return `listener-export-${iso(now).replace(/[:.]/g, '-')}.${kind}`;
}
