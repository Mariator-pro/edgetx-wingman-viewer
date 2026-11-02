import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis.ts';
import { AIRFRAMES } from '../src/core/kinds.ts';
import { fcFromFM } from '../src/core/flights.ts';
import { flightTrack } from '../src/core/track.ts';
import type { TrackView } from '../src/server/api.ts';
import { airframeMesh } from '../src/ui/airframes.ts';
import { attitudeAt } from '../src/ui/track.ts';
import { link, log, north, span, type Row } from './helpers.ts';

// Armed from 5 s, with a short preflight and landing; extra columns default to 0.
function trackOf(rows: Row[], extra: string[]): TrackView {
  const last = rows[rows.length - 1]!.s;
  const all = [...span(0, 4, () => link('ACRO*')), ...rows, ...span(last + 1, last + 3, () => link('ACRO*'))].map((r) => ({ ...r, extra: r.extra ?? extra.map(() => '0') }));
  const a = analyse(log(all, extra), 'Quad-2026-10-30-100000.csv', 'tx15');
  return { ...flightTrack(a, a.flights[0]!), key: 'k', start: '', duration: 0, takeoff: 0, landing: 0, events: [], hints: [] };
}

describe('attitude', () => {
  it('reads pitch, roll and yaw in degrees, from rad as logged, pitch nose up', () => {
    const tr = trackOf(span(5, 20, (s) => link('ACRO', { gps: north(s * 5), extra: ['0.5', '-0.25', String(-Math.PI / 2)] })), ['Ptch(rad)', 'Roll(rad)', 'Yaw(rad)']);
    const r = tr.rows.t.findIndex((t) => t === 10);
    expect(tr.attitude!.pitch[r]).toBe(-28.6); // Betaflight sends nose down positive
    expect(tr.attitude!.roll[r]).toBe(-14.3);
    expect(tr.attitude!.yaw![r]).toBe(270); // as a heading, 0 to 360
  });

  it('keeps the pitch of ArduPilot, which sends nose up positive, known from its flight mode text', () => {
    const rows = span(5, 20, (s) => ({ ...link('LOIT', { gps: north(s * 5), extra: ['10', '0'] }), s }));
    const all = [...span(0, 4, () => link('LOIT*', { extra: ['0', '0'] })), ...rows];
    const a = analyse(log(all, ['Ptch(°)', 'Roll(°)']), 'Plane-2026-10-30-100000.csv', 'tx15');
    const tr = flightTrack(a, a.flights[0]!);
    expect(tr.attitude!.pitch[tr.rows.t.findIndex((t) => t === 10)]).toBe(10);
    expect(fcFromFM('ANGL*')).toBe('BF');
    expect(fcFromFM('ACRO*')).toBeUndefined(); // both use it
    expect(fcFromFM('WAIT')).toBe('INAV');
  });

  it('takes the course as yaw without Yaw, and shows nothing without pitch and roll', () => {
    const tr = trackOf(span(5, 20, (s) => link('ACRO', { gps: north(s * 5), extra: ['10', '20', '135'] })), ['Ptch(°)', 'Roll(°)', 'Hdg(°)']);
    expect(tr.attitude!.yaw![tr.rows.t.findIndex((t) => t === 10)]).toBe(135);
    expect(trackOf(span(5, 20, (s) => link('ACRO', { gps: north(s * 5), extra: ['135'] })), ['Hdg(°)']).attitude).toBeUndefined();
  });

  it('turns smoothly between two log lines, the short way round', () => {
    const tr = trackOf(
      span(5, 20, (s) => link('ACRO', { gps: north(s * 5), extra: [String(s === 10 ? 0 : 10), '0', s <= 10 ? '350' : '10'] })),
      ['Ptch(°)', 'Roll(°)', 'Yaw(°)'],
    );
    const t10 = tr.rows.t[tr.rows.t.findIndex((t) => t === 10)]!;
    const mid = attitudeAt(tr, t10 + 0.5)!;
    expect(mid.pitch).toBeCloseTo(-5); // halfway between 0 and 10 nose down
    expect(mid.yaw).toBeCloseTo(0); // between 350 and 10, not 180
    expect(attitudeAt(tr, 1)).toBeDefined(); // preflight has telemetry
  });

  it('builds every model in both themes with the front marked orange', () => {
    for (const [kind, theme] of [...AIRFRAMES, 'arrow' as const].flatMap((k) => (['dark', 'light'] as const).map((th) => [k, th] as const))) {
      const m = airframeMesh(kind, theme).body;
      const p = m.positions!.value as Float32Array;
      const c = m.colors!.value as Float32Array;
      const n = m.normals!.value as Float32Array;
      expect(p.length % 9).toBe(0);
      expect(Math.max(...p.map(Math.abs))).toBeLessThan(1.3); // about 2 units across
      for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)).toBeCloseTo(1);
      // orange vertices sit in front of the middle (x forward)
      const orange: number[] = [];
      for (let i = 0; i < c.length; i += 3) if (c[i]! > 0.9 && c[i + 1]! < 0.6) orange.push(p[i]!);
      expect(orange.length).toBeGreaterThan(0);
      expect(orange.reduce((a, x) => a + x, 0) / orange.length).toBeGreaterThan(0.2);
    }
  });
});
