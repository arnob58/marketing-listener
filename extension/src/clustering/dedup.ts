import { hamming } from '../features/phash';
import { MIN_CAPTION_CHARS, estimateJaccard } from '../features/minhash';

export interface PostFeatures {
  phash: string | null;
  minhash: number[];
  imageVec: number[] | null;
  textVec: number[] | null;
  textChars: number;
  /** Platform id of the sound the post uses, when known. */
  audioId?: string | null;
}

export interface ComparablePost {
  key: string;
  authorKey: string;
  features: PostFeatures;
}

export interface DedupThresholds {
  dhashMaxDistance: number;
  minhashJaccard: number;
}

export type DuplicateReason = 'phash' | 'minhash';

export interface DuplicateMatch {
  key: string;
  reason: DuplicateReason;
  score: number;
}

/** Flat or near-flat images hash to (almost) all zeros or ones and would match anything. */
export function isInformativeHash(hash: string | null): hash is string {
  if (!hash) return false;
  let ones = 0;
  for (const ch of hash) ones += parseInt(ch, 16).toString(2).replace(/0/g, '').length;
  return ones >= 8 && ones <= 56;
}

/** Stage 2: near-duplicate by perceptual hash or caption MinHash. */
export function findNearDuplicate(
  candidate: PostFeatures,
  pool: ComparablePost[],
  t: DedupThresholds,
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  const canHash = isInformativeHash(candidate.phash);
  const canText = candidate.textChars >= MIN_CAPTION_CHARS && candidate.minhash.length > 0;
  for (const other of pool) {
    if (canHash && isInformativeHash(other.features.phash)) {
      const d = hamming(candidate.phash!, other.features.phash);
      if (d <= t.dhashMaxDistance) {
        const score = 1 - d / 64;
        if (!best || score > best.score) best = { key: other.key, reason: 'phash', score };
      }
    }
    if (canText && other.features.textChars >= MIN_CAPTION_CHARS) {
      const j = estimateJaccard(candidate.minhash, other.features.minhash);
      if (j >= t.minhashJaccard && (!best || j > best.score)) best = { key: other.key, reason: 'minhash', score: j };
    }
  }
  return best;
}

/**
 * Stage 2b: the same sound used by a different account. The same account reusing its own
 * sound (including an owner's "original audio") says nothing about a trend, so it never matches.
 */
export function findSharedAudio(candidate: ComparablePost, pool: ComparablePost[]): ComparablePost | null {
  const id = candidate.features.audioId;
  if (!id) return null;
  return pool.find((o) => o.features.audioId === id && o.authorKey !== candidate.authorKey) ?? null;
}
