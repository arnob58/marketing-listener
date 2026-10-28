import { logEngagement, relativeUncertainty } from '../core/metrics';
import type { AttributionLabel, Classification, Metric } from '../core/types';
import { baselineExcluding, zScore } from './baseline';
import { explain } from './explain';
import { independentAccounts, type IndependenceResult } from './independence';
import { DEFAULT_ANALYSIS, type AnalysisConfig, type AnalysisPost, type ClusterInput } from './types';

export type SignalId = 'overperformance' | 'adoption' | 'noAdoption' | 'smallAccount' | 'crossPlatform' | 'tierPrior';

export interface Signal {
  id: SignalId;
  /** Relative importance; also the unit of the confidence calculation. */
  weight: number;
  /** True when the data needed to evaluate the signal exists. */
  available: boolean;
  /** Log-odds toward content-driven (positive) or publisher-driven (negative). */
  contribution: number;
  observed: Record<string, number | string | boolean | null>;
}

export interface AttributionContext {
  focal: AnalysisPost;
  independent: IndependenceResult;
  platforms: string[];
  baselineSample: number;
  followers: Metric | null;
  verified: boolean;
  /** The sound shared by the most independent accounts, when at least two share one. */
  sharedAudio: { id: string; title: string; accounts: number } | null;
}

export const WEIGHTS: Record<SignalId, number> = {
  overperformance: 3, // strong
  adoption: 3, // strong
  noAdoption: 2, // moderate
  smallAccount: 2, // moderate
  crossPlatform: 2, // moderate
  tierPrior: 1, // weak
};

export const MIN_CONFIDENCE = 0.35;
export const MAX_CONFIDENCE = 0.9;
const CONTENT_THRESHOLD = 0.65;
const PUBLISHER_THRESHOLD = 0.35;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Independent accounts (one post each) that used the same sound; null unless two or more did. */
export function sharedAudioAmong(originals: AnalysisPost[]): AttributionContext['sharedAudio'] {
  const byId = new Map<string, { title: string; accounts: Set<string> }>();
  for (const p of originals) {
    if (!p.audio?.id) continue;
    const g = byId.get(p.audio.id) ?? { title: p.audio.title, accounts: new Set<string>() };
    g.accounts.add(p.authorKey);
    byId.set(p.audio.id, g);
  }
  let best: AttributionContext['sharedAudio'] = null;
  for (const [id, g] of byId) if (g.accounts.size >= 2 && (!best || g.accounts.size > best.accounts)) best = { id, title: g.title, accounts: g.accounts.size };
  return best;
}

export function pickFocal(independent: IndependenceResult, posts: AnalysisPost[]): AnalysisPost {
  const pool = independent.originals.length ? independent.originals : posts;
  return pool.reduce((best, p) => (p.engagement.value > best.engagement.value ? p : best), pool[0]);
}

export function computeSignals(input: ClusterInput, cfg: AnalysisConfig = DEFAULT_ANALYSIS) {
  const independent = independentAccounts(input.posts);
  const focal = pickFocal(independent, input.posts);
  const account = input.accounts.get(focal.authorKey);
  const followers = account?.followers ?? null;
  const verified = account?.verified ?? false;
  const platforms = [...new Set(input.posts.map((p) => p.platform))];
  const nAccounts = independent.accounts.length;
  const { baseline, sample } = baselineExcluding(input.history.get(focal.authorKey), focal.key, cfg.minBaselinePosts);

  const signals: Signal[] = [];

  // Over-performance against the account's own baseline.
  const z = baseline ? zScore(logEngagement(focal.engagement), baseline) : null;
  let zc = 0;
  if (z !== null) {
    if (z >= 2) zc = 1.5 + Math.min(1, (z - 2) / 4);
    else if (Math.abs(z) < 1) zc = -1.5;
    else if (z <= -1) zc = -1;
  }
  signals.push({ id: 'overperformance', weight: WEIGHTS.overperformance, available: z !== null, contribution: zc, observed: { z, baselineN: baseline?.n ?? sample } });

  // Independent adoption.
  const ac = nAccounts >= cfg.minTrendAccounts ? Math.min(2.5, 1.5 + 0.3 * (nAccounts - cfg.minTrendAccounts)) : 0;
  signals.push({ id: 'adoption', weight: WEIGHTS.adoption, available: true, contribution: ac, observed: { accounts: nAccounts, needed: cfg.minTrendAccounts } });

  // High engagement without anyone else picking it up.
  const high = focal.engagement.value >= cfg.highEngagement;
  signals.push({
    id: 'noAdoption',
    weight: WEIGHTS.noAdoption,
    available: true,
    contribution: nAccounts <= 1 && high ? -0.8 : 0,
    observed: { accounts: nAccounts, engagement: focal.engagement.value, high },
  });

  // A small account whose engagement outstrips its audience.
  const ratio = followers && followers.value > 0 ? focal.engagement.value / followers.value : null;
  const small = followers !== null && followers.value < cfg.smallAccountFollowers;
  signals.push({
    id: 'smallAccount',
    weight: WEIGHTS.smallAccount,
    available: followers !== null,
    contribution: small && ratio !== null && ratio >= 1 ? 1 : 0,
    observed: { followers: followers?.value ?? null, ratio, small },
  });

  // Appearing on more than one platform.
  signals.push({
    id: 'crossPlatform',
    weight: WEIGHTS.crossPlatform,
    available: true,
    contribution: platforms.length >= 2 ? 1 : 0,
    observed: { platforms: platforms.length },
  });

  // Weak prior: large or verified accounts tend to publish to an existing audience.
  const large = (followers?.value ?? 0) >= cfg.largeAccountFollowers || verified;
  signals.push({
    id: 'tierPrior',
    weight: WEIGHTS.tierPrior,
    available: followers !== null || verified,
    contribution: large ? -0.4 : 0,
    observed: { followers: followers?.value ?? null, verified, large },
  });

  const ctx: AttributionContext = { focal, independent, platforms, baselineSample: sample, followers, verified, sharedAudio: sharedAudioAmong(independent.originals) };
  return { signals, ctx };
}

function dataQuality(posts: AnalysisPost[]): number {
  const widths = posts.map((p) => relativeUncertainty(p.engagement));
  const mean = widths.reduce((a, b) => a + b, 0) / (widths.length || 1);
  const precision = 1 - Math.min(0.5, mean * 4);
  const sample = Math.min(1, 0.7 + 0.1 * posts.length);
  return precision * sample;
}

export function classifyCluster(input: ClusterInput, cfg: AnalysisConfig = DEFAULT_ANALYSIS): Classification {
  const { signals, ctx } = computeSignals(input, cfg);
  const logOdds = signals.reduce((s, x) => s + (x.available ? x.contribution : 0), 0);
  const score = Math.min(0.98, Math.max(0.02, sigmoid(logOdds)));

  const total = signals.reduce((s, x) => s + x.weight, 0);
  const avail = signals.filter((x) => x.available).reduce((s, x) => s + x.weight, 0);
  const confidence = Math.min(MAX_CONFIDENCE, (avail / total) * dataQuality(input.posts));

  let label: AttributionLabel;
  if (confidence < MIN_CONFIDENCE) label = 'Insufficient evidence';
  else if (score >= CONTENT_THRESHOLD) label = 'Likely content-driven';
  else if (score <= PUBLISHER_THRESHOLD) label = 'Likely publisher-driven';
  else label = 'Mixed';

  const baselineSamples: Record<string, number> = {};
  for (const [author, pts] of input.history) baselineSamples[author] = pts.length;

  const { evidence, missingData, summary } = explain(signals, ctx, label, confidence, cfg);
  return {
    label,
    score,
    confidence,
    evidence,
    missingData,
    sampleSizes: {
      posts: input.posts.length,
      independentAccounts: ctx.independent.accounts.length,
      platforms: ctx.platforms.length,
      baselineSamples,
    },
    summary,
  };
}
