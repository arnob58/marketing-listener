import type { AnalysisService } from '../analysis/service';
import type { ClusterDetail, ContentMessage, Stats, UiRequest, UiResponseMap } from '../core/messages';
import type { Settings } from '../core/settings';
import { buildExportBundle } from '../export/export';
import type { Repository } from '../storage/repositories';
import type { FeatureQueue } from './featureQueue';
import type { IngestService } from './ingest';

export interface RouterDeps {
  repo: Repository;
  ingest: IngestService;
  analysis: AnalysisService;
  queue: FeatureQueue;
  now: () => number;
  loadSettings: () => Promise<Settings>;
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

/** Message handling kept free of chrome.* so it can be tested directly. */
export function createRouter(deps: RouterDeps) {
  const { repo, ingest, analysis, queue, now } = deps;

  async function handleContent(msg: ContentMessage): Promise<void> {
    if (msg.type === 'posts') {
      const t = now();
      for (const post of msg.posts) await ingest.ingestPost(post, t);
    } else if (msg.type === 'profile') {
      await ingest.ingestProfile(msg.profile, now());
    }
  }

  async function handleUi<T extends UiRequest>(req: T): Promise<UiResponseMap[T['type']]> {
    type R = UiResponseMap[T['type']];
    switch (req.type) {
      case 'ui:reports':
        return (await analysis.allReports(now())) as R;
      case 'ui:cluster': {
        const report = await analysis.report(req.id, now());
        if (!report) return null as R;
        const posts = await repo.postsInCluster(req.id);
        const authors = new Set(posts.map((p) => p.authorKey));
        const accounts = (await repo.allAccounts()).filter((a) => authors.has(a.key));
        const detail: ClusterDetail = { report, posts, accounts, snapshots: await repo.snapshotsFor(req.id) };
        return detail as R;
      }
      case 'ui:settings':
        return (await deps.loadSettings()) as R;
      case 'ui:saveSettings':
        return (await deps.saveSettings(req.patch)) as R;
      case 'ui:health':
        return (await repo.allHealth()) as R;
      case 'ui:purgeAll':
        await repo.purgeAll();
        return true as R;
      case 'ui:export': {
        const [reports, posts, accounts] = await Promise.all([analysis.allReports(now()), repo.allPosts(), repo.allAccounts()]);
        return buildExportBundle({ reports, posts, accounts, now: now() }) as R;
      }
      case 'ui:stats': {
        const stats: Stats = {
          posts: await repo.db.posts.count(),
          clusters: await repo.db.clusters.count(),
          accounts: await repo.db.accounts.count(),
          observations: await repo.countObservations(),
          pendingFeatures: await repo.db.posts.where('featureState').equals('pending').count(),
        };
        return stats as R;
      }
    }
  }

  return { handleContent, handleUi, drain: () => queue.drain() };
}

export type Router = ReturnType<typeof createRouter>;
