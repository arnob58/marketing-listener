import type {
  Account,
  Cluster,
  ImageFeatures,
  Observation,
  Snapshot,
  StoredPost,
  TextFeatures,
  Thumbnail,
} from '../core/types';
import type { ExtractedField } from '../core/types';
import type { HealthRecord, ListenerDb } from './db';

const DAY_MS = 86_400_000;

export class Repository {
  constructor(readonly db: ListenerDb) {}

  // posts
  getPost = (key: string) => this.db.posts.get(key);
  putPost = (post: StoredPost) => this.db.posts.put(post);
  async patchPost(key: string, patch: Partial<StoredPost>) {
    await this.db.posts.update(key, patch);
  }
  postsByAuthor = (authorKey: string) => this.db.posts.where('authorKey').equals(authorKey).toArray();
  postsInCluster = (clusterId: string) => this.db.posts.where('clusterId').equals(clusterId).toArray();
  pendingPosts = (limit: number) =>
    this.db.posts.where('featureState').equals('pending').limit(limit).toArray();
  postsSince = (ms: number) => this.db.posts.where('firstSeenAt').aboveOrEqual(ms).toArray();
  allPosts = () => this.db.posts.toArray();

  // observations
  addObservation = (o: Observation) => this.db.observations.add(o);
  observationsFor = (postKey: string) => this.db.observations.where('postKey').equals(postKey).toArray();
  countObservations = () => this.db.observations.count();

  // accounts
  getAccount = (key: string) => this.db.accounts.get(key);
  allAccounts = () => this.db.accounts.toArray();

  /** Never overwrites known follower/verified data with unknowns. */
  async upsertAccount(incoming: Account) {
    const existing = await this.db.accounts.get(incoming.key);
    await this.db.accounts.put({
      ...incoming,
      displayName: incoming.displayName ?? existing?.displayName ?? null,
      followers: incoming.followers ?? existing?.followers ?? null,
      verified: incoming.verified || existing?.verified || false,
    });
  }

  // features
  getImageFeatures = (hash: string) => this.db.imageFeatures.get(hash);
  putImageFeatures = (f: ImageFeatures) => this.db.imageFeatures.put(f);
  getTextFeatures = (hash: string) => this.db.textFeatures.get(hash);
  putTextFeatures = (f: TextFeatures) => this.db.textFeatures.put(f);

  // thumbnails
  getThumbnail = (key: string) => this.db.thumbnails.get(key);
  hasThumbnail = async (key: string) => (await this.db.thumbnails.where('key').equals(key).count()) > 0;
  putThumbnail = (t: Thumbnail) => this.db.thumbnails.put(t);

  // clusters
  getCluster = (id: string) => this.db.clusters.get(id);
  putCluster = (c: Cluster) => this.db.clusters.put(c);
  deleteCluster = (id: string) => this.db.clusters.delete(id);
  allClusters = () => this.db.clusters.toArray();
  activeClusters = (since: number) => this.db.clusters.where('updatedAt').aboveOrEqual(since).toArray();

  // snapshots
  upsertSnapshot = (s: Snapshot) => this.db.snapshots.put(s);
  snapshotsFor = (clusterId: string) =>
    this.db.snapshots.where('clusterId').equals(clusterId).sortBy('day');
  allSnapshots = () => this.db.snapshots.toArray();

  // extraction health
  async recordHealth(platform: StoredPost['platform'], selectorVersion: string, resolved: Record<ExtractedField, boolean>, now: number) {
    const key = `${platform}:${selectorVersion}`;
    const rec: HealthRecord = (await this.db.health.get(key)) ?? {
      key, platform, selectorVersion, posts: 0, author: 0, text: 0, timestamp: 0, url: 0, metrics: 0, media: 0, updatedAt: now,
    };
    rec.posts++;
    for (const f of ['author', 'text', 'timestamp', 'url', 'metrics', 'media'] as const) if (resolved[f]) rec[f]++;
    rec.updatedAt = now;
    await this.db.health.put(rec);
  }
  allHealth = () => this.db.health.toArray();

  /** Drops posts (and their observations) not seen within the retention window. */
  async purgeOlderThan(retentionDays: number, now: number): Promise<number> {
    const cutoff = now - retentionDays * DAY_MS;
    const old = await this.db.posts.where('lastSeenAt').below(cutoff).primaryKeys();
    await this.db.transaction('rw', [this.db.posts, this.db.observations, this.db.thumbnails, this.db.snapshots, this.db.clusters], async () => {
      await this.db.posts.bulkDelete(old);
      await this.db.observations.where('postKey').anyOf(old).delete();
      await this.db.thumbnails.bulkDelete(old);
      const live = new Set((await this.db.posts.toArray()).map((p) => p.clusterId).filter(Boolean) as string[]);
      for (const c of await this.db.clusters.toArray()) {
        if (!live.has(c.id)) {
          await this.db.clusters.delete(c.id);
          await this.db.snapshots.where('clusterId').equals(c.id).delete();
        }
      }
    });
    return old.length;
  }

  async purgeAll() {
    await Promise.all(this.db.tables.map((t) => t.clear()));
  }
}
