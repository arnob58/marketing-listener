import { describe, expect, it } from 'vitest';
import { isInformativeHash } from '../../src/clustering/dedup';
import { dHash, hamming, rgbaToGray } from '../../src/features/phash';
import { adjust, cropEdges, recompress, rescale, resize, syntheticImage } from '../helpers/images';

const DHASH_THRESHOLD = 10;
const BASES = 60;

function evaluate(threshold: number) {
  const bases = Array.from({ length: BASES }, (_, i) => syntheticImage(1000 + i));
  const hashes = bases.map(dHash);
  let tp = 0;
  let fn = 0;
  let fp = 0;
  const missed: string[] = [];

  bases.forEach((img, i) => {
    const variants: Record<string, string> = {
      identical: dHash(img),
      recompressed: dHash(recompress(img, i)),
      brightness: dHash(adjust(img, 1.08, 10)),
      rescaled: dHash(rescale(img)),
      cropped: dHash(cropEdges(img, 0.04)),
      'recompressed+cropped': dHash(cropEdges(recompress(img, i + 99, 20, 5), 0.03)),
    };
    for (const [name, h] of Object.entries(variants)) {
      if (hamming(hashes[i], h) <= threshold) tp++;
      else {
        fn++;
        missed.push(`${i}:${name}=${hamming(hashes[i], h)}`);
      }
    }
  });

  for (let i = 0; i < BASES; i++) {
    for (let j = i + 1; j < BASES; j++) if (hamming(hashes[i], hashes[j]) <= threshold) fp++;
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn), tp, fp, fn, missed };
}

describe('dHash', () => {
  it('merges reposted, recompressed, rescaled and cropped copies (precision >= 0.95, recall >= 0.90)', () => {
    const { precision, recall, missed, tp, fp, fn } = evaluate(DHASH_THRESHOLD);
    console.info(`dHash synthetic set: precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} (tp=${tp} fp=${fp} fn=${fn})`);
    expect(recall, `missed: ${missed.join(', ')}`).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps unrelated images far apart on average', () => {
    const d: number[] = [];
    for (let i = 0; i < 30; i++) d.push(hamming(dHash(syntheticImage(i)), dHash(syntheticImage(i + 500))));
    expect(d.reduce((a, b) => a + b, 0) / d.length).toBeGreaterThan(20);
  });

  it('is a 16 char hex string and hamming is symmetric', () => {
    const a = dHash(syntheticImage(1));
    const b = dHash(syntheticImage(2));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(a, b)).toBe(hamming(b, a));
    expect(hamming(a, a)).toBe(0);
  });

  it('handles non-square images and converts RGBA to luma', () => {
    const wide = resize(syntheticImage(3), 96, 48);
    expect(dHash(wide)).toMatch(/^[0-9a-f]{16}$/);
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(Array.from(rgbaToGray(rgba, 2, 1).data)).toEqual([76, 150]);
  });

  it('flat images are not informative enough to match on', () => {
    const flat = { data: new Uint8Array(64 * 64).fill(128), width: 64, height: 64 };
    expect(isInformativeHash(dHash(flat))).toBe(false);
    expect(isInformativeHash(dHash(syntheticImage(7)))).toBe(true);
    expect(isInformativeHash(null)).toBe(false);
  });
});
