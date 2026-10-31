import { describe, expect, it } from 'vitest';
import { extent, fitCurve, formatDelta, formatValue, type Series } from '../src/ui/series.ts';

const volt: Series = { id: 'volt', name: 'RxBt', label: 'Battery', unit: 'V', digits: 2, values: [] };

describe('chart values', () => {
  it('finds smallest and largest value, ignoring missing ones', () => {
    expect(extent([null, 3, -1, null, 7])).toEqual([-1, 7]);
    expect(extent([null, 3, -1, null, 7], 3, 4)).toEqual([7, 7]);
    expect(extent([null, null])).toBeUndefined();
  });

  it('writes values and differences with sign and unit', () => {
    expect(formatValue(volt, 22.4, 'de-DE')).toBe('22,40 V');
    expect(formatDelta(volt, -0.8, 'de-DE')).toBe('−0,80 V');
    expect(formatDelta({ ...volt, id: 'alt', unit: 'm', digits: 0 }, 40, 'en-US')).toBe('+40 m');
  });

  it('fits a curve through a point cloud, also with large values', () => {
    const xs = Array.from({ length: 50 }, (_, i) => 1000 + i * 20);
    const fit = fitCurve(xs, xs.map((x) => 3 + 0.5 * x - 0.0002 * x * x))!;
    expect(fit(1500)).toBeCloseTo(3 + 750 - 450, 3);
    expect(fitCurve([1, 2], [1, 2])).toBeUndefined();
  });
});
