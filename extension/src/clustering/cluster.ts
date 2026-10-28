import { cosine } from '../features/embeddings';
import { findNearDuplicate, findSharedAudio, type ComparablePost, type DedupThresholds, type PostFeatures } from './dedup';

export interface SimilarityThresholds extends DedupThresholds {
  imageSimilarity: number;
  textSimilarity: number;
}

export interface ClusterState {
  id: string;
  centroidImage: number[] | null;
  nImage: number;
  centroidText: number[] | null;
  nText: number;
  members: ComparablePost[];
}

export type AssignmentReason = 'near-duplicate' | 'audio' | 'semantic' | 'new';

export interface Assignment {
  clusterId: string | null;
  /** Key of the post this one is a variant of (near-duplicates only). */
  variantOf: string | null;
  reason: AssignmentReason;
  similarity: number;
}

/** Both modalities within 5% of their thresholds corroborate each other. */
const CORROBORATION_FLOOR = 0.95;
const CORROBORATION_BONUS = 0.05;

/**
 * Similarity as a multiple of the pass threshold (>= 1 passes). The score is the
 * stronger of the image and text cosine ratios, with a small bonus when both
 * modalities are present and each is nearly at its threshold.
 */
export function semanticScore(f: PostFeatures, c: ClusterState, t: SimilarityThresholds): number {
  const ri = f.imageVec && c.centroidImage ? cosine(f.imageVec, c.centroidImage) / t.imageSimilarity : null;
  const rt = f.textVec && c.centroidText ? cosine(f.textVec, c.centroidText) / t.textSimilarity : null;
  if (ri === null && rt === null) return 0;
  if (ri === null) return rt!;
  if (rt === null) return ri;
  const best = Math.max(ri, rt);
  return Math.min(ri, rt) >= CORROBORATION_FLOOR ? best + CORROBORATION_BONUS : best;
}

export function assignPost(post: ComparablePost, clusters: ClusterState[], t: SimilarityThresholds): Assignment {
  const owner = new Map<string, string>();
  const pool: ComparablePost[] = [];
  for (const c of clusters) {
    for (const m of c.members) {
      if (m.key === post.key) continue;
      owner.set(m.key, c.id);
      pool.push(m);
    }
  }
  const dup = findNearDuplicate(post.features, pool, t);
  if (dup) {
    return { clusterId: owner.get(dup.key)!, variantOf: dup.key, reason: 'near-duplicate', similarity: dup.score };
  }

  const audio = findSharedAudio(post, pool);
  if (audio) return { clusterId: owner.get(audio.key)!, variantOf: null, reason: 'audio', similarity: 1 };

  let best: { id: string; score: number } | null = null;
  for (const c of clusters) {
    const score = semanticScore(post.features, c, t);
    if (score >= 1 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best
    ? { clusterId: best.id, variantOf: null, reason: 'semantic', similarity: best.score }
    : { clusterId: null, variantOf: null, reason: 'new', similarity: 0 };
}

function runningMean(centroid: number[] | null, n: number, v: number[]): number[] {
  if (!centroid) return [...v];
  return centroid.map((x, i) => (x * n + v[i]) / (n + 1));
}

/** Adds the post to the cluster and updates the centroids incrementally. */
export function addMember(cluster: ClusterState, post: ComparablePost): void {
  const f = post.features;
  if (f.imageVec) {
    cluster.centroidImage = runningMean(cluster.centroidImage, cluster.nImage, f.imageVec);
    cluster.nImage++;
  }
  if (f.textVec) {
    cluster.centroidText = runningMean(cluster.centroidText, cluster.nText, f.textVec);
    cluster.nText++;
  }
  if (!cluster.members.some((m) => m.key === post.key)) cluster.members.push(post);
}

export function newCluster(id: string, post: ComparablePost): ClusterState {
  const c: ClusterState = { id, centroidImage: null, nImage: 0, centroidText: null, nText: 0, members: [] };
  addMember(c, post);
  return c;
}

export interface MergePlan {
  keep: string;
  absorb: string;
}

/** Nightly pass: clusters whose centroids have converged are joined (larger one kept). */
export function planMerges(clusters: ClusterState[], t: SimilarityThresholds): MergePlan[] {
  const absorbed = new Set<string>();
  const plans: MergePlan[] = [];
  const sorted = [...clusters].sort((a, b) => b.members.length - a.members.length);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (absorbed.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (absorbed.has(b.id)) continue;
      const ri = a.centroidImage && b.centroidImage ? cosine(a.centroidImage, b.centroidImage) / t.imageSimilarity : 0;
      const rt = a.centroidText && b.centroidText ? cosine(a.centroidText, b.centroidText) / t.textSimilarity : 0;
      if (Math.max(ri, rt) >= 1) {
        plans.push({ keep: a.id, absorb: b.id });
        absorbed.add(b.id);
      }
    }
  }
  return plans;
}

/** Applies a merge in memory; centroids are re-weighted by member vector counts. */
export function mergeInto(keep: ClusterState, absorb: ClusterState): void {
  const blend = (a: number[] | null, na: number, b: number[] | null, nb: number) =>
    a && b ? a.map((x, i) => (x * na + b[i] * nb) / (na + nb)) : (a ?? b);
  keep.centroidImage = blend(keep.centroidImage, keep.nImage, absorb.centroidImage, absorb.nImage);
  keep.centroidText = blend(keep.centroidText, keep.nText, absorb.centroidText, absorb.nText);
  keep.nImage += absorb.nImage;
  keep.nText += absorb.nText;
  for (const m of absorb.members) if (!keep.members.some((k) => k.key === m.key)) keep.members.push(m);
}
