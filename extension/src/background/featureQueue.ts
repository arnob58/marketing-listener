import type { FeatureJob, FeatureResult } from '../features/worker';
import type { Repository } from '../storage/repositories';

/** How jobs reach whoever computes features (the offscreen document in production). */
export interface FeatureTransport {
  compute(jobs: FeatureJob[], opts: { embeddings: boolean }): Promise<FeatureResult[]>;
}

export interface PostClusterer {
  clusterPost(key: string, now: number): Promise<unknown>;
}

export interface FeatureQueueOptions {
  batchSize: number;
  now: () => number;
  embeddingsEnabled: () => boolean | Promise<boolean>;
}

/** Drains posts waiting for features in small batches, then clusters them. DB-backed so it survives worker restarts. */
export class FeatureQueue {
  private draining: Promise<number> | null = null;

  constructor(
    private readonly repo: Repository,
    private readonly transport: FeatureTransport,
    private readonly clusterer: PostClusterer,
    private readonly opts: FeatureQueueOptions,
  ) {}

  drain(maxBatches = Infinity): Promise<number> {
    this.draining ??= this.run(maxBatches).finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async run(maxBatches: number): Promise<number> {
    let processed = 0;
    for (let b = 0; b < maxBatches; b++) {
      const batch = await this.repo.pendingPosts(this.opts.batchSize);
      if (!batch.length) break;
      const jobs: FeatureJob[] = batch.map((p) => ({
        postKey: p.key,
        imageUrl: p.imageUrls[0] ?? null,
        text: [p.text, ...p.hashtags.filter((h) => !p.text.toLowerCase().includes(`#${h}`)).map((h) => `#${h}`)].join(' '),
      }));
      let results: FeatureResult[];
      try {
        results = await this.transport.compute(jobs, { embeddings: await this.opts.embeddingsEnabled() });
      } catch (e) {
        results = jobs.map((j) => ({ postKey: j.postKey, imageHash: null, textHash: null, error: (e as Error).message }));
      }
      const byKey = new Map(results.map((r) => [r.postKey, r]));
      for (const post of batch) {
        const r = byKey.get(post.key);
        const failed = !r || (r.error !== undefined && !r.imageHash && !r.textHash);
        await this.repo.patchPost(post.key, {
          featureState: failed ? 'failed' : 'done',
          imageHash: r?.imageHash ?? null,
          textHash: r?.textHash ?? post.textHash,
        });
        await this.clusterer.clusterPost(post.key, this.opts.now());
        processed++;
      }
    }
    return processed;
  }
}
