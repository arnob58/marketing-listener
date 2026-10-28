import { logEngagement } from '../core/metrics';
import type { Snapshot, StoredPost } from '../core/types';
import type { Repository } from '../storage/repositories';
import { buildSnapshot, evaluateCluster, type ClusterReport } from './evaluate';
import type { AnalysisConfig, AnalysisPost, ClusterInput, HistoryPoint } from './types';

export function toAnalysisPost(p: StoredPost): AnalysisPost {
  return {
    key: p.key,
    platform: p.platform,
    authorKey: p.authorKey,
    authorHandle: p.authorHandle,
    engagement: p.engagement,
    postedAt: p.postedAt,
    firstSeenAt: p.firstSeenAt,
    lastSeenAt: p.lastSeenAt,
    kind: p.kind,
    refKey: p.refKey,
    variantOf: p.variantOf,
    repostedBy: p.repostedBy,
    url: p.url,
    text: p.text,
    hashtags: p.hashtags,
    audio: p.audio ?? null,
  };
}

/** Loads clusters from storage and runs the pure analysis over them. */
export class AnalysisService {
  constructor(
    private readonly repo: Repository,
    private readonly config: () => AnalysisConfig | Promise<AnalysisConfig>,
  ) {}

  async clusterInput(clusterId: string): Promise<ClusterInput | null> {
    const stored = await this.repo.postsInCluster(clusterId);
    if (!stored.length) return null;
    const accounts = new Map();
    const history = new Map<string, HistoryPoint[]>();
    for (const authorKey of new Set(stored.map((p) => p.authorKey))) {
      const acc = await this.repo.getAccount(authorKey);
      if (acc) accounts.set(authorKey, { followers: acc.followers, verified: acc.verified });
      const theirs = await this.repo.postsByAuthor(authorKey);
      history.set(authorKey, theirs.map((p) => ({ key: p.key, logE: logEngagement(p.engagement) })));
    }
    return { clusterId, posts: stored.map(toAnalysisPost), accounts, history };
  }

  async report(clusterId: string, now: number): Promise<ClusterReport | null> {
    const input = await this.clusterInput(clusterId);
    return input ? evaluateCluster(input, now, await this.config()) : null;
  }

  async allReports(now: number): Promise<ClusterReport[]> {
    const reports: ClusterReport[] = [];
    for (const c of await this.repo.allClusters()) {
      const r = await this.report(c.id, now);
      if (r) reports.push(r);
    }
    return reports.sort((a, b) => b.trendScore - a.trendScore);
  }

  /** Writes today's snapshot for every cluster; earlier days are left untouched. */
  async snapshotAll(now: number): Promise<Snapshot[]> {
    const out: Snapshot[] = [];
    for (const c of await this.repo.allClusters()) {
      const posts = (await this.repo.postsInCluster(c.id)).map(toAnalysisPost);
      if (!posts.length) continue;
      const snap = buildSnapshot(c.id, posts, now);
      await this.repo.upsertSnapshot(snap);
      out.push(snap);
    }
    return out;
  }
}
