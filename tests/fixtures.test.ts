// Logs written by the EdgeTX simulator (scripts/sim-logs.ts): SD cards with RADIO/, MODELS/, the cores'
// settings and LOGS/. Timing in the simulator varies a little, so only the course of events is checked.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFlight } from '../src/core/export.ts';
import { analyseLogs, logsAt } from '../src/core/store.ts';

const card = (name: string) => join(import.meta.dirname, 'fixtures', name);
const load = async (name: string) => (await analyseLogs(await logsAt(card(name))))[0]!;
const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

describe('simulator: two flights in one log (ELRS, Betaflight, sensors of the cores)', () => {
  it('reads radio, model and both flights; the cut off last line is skipped', async () => {
    const a = await load('elrs-two-flights');
    expect(a.board).toBe('tx16s');
    expect(a.stickMode).toBe(1); // the simulator's radio settings
    expect(a.model).toBe('Sample Quad');
    expect(a.log.skipped).toBe(1);
    expect(a.flights).toHaveLength(2);
  });

  it('first flight: takeoff, GPS lost, return to home, landing; hints from the cores', async () => {
    const [f] = (await load('elrs-two-flights')).flights;
    expect(kinds(f!.events)).toEqual(['takeoff', 'gps-lost', 'rth', 'gps-back', 'landing']);
    expect(f!.end - f!.start).toBeGreaterThan(70000);
    expect(f!.maxDistance).toBeGreaterThan(550);
    expect(new Set(kinds(f!.hints))).toEqual(new Set(['gps-lost', 'max-distance', 'link-warning', 'link-critical', 'battery-warning', 'battery-critical']));
  });

  it('second flight: out 250 m, crash, disarmed far out', async () => {
    const [, f] = (await load('elrs-two-flights')).flights;
    expect(kinds(f!.events)).toEqual(['takeoff', 'landing']);
    expect(f!.maxDistance).toBeGreaterThan(200);
    expect(f!.maxDistance).toBeLessThan(300);
  });

  it('exports both as GPX and KML', async () => {
    const a = await load('elrs-two-flights');
    for (const f of a.flights) {
      expect(exportFlight(a, f, 'gpx').match(/<trkpt /g)!.length).toBeGreaterThan(15);
      expect(exportFlight(a, f, 'kml')).toContain('<when>');
    }
  });
});

describe('simulator: one log per day, sensors added between two flights', () => {
  it('reads the second flight with the header from the model file', async () => {
    const a = await load('daily-sensor-added');
    expect(a.flights).toHaveLength(2);
    expect(a.log.schemas.map((s) => s.fromModel)).toEqual([false, true]);
    expect(a.log.schemas[1]!.columns.map((c) => c.name)).toContain('LNst');
    const [first, second] = a.flights;
    expect(a.log.lines[a.samples[first!.first]!.i]!.schema).toBe(0);
    expect(a.log.lines[a.samples[second!.first]!.i]!.schema).toBe(1);
    expect(a.samples[second!.last]!.values.lnst).toBe(0);
    expect(a.samples[first!.last]!.values.lnst).toBeUndefined();
    // the cut off line where the second flight was appended, and the last line
    expect(a.log.skipped).toBe(2);
  });

  it('exports the second flight as CSV with the rebuilt header', async () => {
    const a = await load('daily-sensor-added');
    const csv = exportFlight(a, a.flights[1]!, 'csv').split('\n');
    expect(csv[0]).toContain('VSpd(m/s),LNst,LNpk,LSst,GHst,Rud');
    expect(csv[1]!.split(',')).toHaveLength(csv[0]!.split(',').length);
  });
});
