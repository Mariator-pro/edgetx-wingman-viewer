import { describe, expect, it } from 'vitest';
import type { TrackView } from '../src/server/api.ts';
import { fromTakeoff } from '../src/ui/format.ts';
import { extent, fitCurve, formatDelta, formatValue, paint, seriesOf, STRIP_COLORS, timeTicks, type Series } from '../src/ui/series.ts';
import { TEXTS } from '../src/ui/texts.ts';
import { nearestPoint, summaryOf } from '../src/ui/track.ts';
import { bundle, eventTone, HINT_TONE } from '../src/ui/marks.ts';
import type { PathPoint } from '../src/core/kinds.ts';

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

  it('shows angles in degrees: as the attitude view with it, else from rad, yaw 0 to 360°', () => {
    const extra = [
      { name: 'Ptch', unit: 'rad', values: [0.5] },
      { name: 'Yaw', unit: 'rad', values: [-Math.PI / 2] },
      { name: 'RSNR', unit: 'dB', values: [9] },
    ];
    const tr = { rows: { t: [0], values: {} }, names: {}, units: {}, extra } as unknown as TrackView;
    const by = (all: Series[], name: string) => all.find((s) => s.name === name)!;
    const plain = seriesOf(tr, TEXTS.en);
    expect(by(plain, 'Ptch').values[0]).toBeCloseTo(28.6, 1);
    expect(by(plain, 'Yaw').values[0]).toBeCloseTo(270, 5);
    expect(formatValue(by(plain, 'Yaw'), 270, 'en-US')).toBe('270°');
    expect(by(plain, 'RSNR').unit).toBe('dB');
    const withView = seriesOf({ ...tr, attitude: { pitch: [-28.6], roll: [0], yaw: [270] } }, TEXTS.en);
    expect(by(withView, 'Ptch').values[0]).toBe(-28.6);
  });
});

describe('time in the Viewer', () => {
  it('counts from takeoff, before it with a minus', () => {
    expect([fromTakeoff(155, 10), fromTakeoff(10, 10), fromTakeoff(8.5, 10), fromTakeoff(10 + 30, 10.4)]).toEqual(['+2:25', '+0:00', '−0:02', '+0:29']);
  });

  it('puts marks on the time axis at whole steps from takeoff, at most 8', () => {
    expect(timeTicks([0, 180], 25, 800)).toEqual([25, 55, 85, 115, 145, 175]);
    expect(timeTicks([30, 50], 25, 800)).toEqual([30, 35, 40, 45, 50]);
    expect(timeTicks([0, 180], 25, 200).length).toBeLessThanOrEqual(2);
  });
});

describe('pointing at the path', () => {
  it('takes the point drawn nearest to the pointer', () => {
    const seg: PathPoint[] = [0, 1, 2, 3].map((i) => [i * 10, i, 0, 0, 0, i]);
    const onScreen = (p: PathPoint): [number, number] => [p[1] * 100, 50];
    expect(nearestPoint(seg, onScreen, 180, 52)?.[0]).toBe(20);
    expect(nearestPoint([], onScreen, 0, 0)).toBeUndefined();
  });
});

describe('marks above the timeline', () => {
  it('bundles marks too close to tell apart, in time order', () => {
    const m = (t: number, hint = false) => ({ t, name: String(t), tone: hint ? HINT_TONE : eventTone('takeoff'), hint });
    const groups = bundle([m(94, true), m(10), m(91, true), m(150)], (t) => t / 160, 400);
    expect(groups.map((g) => g.map((x) => x.t))).toEqual([[10], [91, 94], [150]]);
    expect(bundle([m(91), m(94)], (t) => t / 160, 2000)).toHaveLength(2); // wide enough apart
  });
});

describe('summary of a flight', () => {
  it('finds the extremes between takeoff and landing, with their time', () => {
    const tr = {
      takeoff: 1,
      landing: 3,
      rows: { t: [0, 1, 2, 3, 4], values: { volt: [16.8, 16.1, 14.9, 15.2, 0], gspd: [0, 20, 55, 10, 0], lq: [100, null, 40, 90, 100] } },
    } as unknown as TrackView;
    expect(summaryOf(tr)).toEqual([
      { k: 'gspd', v: 55, t: 2 },
      { k: 'volt', v: 14.9, t: 2 },
      { k: 'lq', v: 40, t: 2 },
    ]);
  });
});

describe('colors of the charts', () => {
  it('keeps the color of a value while it is shown, a new one takes the first free color', () => {
    const before = paint({}, ['alt', 'volt']);
    const after = paint(before, ['volt', 'curr']);
    expect(after.volt).toBe(before.volt);
    expect(after.curr).toBe(STRIP_COLORS[0]); // alt's color is free again
  });
});
