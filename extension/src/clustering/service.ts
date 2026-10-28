import type { Cluster, StoredPost } from '../core/types';
import type { SimilarityThresholds, ClusterState } from './cluster';
import { addMember, assignPost, mergeInto, newCluster, planMerges } from './cluster';
import type { ComparablePost, PostFeatures } from './dedup';
import type { Repository } from '../storage/repositories';

const DAY_MS = 86_400_000;

export interface ClusterConfig extends SimilarityThresholds {
  clusterWindowDays: number;
}

export class ClusterService {
  constructor(
    private readonly repo: Repository,
    private readonly config: () => ClusterConfig | Promise<ClusterConfig>,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async featuresFor(post: StoredPost): Promise<PostFeatures> {
    const img = post.imageHash ? await this.repo.getImageFeatures(post.imageHash) : undefined;
    const txt = post.textHash ? await this.repo.getTextFeatures(post.textHash) : undefined;
    return {
      phash: img?.phash ?? null,
      imageVec: img?.vec ?? null,
      minhash: txt?.minhash ?? [],
      textVec: txt?.vec ?? null,
      textChars: post.text.length,
      audioId: post.audio?.id ?? null,
    };
  }

  private async hydrate(c: Cluster): Promise<ClusterState> {
    const members = await this.repo.postsInCluster(c.id);
    const comparable: ComparablePost[] = [];
    for (const m of members) {
      comparable.push({ key: m.key, authorKey: m.authorKey, features: await this.featuresFor(m) });
    }
    return {
      id: c.id,
      centroidImage: c.centroidImage,
      nImage: c.nImage,
      centroidText: c.centroidText,
      nText: c.nText,
      members: comparable,
    };
  }

  private persist(state: ClusterState, base: Partial<Cluster>, now: number): Promise<unknown> {
    return this.repo.putCluster({
      id: state.id,
      createdAt: base.createdAt ?? now,
      updatedAt: now,
      centroidImage: state.centroidImage,
      nImage: state.nImage,
      centroidText: state.centroidText,
      nText: state.nText,
    });
  }

  /** Stages 1-3. Quotes of a known post join its cluster as propagation. */
  async clusterPost(key: string, now: number): Promise<string | null> {
    const post = await this.repo.getPost(key);
    if (!post) return null;
    const cfg = await this.config();
    const comparable: ComparablePost = { key, authorKey: post.authorKey, features: await this.featuresFor(post) };

    const since = now - cfg.clusterWindowDays * DAY_MS;
    const active = await Promise.all((await this.repo.activeClusters(since)).map((c) => this.hydrate(c)));

    let target: ClusterState | undefined;
    let variantOf: string | null = null;

    const ref = post.refKey ? await this.repo.getPost(post.refKey) : undefined;
    if (ref?.clusterId) {
      target = active.find((c) => c.id === ref.clusterId) ?? (await this.hydrate((await this.repo.getCluster(ref.clusterId))!));
    }
    if (!target) {
      const a = assignPost(comparable, active.filter((c) => c.members.every((m) => m.key !== key)), cfg);
      if (a.clusterId) {
        target = active.find((c) => c.id === a.clusterId);
        variantOf = a.variantOf;
      }
    }
    if (!target) target = newCluster(this.newId(), comparable);
    else addMember(target, comparable);

    const existing = await this.repo.getCluster(target.id);
    await this.persist(target, existing ?? {}, now);
    await this.repo.patchPost(key, { clusterId: target.id, variantOf });
    return target.id;
  }

  /** Nightly: merge clusters whose centroids have converged. Returns merged cluster count. */
  async mergePass(now: number): Promise<number> {
    const cfg = await this.config();
    const since = now - cfg.clusterWindowDays * DAY_MS;
    const states = await Promise.all((await this.repo.activeClusters(since)).map((c) => this.hydrate(c)));
    const byId = new Map(states.map((s) => [s.id, s]));
    const plans = planMerges(states, cfg);
    for (const { keep, absorb } of plans) {
      const k = byId.get(keep)!;
      const a = byId.get(absorb)!;
      mergeInto(k, a);
      for (const m of a.members) await this.repo.patchPost(m.key, { clusterId: keep });
      await this.repo.deleteCluster(absorb);
      const snaps = await this.repo.snapshotsFor(absorb);
      for (const s of snaps) await this.repo.upsertSnapshot({ ...s, clusterId: keep });
      await this.persist(k, (await this.repo.getCluster(keep)) ?? {}, now);
    }
    return plans.length;
  }
}
