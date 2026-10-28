import { AnalysisService } from '../../src/analysis/service';
import { DEFAULT_ANALYSIS } from '../../src/analysis/types';
import { ClusterService } from '../../src/clustering/service';
import { emptyMetrics, exact } from '../../src/core/metrics';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Metric, Platform, PostAudio, PostKind, StoredPost } from '../../src/core/types';
import { minhash } from '../../src/features/minhash';
import { ListenerDb } from '../../src/storage/db';
import { Repository } from '../../src/storage/repositories';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Monday 2025-03-10 00:00 UTC */
export const MON = Date.UTC(2025, 2, 10);

let counter = 0;

const ADJ = ['amber', 'cobalt', 'drift', 'ember', 'fable', 'gilded', 'hollow', 'ivory', 'jade', 'kindle', 'lunar', 'mossy', 'north', 'opal', 'pearl', 'quartz', 'russet', 'solar', 'tidal', 'umber'];
const NOUN = ['fox', 'kite', 'owl', 'reef', 'pine', 'wren', 'lark', 'moth'];
/** Distinct, prefix-free handles (no trailing digits, which the family heuristic would strip). */
export const handleN = (i: number): string => `${ADJ[i % ADJ.length]}${NOUN[Math.floor(i / ADJ.length) % NOUN.length]}${'xyz'[Math.floor(i / (ADJ.length * NOUN.length))] ?? ''}`;

/** Unit-ish vector pointing mostly along axis `axis`, nudged by a deterministic offset. */
export function vec(axis: number, nudge = 0, dims = 16): number[] {
  const v = new Array<number>(dims).fill(0);
  v[axis] = 1;
  v[(axis + 1) % dims] = nudge;
  return v;
}

export interface SeedPost {
  platform?: Platform;
  handle: string;
  text?: string;
  textVec?: number[] | null;
  imageVec?: number[] | null;
  phash?: string | null;
  engagement?: number | Metric;
  firstSeenAt: number;
  lastSeenAt?: number;
  kind?: PostKind;
  refKey?: string | null;
  followers?: number | null;
  verified?: boolean;
  postId?: string;
  audio?: PostAudio | null;
}

export function createWorld(overrides: Partial<typeof DEFAULT_SETTINGS.thresholds> = {}) {
  const db = new ListenerDb(`test-${Date.now()}-${counter++}`);
  const repo = new Repository(db);
  const thresholds = { ...DEFAULT_SETTINGS.thresholds, ...overrides };
  let idc = 0;
  const cluster = new ClusterService(repo, () => thresholds, () => `c${++idc}`);
  const analysis = new AnalysisService(repo, () => ({ ...DEFAULT_ANALYSIS, minTrendAccounts: thresholds.minTrendAccounts }));

  /** Writes a fully featured post and clusters it, as the real pipeline would after feature extraction. */
  async function addPost(p: SeedPost): Promise<StoredPost> {
    const platform = p.platform ?? 'x';
    const postId = p.postId ?? `p${++counter}`;
    const text = p.text ?? `words from ${p.handle} about ${postId} then ${p.handle} again with ${postId} filler`;
    const key = `${platform}:${postId}`;
    const authorKey = `${platform}:${p.handle.toLowerCase()}`;
    const engagement = typeof p.engagement === 'number' ? exact(p.engagement) : (p.engagement ?? exact(100));
    const textHash = `t-${key}`;
    const imageHash = p.imageVec || p.phash ? `i-${key}` : null;

    if (p.textVec !== null) await repo.putTextFeatures({ hash: textHash, minhash: minhash(text), vec: p.textVec ?? null });
    if (imageHash) await repo.putImageFeatures({ hash: imageHash, phash: p.phash ?? '', vec: p.imageVec ?? null });

    const post: StoredPost = {
      key, platform, postId, url: `https://example.test/${platform}/${postId}`, authorKey,
      authorHandle: p.handle.toLowerCase(), text, hashtags: [], postedAt: p.firstSeenAt, imageUrls: [], hasVideo: false,
      metrics: { ...emptyMetrics(), likes: engagement }, engagement, audio: p.audio ?? null, surface: 'feed', kind: p.kind ?? 'original', refKey: p.refKey ?? null,
      repostedBy: [], firstSeenAt: p.firstSeenAt, lastSeenAt: p.lastSeenAt ?? p.firstSeenAt, featureState: 'done',
      imageHash, textHash: p.textVec === null ? null : textHash, clusterId: null, variantOf: null,
    };
    await repo.putPost(post);
    await repo.upsertAccount({
      key: authorKey, platform, handle: post.authorHandle, displayName: null,
      followers: p.followers != null ? exact(p.followers) : null, verified: p.verified ?? false, updatedAt: p.firstSeenAt,
    });
    await cluster.clusterPost(key, p.firstSeenAt);
    return (await repo.getPost(key))!;
  }

  return { db, repo, cluster, analysis, thresholds, addPost };
}
