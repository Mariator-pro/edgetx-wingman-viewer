import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis.ts';
import { exportFlight, exportName, toCsv } from '../src/core/export.ts';
import { paths, type Paths } from '../src/core/paths.ts';
import { analyseLogs, logsAt, readCard, storedLogs, syncCard } from '../src/core/store.ts';
import { HOME, link, log, north, off, span, type Row } from './helpers.ts';

const flight = (from: number): Row[] => [
  ...span(from, from + 4, () => link('ACRO*')),
  ...span(from + 5, from + 45, (s) => link('ACRO', { gps: north((s - from) * 5), alt: 20 })),
  ...span(from + 46, from + 47, () => link('ACRO*')),
  ...span(from + 48, from + 50, off),
];

let dir: string;
let card: string;
let p: Paths;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wingman-viewer-'));
  card = join(dir, 'card');
  p = paths(join(dir, 'data'));
  for (const d of ['RADIO', 'MODELS', 'LOGS', 'SCRIPTS/SNTNL']) await mkdir(join(card, d), { recursive: true });
  await writeFile(join(card, 'RADIO', 'radio.yml'), 'board: tx15\nstickMode: 1\n');
  await writeFile(join(card, 'MODELS', 'model01.yml'), 'header:\n   name: "Quad"\n');
  await writeFile(join(card, 'SCRIPTS', 'SNTNL', 'config.lua'), 'return { ["rqlyThreshold"] = 50 }\n');
  await writeFile(join(card, 'LOGS', 'Quad-2026-10-30.csv'), log(flight(0)));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('SD card and the logs the app keeps', () => {
  it('finds the radio type, and none that leads elsewhere', async () => {
    expect(await readCard(card)).toEqual({ volume: card, board: 'tx15' });
    await writeFile(join(card, 'RADIO', 'radio.yml'), 'board: "../x"\n');
    expect((await readCard(card))?.board).toBe('unknown');
    await writeFile(join(card, 'RADIO', 'radio.yml'), 'board: __proto__\n');
    expect((await readCard(card))?.board).toBe('unknown');
    expect(await readCard(join(card, 'LOGS'))).toBeUndefined();
  });

  it('copies new and grown logs with the time of the card, counts new flights, reads the card only', async () => {
    const c = (await readCard(card))!;
    const first = await syncCard(c, p);
    expect(first).toEqual({ board: 'tx15', logs: ['Quad-2026-10-30.csv'], newFlights: 1 });
    const copy = join(p.logs, 'tx15', 'Quad-2026-10-30.csv');
    expect((await stat(copy)).mtimeMs).toBeCloseTo((await stat(join(card, 'LOGS', 'Quad-2026-10-30.csv'))).mtimeMs, -3);
    expect(await readFile(join(p.projects, 'tx15', 'SCRIPTS', 'SNTNL', 'config.lua'), 'utf8')).toContain('50');
    expect(await readFile(join(p.projects, 'tx15', 'MODELS', 'model01.yml'), 'utf8')).toContain('Quad');

    expect((await syncCard(c, p)).logs).toEqual([]);

    // the daily file grows by a second flight
    await writeFile(join(card, 'LOGS', 'Quad-2026-10-30.csv'), log([...flight(0), ...flight(100)]));
    const later = new Date(Date.now() + 60000);
    await utimes(join(card, 'LOGS', 'Quad-2026-10-30.csv'), later, later);
    expect(await syncCard(c, p)).toEqual({ board: 'tx15', logs: ['Quad-2026-10-30.csv'], newFlights: 1 });
  });

  it('reads the kept logs with the project data of their radio, including the stick mode', async () => {
    await syncCard((await readCard(card))!, p);
    const refs = await storedLogs(p);
    expect(refs).toEqual([{ path: join(p.logs, 'tx15', 'Quad-2026-10-30.csv'), board: 'tx15', projectsRoot: join(p.projects, 'tx15') }]);
    const [a] = await analyseLogs(refs);
    expect(a!.model).toBe('Quad');
    expect(a!.flights).toHaveLength(1);
    expect(a!.stickMode).toBe(2); // EdgeTX counts from 0
  });

  it('reads logs at a path: a file, a folder, an SD card or its LOGS folder', async () => {
    const file = join(card, 'LOGS', 'Quad-2026-10-30.csv');
    expect(await logsAt(file)).toEqual([{ path: file, board: 'tx15', projectsRoot: card }]);
    expect(await logsAt(card)).toEqual([{ path: file, board: 'tx15', projectsRoot: card }]);
    expect(await logsAt(join(card, 'LOGS'))).toEqual([{ path: file, board: 'tx15', projectsRoot: card }]);
    const loose = join(dir, 'loose');
    await mkdir(loose);
    await writeFile(join(loose, 'a.csv'), log(flight(0)));
    expect(await logsAt(loose)).toEqual([{ path: join(loose, 'a.csv'), board: 'imported', projectsRoot: undefined }]);
    expect(await logsAt(join(dir, 'missing'))).toEqual([]);
  });
});

describe('export', () => {
  const a = () => analyse(log([...flight(0), ...flight(100)]), 'Quad <1>-2026-10-30.csv', 'tx15');

  it('names files after model and start', () => {
    expect(exportName(a(), a().flights[1]!, 'gpx')).toBe('Quad_1_-2026-10-30-100145.gpx');
  });

  it('GPX with time and altitude from preflight to the last line, text escaped', () => {
    const gpx = exportFlight(a(), a().flights[0]!, 'gpx');
    expect(gpx).toContain('<name>Quad &lt;1&gt; 2026-10-30 10:00:05</name>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(48);
    expect(gpx).toContain(`<trkpt lat="${Number(north(25)[0].toFixed(6))}" lon="${HOME[1]}"><ele>20.0</ele><time>2026-10-30T`);
  });

  it('KML with a time track', () => {
    const kml = exportFlight(a(), a().flights[0]!, 'kml');
    expect(kml).toContain('<gx:Track>');
    expect(kml.match(/<when>/g)).toHaveLength(48);
    expect(kml.match(/<gx:coord>/g)).toHaveLength(48);
  });

  it('CSV with the header and exactly the lines of the flight', () => {
    const x = a();
    const csv = toCsv(x, x.flights[1]!).trim().split('\n');
    expect(csv[0]).toBe(x.log.schemas[0]!.header);
    expect(csv).toHaveLength(1 + 48);
    expect(csv[1]).toContain('10:01:40');
  });
});
