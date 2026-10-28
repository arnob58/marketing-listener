import type { AnalysisPost } from './types';

const BRAND_SUFFIXES = /(official|news|tv|hq|uk|us|usa|eu|inc|co|app|team|support|global|media|studio|studios)$/;

/** Reduces a handle to a family key so "acme", "acme_news" and "AcmeOfficial" group together. */
export function familyKey(handle: string): string {
  let h = handle.toLowerCase().replace(/[^a-z0-9]/g, '');
  let prev = '';
  while (prev !== h) {
    prev = h;
    h = h.replace(BRAND_SUFFIXES, '').replace(/\d+$/, '');
  }
  return h;
}

export interface IndependenceResult {
  /** One representative author key per independent account family. */
  accounts: string[];
  /** Author keys that appear in the cluster but are propagation or duplicates. */
  propagation: string[];
  /** Posts by independent accounts that count toward the cluster (originals). */
  originals: AnalysisPost[];
}

/**
 * Independent accounts: distinct authors of original posts. Reposts, quotes and
 * repeat posts by the same account (or the same name family) add nothing.
 */
export function independentAccounts(posts: AnalysisPost[]): IndependenceResult {
  const originals = posts.filter((p) => p.kind === 'original');
  const families = new Map<string, string>(); // family -> first author key
  const accounts: string[] = [];
  const usedAuthors = new Set<string>();
  const sorted = [...originals].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  const counted: AnalysisPost[] = [];

  for (const p of sorted) {
    const fam = familyKey(p.authorHandle);
    const isNumericId = /^id\d+$/.test(p.authorHandle);
    const famKey = !fam || isNumericId ? p.authorKey : fam;
    if (usedAuthors.has(p.authorKey)) continue;
    usedAuthors.add(p.authorKey);
    if (families.has(famKey) || (fam.length >= 5 && [...families.keys()].some((k) => k.length >= 5 && (k.startsWith(fam) || fam.startsWith(k))))) {
      continue;
    }
    families.set(famKey, p.authorKey);
    accounts.push(p.authorKey);
    counted.push(p);
  }

  const independent = new Set(accounts);
  const propagation = [
    ...new Set(
      posts
        .filter((p) => p.kind !== 'original' || !independent.has(p.authorKey))
        .map((p) => p.authorKey)
        .concat(posts.flatMap((p) => p.repostedBy)),
    ),
  ].filter((a) => !independent.has(a));

  return { accounts, propagation, originals: counted };
}
