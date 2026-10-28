import type { AttributionLabel, EvidenceItem } from '../core/types';
import type { AttributionContext, Signal } from './attribution';
import type { AnalysisConfig } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const handle = (authorKey: string) => `@${authorKey.split(':')[1] ?? authorKey}`;

function direction(c: number): EvidenceItem['direction'] {
  return c > 0 ? 'content' : c < 0 ? 'publisher' : 'neutral';
}

/** Turns numeric signals into hedged, human-readable evidence and a list of what is unknown. */
export function explain(
  signals: Signal[],
  ctx: AttributionContext,
  label: AttributionLabel,
  confidence: number,
  cfg: AnalysisConfig,
): { evidence: EvidenceItem[]; missingData: string[]; summary: string } {
  const evidence: EvidenceItem[] = [];
  const missing: string[] = [];
  const who = handle(ctx.focal.authorKey);
  const by = Object.fromEntries(signals.map((s) => [s.id, s])) as Record<Signal['id'], Signal>;

  const add = (s: Signal, text: string) => evidence.push({ signal: s.id, direction: direction(s.contribution), text });

  const adoption = by.adoption;
  const n = ctx.independent.accounts.length;
  if (n >= cfg.minTrendAccounts) {
    const names = ctx.independent.accounts.slice(0, 4).map(handle).join(', ');
    add(adoption, `${n} independent accounts posted this concept (${names}${n > 4 ? ', ...' : ''}), which suggests independent adoption rather than one publisher.`);
  } else {
    add(adoption, `Only ${n} independent account${n === 1 ? '' : 's'} posted this concept so far (${cfg.minTrendAccounts} needed to suggest independent adoption).`);
  }
  if (ctx.independent.propagation.length) {
    evidence.push({
      signal: 'adoption',
      direction: 'neutral',
      text: `${ctx.independent.propagation.length} further account${ctx.independent.propagation.length === 1 ? '' : 's'} only reposted, quoted or repeated it and were not counted as independent.`,
    });
  }

  if (ctx.sharedAudio) {
    const { accounts, title } = ctx.sharedAudio;
    evidence.push({
      signal: 'audio',
      direction: 'content',
      text: `${accounts} independent accounts used this sound${title ? ` ("${title}")` : ''}, a sign the audio itself is being picked up.`,
    });
  }

  const over = by.overperformance;
  if (over.available) {
    const z = over.observed.z as number;
    const sample = over.observed.baselineN as number;
    add(
      over,
      `${who}'s engagement (${fmt(ctx.focal.engagement.value)}) sits ${z >= 0 ? '+' : ''}${z.toFixed(1)} robust standard deviations from its own baseline (${sample} other sampled posts); ${
        over.contribution > 0
          ? 'evidence suggests it over-performed for this account.'
          : over.contribution < 0
            ? 'that is in line with, or below, what this account normally gets.'
            : 'that is a modest deviation.'
      }`,
    );
  } else {
    missing.push(
      `baseline unknown for ${who} (${ctx.baselineSample} other sampled post${ctx.baselineSample === 1 ? '' : 's'}; ${cfg.minBaselinePosts} needed). Use "Sample baseline" on its profile page.`,
    );
  }

  const noAdopt = by.noAdoption;
  if (noAdopt.contribution < 0) {
    add(noAdopt, `High engagement (${fmt(ctx.focal.engagement.value)}) with no independent adoption suggests the reach comes from the publisher's own audience.`);
  }

  const small = by.smallAccount;
  if (small.available) {
    if (small.contribution > 0) {
      add(small, `${who} has about ${fmt(ctx.followers!.value)} followers but engagement of ${fmt(ctx.focal.engagement.value)}, so the content reached well beyond its audience.`);
    }
  } else {
    missing.push(`follower count unknown for ${who}.`);
  }

  const cross = by.crossPlatform;
  if (cross.contribution > 0) add(cross, `The concept appears on ${ctx.platforms.length} platforms (${ctx.platforms.join(', ')}), which suggests it is spreading by itself.`);

  const prior = by.tierPrior;
  if (prior.contribution < 0) {
    add(prior, `${who} is ${ctx.verified ? 'a verified account' : `a large account (about ${fmt(ctx.followers?.value ?? 0)} followers)`}, a weak prior toward publisher-driven reach.`);
  }

  const uncertain = ctx.focal.engagement.high - ctx.focal.engagement.low;
  if (uncertain > 0) {
    missing.push(`exact engagement counts are abbreviated on the platform (range ${fmt(ctx.focal.engagement.low)}-${fmt(ctx.focal.engagement.high)} for the lead post).`);
  }
  if (!evidence.length) evidence.push({ signal: 'adoption', direction: 'neutral', text: 'No signal had enough data to point either way.' });

  const confidencePct = Math.round(confidence * 100);
  const summary =
    label === 'Insufficient evidence'
      ? `Evidence is too thin to say whether this is content- or publisher-driven (confidence ${confidencePct}%).`
      : `Evidence suggests: ${label.toLowerCase()} (confidence ${confidencePct}%). This is an estimate from the posts seen in your feeds, not a certainty.`;

  return { evidence, missingData: missing, summary };
}
