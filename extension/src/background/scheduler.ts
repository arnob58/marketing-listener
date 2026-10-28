import type { AnalysisService } from '../analysis/service';
import type { ClusterService } from '../clustering/service';
import type { Repository } from '../storage/repositories';

export const ALARM_DRAIN = 'drain-features';
export const ALARM_DAILY = 'daily-maintenance';

export interface MaintenanceDeps {
  repo: Repository;
  cluster: ClusterService;
  analysis: AnalysisService;
  retentionDays: () => Promise<number>;
}

export interface MaintenanceResult {
  merged: number;
  snapshots: number;
  purged: number;
}

/** Daily job: merge converged clusters, snapshot every cluster, apply retention. */
export async function runDailyMaintenance(deps: MaintenanceDeps, now: number): Promise<MaintenanceResult> {
  const merged = await deps.cluster.mergePass(now);
  const snapshots = (await deps.analysis.snapshotAll(now)).length;
  const purged = await deps.repo.purgeOlderThan(await deps.retentionDays(), now);
  return { merged, snapshots, purged };
}

type Alarms = Pick<typeof chrome.alarms, 'create' | 'get'>;

/** Registers recurring alarms once; safe to call on every service-worker start. */
export async function registerAlarms(alarms: Alarms): Promise<void> {
  if (!(await alarms.get(ALARM_DRAIN))) alarms.create(ALARM_DRAIN, { periodInMinutes: 1 });
  if (!(await alarms.get(ALARM_DAILY))) alarms.create(ALARM_DAILY, { periodInMinutes: 24 * 60 });
}
