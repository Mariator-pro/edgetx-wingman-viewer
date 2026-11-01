import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis.ts';
import type { AntennaRose } from '../src/core/kinds.ts';
import { noProjects, parseLipoConfig } from '../src/core/projects.ts';
import { flightTrack } from '../src/core/track.ts';
import type { TrackView } from '../src/server/api.ts';
import { roseResult } from '../src/ui/antennas.ts';
import { TEXTS } from '../src/ui/texts.ts';
import { coloring, colorChoices, levelsOf } from '../src/ui/track.ts';
import { link, log, north, span, type Row } from './helpers.ts';

const FILE = 'Quad-2026-10-30-100000.csv';

// Armed from 5 s, with a short preflight and landing around the rows; extra columns default to 0.
function flight(rows: Row[], extra: string[], projects = noProjects()) {
  const last = rows[rows.length - 1]!.s;
  const fill = (r: Row) => ({ ...r, extra: r.extra ?? extra.map(() => '0') });
  const all = [...span(0, 4, () => link('ACRO*')), ...rows, ...span(last + 1, last + 3, () => link('ACRO*'))].map(fill);
  const a = analyse(log(all, extra), FILE, 'tx15', projects);
  return { a, f: a.flights[0]!, track: flightTrack(a, a.flights[0]!) };
}

// Out to the north and back: antenna 2 is 10 dB weaker while the radio is behind the model (flying away).
const outAndBack = (cols: (out: boolean) => string[]) => [
  ...span(5, 40, (s) => link('ACRO', { gps: north(20 + (s - 5) * 10), extra: cols(true) })),
  ...span(41, 76, (s) => link('ACRO', { gps: north(370 - (s - 41) * 10), extra: cols(false) })),
];
const rssi2 = (out: boolean) => String(out ? -70 : -60);

describe('antenna comparison', () => {
  it('sorts by where the radio is as seen from the model, by its heading', () => {
    const { track } = flight(outAndBack((out) => [rssi2(out), out ? '0' : '180']), ['2RSS(dB)', 'Hdg(°)']);
    const rose = track.antennas!;
    expect(rose.basis).toBe('model');
    expect(rose.sectors[4]).toBe(10); // radio behind
    expect(rose.sectors[0]).toBe(0); // radio in front
    expect(roseResult(rose, TEXTS.en)).toBe('Antenna 2 is 10.0 dB weaker when the radio is behind the model. Check how it’s mounted.');
  });

  it('takes Yaw before Hdg, in radians as logged', () => {
    const { track } = flight(outAndBack((out) => [rssi2(out), out ? '0' : '3.1416', out ? '180' : '0']), ['2RSS(dB)', 'Yaw(rad)', 'Hdg(°)']);
    expect(track.antennas!.sectors[4]).toBe(10);
  });

  it('without a heading sorts by where the model is from takeoff', () => {
    const { track } = flight(outAndBack((out) => [rssi2(out)]), ['2RSS(dB)']);
    expect(track.antennas!.basis).toBe('compass');
    expect(track.antennas!.sectors[0]).toBe(5); // out and back both north: mixed
    expect(roseResult(track.antennas!, TEXTS.de)).toBe('Antenne 2 ist in jeder Richtung etwa 5,0 dB schwächer. Prüfe Kabel und Stecker.');
  });

  it('has none without a second antenna or near home', () => {
    expect(flight(outAndBack(() => ['0', '0']), ['2RSS(dB)', 'Hdg(°)']).track.antennas).toBeUndefined();
    const near = span(5, 60, () => link('ACRO', { gps: north(10), extra: ['-70', '0'] }));
    expect(flight(near, ['2RSS(dB)', 'Hdg(°)']).track.antennas).toBeUndefined();
  });

  it('says so when both antennas are equally strong', () => {
    const rose: AntennaRose = { basis: 'model', sectors: [1, 2, null, -1, 0.5, null, null, 2.5], counts: [9, 9, 0, 9, 9, 0, 0, 9] };
    expect(roseResult(rose, TEXTS.en)).toBe('Both antennas are about equally strong in every direction.');
  });
});

describe('warning levels and pack', () => {
  const CORES = ['LNst', 'LNpk', 'LSst', 'GHst'];
  const rows = span(5, 40, (s) => link('ACRO', { gps: north(s * 5), extra: [s >= 30 ? '2' : '0', s < 8 ? '0' : '3', s >= 20 ? '1' : '0', s >= 35 ? '3' : '0'] }));

  it('colors the path by the level of one core or the worst of all', () => {
    const { track } = flight(rows, CORES);
    const tv = { ...track, key: 'k', start: '', duration: 0, takeoff: 0, landing: 0, events: [], hints: [] } satisfies TrackView;
    expect(colorChoices(tv)).toEqual(expect.arrayContaining(['lnst', 'lsst', 'stage']));
    const at = (s: number) => tv.rows.t.findIndex((x) => x === s);
    expect(levelsOf(tv, 'stage')![at(25)]).toBe(1);
    expect(levelsOf(tv, 'stage')![at(32)]).toBe(2);
    expect(levelsOf(tv, 'lsst')![at(10)]).toBe(0);
    const c = coloring(tv, 'lnst');
    expect(c.levels).toHaveLength(3);
    expect(c.row(at(32))).toEqual(c.levels![2]);
    // no core sensor in the log: no choice
    const plain = flight(span(5, 40, (s) => link('ACRO', { gps: north(s * 5) })), []).track;
    expect(colorChoices({ ...plain, key: 'k', start: '', duration: 0, takeoff: 0, landing: 0, events: [], hints: [] })).not.toContain('stage');
  });

  it("finds the flight's pack in Lipo Nanny's settings, retired ones in the archive", () => {
    const lipo = parseLipoConfig(`return {
      ["batteries"] = { { ["id"] = "bat_001", ["name"] = "6s 1300", ["chemistry"] = "LiPo", ["cells"] = 6, ["capacityMah"] = 1300,
        ["instances"] = { { ["id"] = "pack_0003", ["label"] = 2, ["cycles"] = 47, ["wear"] = 5, ["lastUsed"] = "2026-10-14" } } } },
      ["archive"] = { ["pack_0001"] = { ["name"] = "4s 850", ["cycles"] = 12, ["lastUsed"] = "2026-07-01" } },
    }`);
    expect(lipo.packs[3]).toEqual({ battery: '6s 1300', label: '2', chemistry: 'LiPo', cells: 6, capacity: 1300, cycles: 47, wear: 5, lastUsed: '2026-10-14' });
    expect(lipo.packs[1]).toEqual({ battery: '4s 850', cycles: 12, lastUsed: '2026-07-01', retired: true });
    const { f } = flight(rows, CORES, { ...noProjects(), ...lipo });
    expect(f.pack).toMatchObject({ n: 3, battery: '6s 1300', cycles: 47 });
    expect(TEXTS.en.packName(f.pack!)).toBe('6s 1300 #2');
    expect(TEXTS.de.packName({ n: 1, ...lipo.packs[1] })).toBe('4s 850 (ausgemustert)');
    expect(TEXTS.en.packName({ n: 9 })).toBe('Pack 9');
  });
});
