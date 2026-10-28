import { hashString, normalizeCaption } from '../core/hash';

export const MINHASH_PERMUTATIONS = 64;
/** Captions shorter than this are too generic to be matched by overlap alone. */
export const MIN_CAPTION_CHARS = 24;

function shingles(text: string, size = 3): Set<string> {
  const words = normalizeCaption(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

export function minhash(text: string): number[] {
  const sh = [...shingles(text)];
  const sig = new Array<number>(MINHASH_PERMUTATIONS).fill(Infinity);
  for (const s of sh) {
    for (let p = 0; p < MINHASH_PERMUTATIONS; p++) {
      const h = hashString(s, p + 1);
      if (h < sig[p]) sig[p] = h;
    }
  }
  return sh.length ? sig : [];
}

export function estimateJaccard(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}
