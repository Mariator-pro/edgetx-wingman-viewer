import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis.ts';
import { fmDisarmed } from '../src/core/flights.ts';
import { noProjects } from '../src/core/projects.ts';
import { HOME, link, log, north, off, span, T0, type Row } from './helpers.ts';

const at = (s: number) => T0 + s * 1000;
const kinds = (rows: Row[], extra?: string[]) => analyse(log(rows, extra), 'Quad-2026-10-30-100000.csv', 'tx15').flights.map((f) => f.events.map((e) => `${e.kind}@${(e.t - T0) / 1000}`));

describe('arming from the flight mode text', () => {
  it('knows the markers of Betaflight, INAV and ArduPilot', () => {
    expect(['ACRO*', 'ANGL!', 'HOR?', 'OK', 'WAIT', '!ERR', 'STAB *'].every(fmDisarmed)).toBe(true);
    expect(['ACRO', '!FS!', 'RTH', 'ANGL'].some(fmDisarmed)).toBe(false);
  });
});

describe('flights', () => {
  it('a flight from arming to disarming, preflight lines included, zeros around left out', () => {
    const rows = [...span(0, 4, off), ...span(5, 14, () => link('ACRO*')), ...span(15, 74, () => link('ACRO')), ...span(75, 80, () => link('ACRO*')), ...span(81, 90, off)];
    const a = analyse(log(rows), 'Quad-2026-10-30-100000.csv', 'tx15');
    expect(a.flights).toHaveLength(1);
    const f = a.flights[0]!;
    expect(a.samples[f.first]!.t).toBe(at(5));
    expect(a.samples[f.last]!.t).toBe(at(80));
    expect(f.start).toBe(at(15));
    expect(f.end).toBe(at(75));
    expect(kinds(rows)).toEqual([['takeoff@15', 'landing@75']]);
  });

  it('link up without arming is no flight', () => {
    expect(kinds([...span(0, 60, () => link('ACRO*')), ...span(61, 70, off), ...span(71, 80, () => link('ACRO*'))])).toEqual([]);
  });

  it('a link loss while armed, back within 30 s, is the same flight', () => {
    const rows = [...span(0, 4, () => link('ACRO*')), ...span(5, 40, () => link('ACRO')), ...span(41, 50, off), ...span(51, 70, () => link('ACRO')), ...span(71, 72, () => link('ACRO*')), ...span(73, 80, off)];
    expect(kinds(rows)).toEqual([['takeoff@5', 'link-lost@41', 'link-back@51', 'landing@71']]);
  });

  it('a short gap under 1.5 s is bridged', () => {
    const rows = [...span(0, 4, () => link('ACRO*')), ...span(5, 20, () => link('ACRO')), { s: 21 }, ...span(22, 30, () => link('ACRO')), ...span(31, 32, () => link('ACRO*'))];
    expect(kinds(rows)).toEqual([['takeoff@5', 'landing@31']]);
  });

  it('a link loss while armed that does not come back ends the flight with the loss', () => {
    const rows = [...span(0, 4, () => link('ACRO*')), ...span(5, 40, () => link('ACRO')), ...span(41, 100, off)];
    const a = analyse(log(rows), 'Quad-2026-10-30-100000.csv', 'tx15');
    expect(kinds(rows)).toEqual([['takeoff@5', 'link-lost@41']]);
    expect(a.flights[0]!.end).toBe(at(40));
  });

  it('back after more than 30 s is a new start (preflight), disarmed before the loss ends the flight', () => {
    const rows = [
      ...span(0, 4, () => link('ACRO*')),
      ...span(5, 40, () => link('ACRO')),
      ...span(41, 45, () => link('ACRO*')),
      ...span(46, 60, off),
      ...span(61, 65, () => link('ACRO*')),
      ...span(66, 100, () => link('ACRO')),
      ...span(101, 102, () => link('ACRO*')),
    ];
    expect(kinds(rows)).toEqual([
      ['takeoff@5', 'landing@41'],
      ['takeoff@66', 'landing@101'],
    ]);
  });

  it('a jump in time of more than 30 s starts a new flight', () => {
    const rows = [...span(0, 4, () => link('ACRO*')), ...span(5, 40, () => link('ACRO')), ...span(100, 104, () => link('ACRO*')), ...span(105, 140, () => link('ACRO')), ...span(141, 142, () => link('ACRO*'))];
    expect(kinds(rows)).toHaveLength(2);
  });

  it('a text without marker counts as armed only after a disarmed one on this link', () => {
    const rows = [...span(0, 40, () => link('ACRO')), ...span(41, 45, () => link('ACRO*')), ...span(46, 80, () => link('ACRO')), ...span(81, 82, () => link('ACRO*'))];
    expect(kinds(rows)).toEqual([['takeoff@46', 'landing@81']]);
  });

  it('without arming state: each section with telemetry of at least 30 s, gaps inside are link losses', () => {
    const rows = [...span(0, 20, () => link('')), ...span(21, 30, off), ...span(31, 60, () => link('')), ...span(61, 100, off), ...span(101, 110, () => link(''))];
    expect(kinds(rows)).toEqual([['takeoff@0', 'link-lost@21', 'link-back@31', 'landing@60']]);
  });

  it('failsafe, return to home, landing mode and GPS', () => {
    const rows = [
      ...span(0, 4, () => link('ACRO*')),
      ...span(5, 20, () => link('ACRO')),
      ...span(21, 25, () => link('!FS!')),
      ...span(26, 30, () => link('RTH')),
      ...span(31, 40, () => link('ACRO', { gps: undefined, sats: 3 })),
      ...span(41, 50, () => link('ACRO')),
      ...span(51, 52, () => link('ACRO*')),
    ];
    expect(kinds(rows)).toEqual([['takeoff@5', 'failsafe@21', 'rth@26', 'gps-lost@31', 'gps-back@41', 'landing@51']]);
  });
});

describe('flight figures', () => {
  it('distance from home and altitude in the unit of the log', () => {
    const rows = [...span(0, 4, () => link('ACRO*')), ...span(5, 45, (s) => link('ACRO', { gps: north((s - 5) * 10), alt: s })), ...span(46, 47, () => link('ACRO*', { gps: HOME }))];
    const f = analyse(log(rows), 'Quad-2026-10-30-100000.csv', 'tx15').flights[0]!;
    expect(f.maxDistance).toBeCloseTo(400, -1);
    expect(f.maxAlt).toBe(45);
    expect(f.home).toEqual({ lat: HOME[0], lon: HOME[1] });
  });
});

describe('hints', () => {
  const flight = (more: (s: number) => Omit<Row, 's'>) => [...span(0, 4, () => link('ACRO*')), ...span(5, 60, (s) => link('ACRO', more(s))), ...span(61, 62, () => link('ACRO*'))];
  const hints = (rows: Row[], extra?: string[], projects = noProjects()) =>
    analyse(log(rows, extra), 'Quad-2026-10-30-100000.csv', 'tx15', projects).flights[0]!.hints.map((h) => `${h.kind}@${(h.t - T0) / 1000}`);

  it("by Link Sentinel's and Lipo Nanny's limits, held for 2 s", () => {
    const rows = flight((s) => ({ lq: s >= 20 && s < 21 ? 30 : s >= 30 && s < 35 ? 30 : 100, volt: s >= 50 ? 20.5 : 24 }));
    expect(hints(rows)).toEqual(['link-critical@30', 'battery-critical@50']);
  });

  it('with the threshold from the settings of Link Sentinel', () => {
    const rows = flight((s) => ({ lq: s >= 30 && s < 35 ? 48 : 100 }));
    expect(hints(rows)).toEqual([]);
    expect(hints(rows, undefined, { ...noProjects(), rqlyThreshold: 50 })).toEqual(['link-critical@30']);
  });

  it('from the sensors of the cores where the log has them', () => {
    const rows = flight((s) => ({ lq: 20, extra: [s >= 40 ? '2' : s >= 20 ? '1' : '0', '0'] }));
    expect(hints(rows, ['LNst', 'LSst'])).toEqual(['battery-warning@20', 'battery-critical@40']);
  });
});
