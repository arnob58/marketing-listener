import type { ScanState } from '../content/scanner';
import type { FeatureJob, FeatureResult } from '../features/worker';
import type { ClusterReport } from '../analysis/evaluate';
import type { HealthRecord } from '../storage/db';
import type { Account, ProfileInfo, RawPost, Snapshot, StoredPost } from './types';
import type { Settings } from './settings';
import type { ExportBundle } from '../export/export';

/** Content script -> background. */
export type ContentMessage =
  | { type: 'posts'; posts: RawPost[] }
  | { type: 'profile'; profile: ProfileInfo }
  | { type: 'scan:state'; state: ScanState };

/** Side panel -> content script (via chrome.tabs.sendMessage). */
export type TabCommand =
  | { type: 'scan:start'; settings: Settings['scan'] }
  | { type: 'scan:stop' }
  | { type: 'scan:status' }
  | { type: 'baseline:sample' }
  | { type: 'baseline:scan'; settings: Settings['scan'] }
  | { type: 'debug:snapshot' };

export type TabReply =
  | { ok: true; state?: ScanState; sampled?: number; handle?: string; followers?: number | null; html?: string }
  | { ok: false; reason: string };

/** UI -> background requests. */
export type UiRequest =
  | { type: 'ui:reports' }
  | { type: 'ui:cluster'; id: string }
  | { type: 'ui:settings' }
  | { type: 'ui:saveSettings'; patch: Partial<Settings> }
  | { type: 'ui:health' }
  | { type: 'ui:purgeAll' }
  | { type: 'ui:export' }
  | { type: 'ui:stats' };

export interface ClusterDetail {
  report: ClusterReport;
  posts: StoredPost[];
  accounts: Account[];
  snapshots: Snapshot[];
}

export interface Stats {
  posts: number;
  clusters: number;
  accounts: number;
  observations: number;
  pendingFeatures: number;
}

export interface UiResponseMap {
  'ui:reports': ClusterReport[];
  'ui:cluster': ClusterDetail | null;
  'ui:settings': Settings;
  'ui:saveSettings': Settings;
  'ui:health': HealthRecord[];
  'ui:purgeAll': true;
  'ui:export': ExportBundle;
  'ui:stats': Stats;
}

/** Background -> offscreen document. */
export interface OffscreenRequest {
  target: 'offscreen';
  type: 'features:compute';
  jobs: FeatureJob[];
  embeddings: boolean;
}

export type OffscreenResponse = { ok: true; results: FeatureResult[] } | { ok: false; error: string };
