import { describe, expect, it } from 'vitest';
import { addMetrics, engagementScore, exact, median, parseCount, relativeUncertainty } from '../../src/core/metrics';

describe('parseCount', () => {
  it.each([
    ['999', 999, 999, 999],
    ['1,234', 1234, 1234, 1234],
    ['1.2K', 1200, 1150, 1250],
    ['12K', 12000, 11500, 12500],
    ['1.2M', 1200000, 1150000, 1250000],
    ['1,2 k', 1200, 1150, 1250],
    ['1,2 K', 1200, 1150, 1250],
    ['0', 0, 0, 0],
    ['2.5K', 2500, 2450, 2550],
    ['1 234', 1234, 1234, 1234],
    ['3.4B', 3400000000, 3350000000, 3450000000],
    ['1.2 million', 1200000, 1150000, 1250000],
  ])('%s -> {%d, %d, %d}', (input, value, low, high) => {
    expect(parseCount(input)).toEqual({ value, low, high });
  });

  it('keeps the true value inside the stored range for abbreviated counts', () => {
    const m = parseCount('12K')!;
    for (const truth of [11500, 12000, 12499]) {
      expect(truth).toBeGreaterThanOrEqual(m.low);
      expect(truth).toBeLessThanOrEqual(m.high);
    }
  });

  it.each(['', '  ', 'abc', 'K', '12 likes', null, undefined, '1.2.3K'])('rejects %j', (input) => {
    expect(parseCount(input as string)).toBeNull();
  });

  it('tolerates surrounding whitespace and non-breaking spaces', () => {
    expect(parseCount('  1.2K ')?.value).toBe(1200);
    expect(parseCount('1,2 k')?.value).toBe(1200);
  });
});

describe('metric arithmetic', () => {
  it('adds ranges component-wise and ignores nulls', () => {
    expect(addMetrics(parseCount('1K'), null, exact(5))).toEqual({ value: 1005, low: 505, high: 1505 });
  });

  it('weights comments and shares above likes and excludes views', () => {
    const e = engagementScore({ likes: exact(10), comments: exact(5), shares: exact(2), views: exact(100000) });
    expect(e.value).toBe(10 + 10 + 6);
  });

  it('reports relative uncertainty', () => {
    expect(relativeUncertainty(exact(100))).toBe(0);
    expect(relativeUncertainty(parseCount('1.2K')!)).toBeCloseTo(50 / 1200, 5);
  });

  it('median handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
