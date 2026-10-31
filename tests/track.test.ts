import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis.ts';
import { flightTrack } from '../src/core/track.ts';
import { HOME, link, log, north, span, type Row } from './helpers.ts';

const EXTRA = ['GSpd(kmh)', 'Hdg(°)'];
const M_PER_DEG = 111320;
const lonM = (lon: number) => (lon - HOME[1]) * M_PER_DEG * Math.cos((HOME[0] * Math.PI) / 180);

// Armed for the given rows, with a short preflight and landing around them.
function trackOf(rows: Row[], extra = EXTRA) {
  const last = rows[rows.length - 1]!.s;
  const all = [...span(0, 4, () => link('ACRO*')), ...rows, ...span(last + 1, last + 3, () => link('ACRO*'))].map((r) => ({ ...r, extra: r.extra ?? extra.map(() => '0') }));
  const a = analyse(log(all, extra), 'Quad-2026-10-30-100000.csv', 'tx15');
  return flightTrack(a, a.flights[0]!);
}
const moving = (s: number, gps: [number, number], kmh: number, hdg: number, alt = 50): Row => ({ s, ...link('ACRO', { gps, alt, extra: [String(kmh), String(hdg)] }) });

describe('flight path', () => {
  it('follows course and speed between fixes instead of a straight line', () => {
    // 100 m north in 2 s at 180 km/h, setting off to the east
    const tr = trackOf([moving(5, HOME, 180, 90), moving(6, HOME, 180, 90), moving(7, north(100), 180, 0), moving(8, north(100), 180, 0)]);
    const pts = tr.path[0]!.filter((p) => p[0] > 6 && p[0] < 7);
    expect(pts.length).toBeGreaterThanOrEqual(4); // a point every 0.2 s
    expect(Math.max(...pts.map((p) => lonM(p[1])))).toBeGreaterThan(5);
    const times = tr.path[0]!.map((p) => p[0]);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('stays straight where the course points away from the next fix', () => {
    const tr = trackOf([moving(5, HOME, 180, 180), moving(6, HOME, 180, 180), moving(7, north(100), 180, 180)]);
    expect(tr.path[0]!.every((p) => Math.abs(lonM(p[1])) < 0.01)).toBe(true);
  });

  it('a fix missing for 3 s or more leaves a gap, a shorter one is bridged', () => {
    const fly = (from: number, to: number, skip: [number, number]) =>
      span(from, to, (s) => (s >= skip[0] && s <= skip[1] ? link('ACRO', { gps: undefined, alt: 50 }) : link('ACRO', { gps: north(s * 5), alt: 50 })));
    expect(trackOf(fly(5, 30, [12, 12])).path).toHaveLength(1);
    expect(trackOf(fly(5, 30, [12, 15])).path).toHaveLength(2);
  });

  it('standing still holds the position until the model moves again', () => {
    const rows = [...span(5, 15, () => link('ACRO', { gps: HOME, alt: 50 })), ...span(16, 20, (s) => link('ACRO', { gps: north((s - 15) * 10), alt: 50 }))];
    const tr = trackOf(rows, []);
    const at14 = tr.path[0]!.find((p) => p[0] === 15);
    expect(at14?.[2]).toBe(HOME[0]);
  });

  it('heights above home, in metres; values per line, none without telemetry', () => {
    const ft = (s: number, alt: number): Row => ({ s, ...link('ACRO', { gps: north(s * 5), alt }) });
    const rows = [ft(5, 1000), ft(6, 1100), { s: 7 }, { s: 8 }, ft(9, 1100)];
    const a = analyse(log([...span(0, 4, () => link('ACRO*', { alt: 1000 })), ...rows, ...span(10, 12, () => link('ACRO*', { alt: 1000 }))]).replace('Alt(m)', 'Alt(ft)'), 'Quad-2026-10-30-100000.csv', 'tx15');
    const tr = flightTrack(a, a.flights[0]!);
    const p6 = tr.path[0]!.find((p) => p[0] === 6)!;
    expect(p6[3]).toBeCloseTo(30.48, 1);
    expect(tr.units.alt).toBe('ft');
    expect(tr.rows.values.alt!.slice(5, 9)).toEqual([1000, 1100, null, null]);
    expect(tr.modes).toEqual(['ACRO*', 'ACRO']);
    expect(tr.rows.fm!.slice(4, 8)).toEqual([0, 1, 1, null]);
  });
});
