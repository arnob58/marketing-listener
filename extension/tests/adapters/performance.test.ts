import { describe, expect, it } from 'vitest';
import { getAdapterForUrl } from '../../src/adapters';
import { median } from '../../src/core/metrics';
import type { Platform } from '../../src/core/types';
import { loadFixture } from '../helpers/fixture';

/**
 * Real-browser timing (median < 2 ms per post) cannot be measured here: happy-dom is
 * several times slower than Chrome's DOM. This guards against pathological regressions
 * (e.g. quadratic scans) and prints the numbers for the record.
 */
describe('extraction cost', () => {
  it.each(['x', 'instagram', 'facebook'] as Platform[])('%s: per-post extraction stays cheap even under a DOM emulator', (platform) => {
    const { doc, url, expected } = loadFixture(platform, 'feed');
    const adapter = getAdapterForUrl(url)!;
    const roots = adapter.findPostRoots(doc);
    for (const r of roots) adapter.extractPost(r, { url, now: expected.now }); // warm up
    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const r of roots) {
        const t0 = performance.now();
        adapter.extractPost(r, { url, now: expected.now });
        samples.push(performance.now() - t0);
      }
    }
    const med = median(samples);
    console.info(`${platform}: median ${med.toFixed(3)} ms/post (happy-dom), p95 ${[...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)].toFixed(3)} ms, ${roots.length} posts`);
    expect(med).toBeLessThan(2);
  });
});
