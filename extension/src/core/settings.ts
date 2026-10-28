export interface ScanSettings {
  intervalMs: number;
  maxPosts: number;
  maxMs: number;
}

export interface Thresholds {
  dhashMaxDistance: number;
  minhashJaccard: number;
  imageSimilarity: number;
  textSimilarity: number;
  minTrendAccounts: number;
  clusterWindowDays: number;
  /** Minimum sampled posts before an account baseline is trusted. */
  minBaselinePosts: number;
}

export interface Settings {
  scan: ScanSettings;
  thresholds: Thresholds;
  modelOptIn: boolean;
  retentionDays: number;
}

export const SCAN_LIMITS = { maxPosts: 200, minIntervalMs: 1000, maxMs: 15 * 60_000 } as const;

export const DEFAULT_SETTINGS: Settings = {
  scan: { intervalMs: 3000, maxPosts: 50, maxMs: 3 * 60_000 },
  thresholds: {
    dhashMaxDistance: 10,
    minhashJaccard: 0.8,
    imageSimilarity: 0.88,
    textSimilarity: 0.8,
    minTrendAccounts: 3,
    clusterWindowDays: 14,
    minBaselinePosts: 5,
  },
  modelOptIn: false,
  retentionDays: 90,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Applies hard limits so a bad stored value can never lift the scan caps. */
export function sanitizeScan(input: Partial<ScanSettings> | undefined): ScanSettings {
  const d = DEFAULT_SETTINGS.scan;
  return {
    intervalMs: clamp(input?.intervalMs, SCAN_LIMITS.minIntervalMs, 60_000, d.intervalMs),
    maxPosts: Math.floor(clamp(input?.maxPosts, 1, SCAN_LIMITS.maxPosts, d.maxPosts)),
    maxMs: clamp(input?.maxMs, 10_000, SCAN_LIMITS.maxMs, d.maxMs),
  };
}

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const t = { ...DEFAULT_SETTINGS.thresholds, ...(stored?.thresholds ?? {}) };
  return {
    scan: sanitizeScan(stored?.scan),
    thresholds: {
      dhashMaxDistance: clamp(t.dhashMaxDistance, 0, 32, 10),
      minhashJaccard: clamp(t.minhashJaccard, 0.5, 1, 0.8),
      imageSimilarity: clamp(t.imageSimilarity, 0.5, 1, 0.88),
      textSimilarity: clamp(t.textSimilarity, 0.5, 1, 0.8),
      minTrendAccounts: Math.floor(clamp(t.minTrendAccounts, 2, 20, 3)),
      clusterWindowDays: clamp(t.clusterWindowDays, 1, 90, 14),
      minBaselinePosts: Math.floor(clamp(t.minBaselinePosts, 3, 50, 5)),
    },
    modelOptIn: stored?.modelOptIn === true,
    retentionDays: clamp(stored?.retentionDays, 1, 3650, 90),
  };
}

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return mergeSettings(got[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = mergeSettings({ ...current, ...patch, thresholds: { ...current.thresholds, ...patch.thresholds } });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
