import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Library } from '../src/core/library.ts';
import { paths, type Paths } from '../src/core/paths.ts';
import { readCard, syncCard } from '../src/core/store.ts';
import { link, log, north, off, span, type Row } from './helpers.ts';

const flight = (from: number): Row[] => [
  ...span(from, from + 4, () => link('ACRO*')),
  ...span(from + 5, from + 45, (s) => link('ACRO', { gps: north((s - from) * 5) })),
  ...span(from + 46, from + 47, () => link('ACRO*')),
  ...span(from + 48, from + 50, off),
];
const FILE = 'Quad-2026-10-30.csv';
const DAY = 24 * 3600 * 1000;

let dir: string;
let card: string;
let p: Paths;
let lib: Library;

const write = (rows: Row[]) => writeFile(join(card, 'LOGS', FILE), log(rows));
const sync = async () => syncCard((await readCard(card))!, p, await lib.isDeleted());
const exists = (path: string) => stat(path).then(() => true, () => false);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wingman-library-'));
  card = join(dir, 'card');
  p = paths(join(dir, 'data'));
  for (const d of ['RADIO', 'MODELS', 'LOGS']) await mkdir(join(card, d), { recursive: true });
  await writeFile(join(card, 'RADIO', 'radio.yml'), 'board: tx15\n');
  await write([...flight(0), ...flight(100)]);
  lib = new Library(p);
  await sync();
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('notes, tags and deleted flights', () => {
  it('keeps note and tags by flight, also when the copy is replaced by a grown file', async () => {
    const [a] = await lib.list();
    await lib.setNote(a!.key, '  Ridge \u0007line ');
    await lib.setTags(a!.key, ['Training', 'Training', 'Wind']);
    await write([...flight(0), ...flight(100), ...flight(200)]);
    await sync();
    lib.forget();
    const list = await lib.list();
    expect(list).toHaveLength(3);
    expect(list[0]!.marks).toEqual({ note: 'Ridge line', tags: ['Training', 'Wind'] });
    expect(JSON.parse(await readFile(p.flights, 'utf8')).flights[a!.key].note).toBe('Ridge line');
  });

  it('deletes per flight; with all flights of a file deleted the copy goes to the trash, restore brings it back', async () => {
    const [a, b] = await lib.list();
    expect(await lib.remove([a!.key])).toBe(1);
    expect(await exists(join(p.logs, 'tx15', FILE))).toBe(true);
    await lib.remove([b!.key]);
    expect(await exists(join(p.logs, 'tx15', FILE))).toBe(false);
    expect(await exists(join(p.trash, 'tx15', FILE))).toBe(true);
    expect((await lib.list()).every((f) => f.marks.deleted && f.inTrash)).toBe(true);
    expect(await lib.restore([a!.key])).toBe(1);
    expect(await exists(join(p.logs, 'tx15', FILE))).toBe(true);
    const list = await lib.list();
    expect(list.map((f) => !!f.marks.deleted)).toEqual([false, true]);
  });

  it('a copy from the SD card brings deleted flights not back, and they are no new flights', async () => {
    const [a, b] = await lib.list();
    await lib.remove([a!.key, b!.key]);
    expect((await sync()).logs).toEqual([]); // unchanged on the card: stays in the trash
    await write([...flight(0), ...flight(100), ...flight(200)]);
    const r = await sync();
    expect(r.newFlights).toBe(1);
    expect(await exists(join(p.trash, 'tx15', FILE))).toBe(false);
    lib.forget();
    expect((await lib.list()).map((f) => !!f.marks.deleted)).toEqual([true, true, false]);
  });

  it('deleted flights go for good after 30 days or with "Delete now"; the trash copy with nothing left goes too', async () => {
    const [a, b] = await lib.list();
    const now = Date.now();
    await lib.remove([a!.key], now - 31 * DAY);
    expect((await lib.list(now)).map((f) => f.key)).toEqual([b!.key]);
    await lib.remove([b!.key], now);
    expect(await exists(join(p.trash, 'tx15', FILE))).toBe(true);
    expect(await lib.purge([b!.key])).toBe(1);
    expect(await lib.list()).toEqual([]);
    expect(await exists(join(p.trash, 'tx15', FILE))).toBe(false);
    expect((await sync()).newFlights).toBe(0);
  });
});

describe('import and SD card clean up', () => {
  it('imports a log into Logs/imported, refuses names with a path and files that are no log', async () => {
    expect(await lib.importLog('mine.csv', Buffer.from(log(flight(0))))).toBe(1);
    expect(await readdir(join(p.logs, 'imported'))).toEqual(['mine.csv']);
    await expect(lib.importLog('../x.csv', Buffer.from(log(flight(0))))).rejects.toMatchObject({ code: 'notLogFile' });
    await expect(lib.importLog('notes.txt', Buffer.from(log(flight(0))))).rejects.toMatchObject({ code: 'notLogFile' });
    await expect(lib.importLog('notes.csv', Buffer.from('a,b\n1,2\n'))).rejects.toMatchObject({ code: 'notLogFile' });
    expect((await lib.list()).filter((f) => f.log.board === 'imported')).toHaveLength(1);
  });

  it('deletes on the SD card only logs with the same copy in the app', async () => {
    await writeFile(join(card, 'LOGS', 'Other-2026-10-31.csv'), log(flight(0)));
    const c = (await readCard(card))!;
    expect(await lib.cleanable(c)).toEqual([FILE]);
    await write([...flight(0), ...flight(100), ...flight(200)]); // grown since the copy
    expect(await lib.cleanable(c)).toEqual([]);
    await sync(); // copies the grown file and the other one
    expect(await lib.cleanup(c)).toBe(2);
    expect(await readdir(join(card, 'LOGS'))).toEqual([]);
  });
});
