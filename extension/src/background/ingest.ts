import { hashHex, normalizeCaption } from '../core/hash';
import { engagementScore } from '../core/metrics';
import type { RawPost, ProfileInfo, StoredPost } from '../core/types';
import type { Repository } from '../storage/repositories';

/** A post seen again sooner than this records nothing; later it records one metrics observation. */
export const REVISIT_MS = 30 * 60_000;

export type IngestOutcome = 'new' | 'observation' | 'ignored';

export interface FeatureTrigger {
  /** Called when new work is waiting for the feature pipeline. */
  notify(): void;
}

export function toStoredPost(raw: RawPost, now: number): StoredPost {
  const text = raw.text.trim();
  const hasText = normalizeCaption(text).length > 0;
  return {
    key: `${raw.platform}:${raw.postId}`,
    platform: raw.platform,
    postId: raw.postId,
    url: raw.url,
    authorKey: `${raw.platform}:${raw.authorHandle.toLowerCase()}`,
    authorHandle: raw.authorHandle.toLowerCase(),
    text,
    hashtags: raw.hashtags,
    postedAt: raw.postedAt,
    imageUrls: raw.imageUrls,
    hasVideo: raw.hasVideo,
    metrics: raw.metrics,
    engagement: engagementScore(raw.metrics),
    audio: raw.audio,
    surface: raw.surface,
    kind: raw.kind,
    refKey: raw.refPostId ? `${raw.platform}:${raw.refPostId}` : null,
    repostedBy: raw.repostedBy ? [raw.repostedBy] : [],
    firstSeenAt: now,
    lastSeenAt: now,
    featureState: raw.imageUrls.length || hasText ? 'pending' : 'done',
    imageHash: null,
    textHash: hasText ? hashHex(normalizeCaption(text)) : null,
    clusterId: null,
    variantOf: null,
  };
}

export class IngestService {
  constructor(
    private readonly repo: Repository,
    private readonly features: FeatureTrigger,
    private readonly revisitMs = REVISIT_MS,
  ) {}

  async ingestPost(raw: RawPost, now: number): Promise<IngestOutcome> {
    const stored = toStoredPost(raw, now);
    const existing = await this.repo.getPost(stored.key);

    if (!existing) {
      await this.repo.putPost(stored);
      await this.repo.recordHealth(raw.platform, raw.selectorVersion, raw.resolved, now);
      // An unresolved author is a placeholder, not an account worth tracking.
      if (raw.resolved.author) {
        await this.repo.upsertAccount({
          key: stored.authorKey,
          platform: raw.platform,
          handle: stored.authorHandle,
          displayName: raw.authorName,
          followers: null,
          verified: false,
          updatedAt: now,
        });
      }
      if (stored.featureState === 'pending') this.features.notify();
      return 'new';
    }

    const reposters = raw.repostedBy && !existing.repostedBy.includes(raw.repostedBy)
      ? [...existing.repostedBy, raw.repostedBy]
      : existing.repostedBy;

    if (now - existing.lastSeenAt < this.revisitMs) {
      if (reposters !== existing.repostedBy) await this.repo.patchPost(existing.key, { repostedBy: reposters });
      return 'ignored';
    }

    await this.repo.addObservation({
      postKey: existing.key,
      at: now,
      metrics: raw.metrics,
      engagement: stored.engagement,
    });
    await this.repo.patchPost(existing.key, {
      lastSeenAt: now,
      metrics: raw.metrics,
      engagement: stored.engagement,
      repostedBy: reposters,
      // Audio is often only readable on a later sighting; never overwrite a known one with nothing.
      audio: stored.audio ?? existing.audio ?? null,
    });
    return 'observation';
  }

  async ingestProfile(profile: ProfileInfo, now: number): Promise<void> {
    await this.repo.upsertAccount({
      key: `${profile.platform}:${profile.handle.toLowerCase()}`,
      platform: profile.platform,
      handle: profile.handle.toLowerCase(),
      displayName: profile.displayName,
      followers: profile.followers,
      verified: profile.verified,
      updatedAt: now,
    });
  }
}
