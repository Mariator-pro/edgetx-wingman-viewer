import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paths } from '../src/core/paths.ts';
import type { FlightDetailView, FlightView, LicensesView, MapSettingsView, StateView, TrackView } from '../src/server/api.ts';
import { noteServer, runningServer } from '../src/server/running.ts';
import { startServer, type RunningServer } from '../src/server/server.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
let dir: string;
let server: RunningServer;

// Requests as the page makes them: with the key, unless told otherwise.
const api = (path: string, init: RequestInit & { key?: string | null; host?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.key !== null) headers.set('x-wingman-viewer-token', init.key ?? server.token);
  if (init.host) headers.set('host', init.host);
  return fetch(`${server.url}${path}`, { ...init, headers });
};
const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wingman-server-'));
  // a copy of a simulator card, so clean up deletes nothing in the repo
  await cp(join(FIXTURES, 'elrs-two-flights'), join(dir, 'card'), { recursive: true });
  process.env.WINGMAN_VIEWER_VOLUMES = join(dir, 'card');
  server = await startServer({
    paths: paths(join(dir, 'data')),
    port: 0,
    sampleDir: join(import.meta.dirname, '..', 'assets', 'sample'),
    licensesFile: join(dir, 'THIRD_PARTY_LICENSES.txt'),
    pollMs: 60000,
  });
});

afterAll(async () => {
  server.close();
  delete process.env.WINGMAN_VIEWER_VOLUMES;
  await rm(dir, { recursive: true, force: true });
});

describe('server', () => {
  it('answers only with the key and only under its own name; key behind # in the address', async () => {
    expect((await api('/api/state', { key: null })).status).toBe(403);
    expect((await api('/api/state', { key: 'wrong' })).status).toBe(403);
    expect((await fetch(`${server.url}/api/state?token=${server.token}`)).status).toBe(200);
    expect(server.open).toBe(`${server.url}/#token=${server.token}`);
    // fetch can't send another Host: through Node's http
    const status = (host: string) =>
      new Promise<number>((resolve) =>
        request(`${server.url}/api/state`, { headers: { host, 'x-wingman-viewer-token': server.token } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }).end(),
      );
    expect(await status('evil.example')).toBe(403);
    expect(await status('127.0.0.1:1234')).toBe(200);
  });

  it('sends the security headers', async () => {
    const res = await api('/api/state');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('copies the connected SD card on start and lists its flights', async () => {
    const state = (await (await api('/api/state')).json()) as StateView;
    expect(state.radios).toEqual([{ volume: join(dir, 'card'), board: 'tx16s', name: 'RadioMaster TX16S', newFlights: 2, cleanable: 1 }]);
    const flights = (await (await api('/api/flights')).json()) as FlightView[];
    expect(flights.map((f) => [f.model, f.radio, f.hints > 0])).toEqual([
      ['Sample Quad', 'RadioMaster TX16S', true],
      ['Sample Quad', 'RadioMaster TX16S', true],
    ]);
  });

  it('a flight with events, hints and neighbours; note and tags; delete and restore', async () => {
    const [a, b] = (await (await api('/api/flights')).json()) as FlightView[];
    const d = (await (await api(`/api/flight?key=${encodeURIComponent(a!.key)}`)).json()) as FlightDetailView;
    expect(d.events.map((e) => e.kind)).toContain('rth');
    expect(d.next).toBe(b!.key);
    expect((await post('/api/flight/note', { key: a!.key, note: 'Windy' })).status).toBe(200);
    expect((await post('/api/flight/tags', { key: a!.key, tags: ['Training'] })).status).toBe(200);
    expect((await post('/api/flight/tags', { key: a!.key, tags: 'Training' })).status).toBe(400);
    expect((await post('/api/flights/delete', { keys: [a!.key] })).status).toBe(200);
    let list = (await (await api('/api/flights')).json()) as FlightView[];
    expect(list.find((f) => f.key === a!.key)).toMatchObject({ note: 'Windy', tags: ['Training'], deleted: expect.any(String) });
    await post('/api/flights/restore', { keys: [a!.key] });
    list = (await (await api('/api/flights')).json()) as FlightView[];
    expect(list.find((f) => f.key === a!.key)!.deleted).toBeUndefined();
    expect((await api('/api/flight?key=nope')).status).toBe(400);
  });

  it('exports with the key in the address, only known formats', async () => {
    const [a] = (await (await api('/api/flights')).json()) as FlightView[];
    const res = await fetch(`${server.url}/api/export?key=${encodeURIComponent(a!.key)}&format=gpx&token=${server.token}`);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename\*=UTF-8''Sample_Quad-/);
    expect(await res.text()).toContain('<gpx');
    expect((await api(`/api/export?key=${encodeURIComponent(a!.key)}&format=exe`)).status).toBe(400);
  });

  it('opens the built-in sample flight, which is not in the list', async () => {
    const d = (await (await api('/api/flight?key=sample')).json()) as FlightDetailView;
    expect(d).toMatchObject({ sample: true, model: 'Sample Quad' });
    expect(((await (await api('/api/flights')).json()) as FlightView[]).some((f) => f.key === 'sample')).toBe(false);
  });

  it('sends the path of a flight for the map, with values per line and events in seconds', async () => {
    const tr = (await (await api('/api/flight/track?key=sample')).json()) as TrackView;
    expect(tr.path.length).toBeGreaterThan(1); // the GPS gap splits the path
    expect(tr.rows.t).toHaveLength(tr.rows.values.alt!.length);
    expect(tr.modes).toContain('RTH');
    expect(tr.events.map((e) => e.kind)).toContain('takeoff');
    expect(tr.takeoff).toBeGreaterThan(0);
    expect(tr.home).toHaveLength(2);
    // sticks and the log's other sensors, for the values and the charts
    expect(Object.keys(tr.sticks!)).toEqual(['rud', 'ele', 'thr', 'ail']);
    expect(tr.sticks!.thr).toHaveLength(tr.rows.t.length);
    expect(tr.stickMode).toBe(2); // from the sample card's radio settings
    expect(tr.extra!.map((e) => e.name)).toEqual(expect.arrayContaining(['RSNR', 'TPWR', 'Ptch']));
    expect(tr.extra!.map((e) => e.name)).not.toContain('GAlt');
    expect(await (await api('/api/flight/track?key=nope')).json()).toMatchObject({ code: 'flightNotFound' });
  });

  it('keeps the kind of model per model and radio for the attitude view', async () => {
    const track = async (key: string) => (await (await api(`/api/flight/track?key=${encodeURIComponent(key)}`)).json()) as TrackView;
    const tr = await track('sample');
    expect(tr.airframe).toBe('copter'); // the sample flight is a copter until chosen
    expect(tr.attitude!.pitch).toHaveLength(tr.rows.t.length);
    const [a, b] = (await (await api('/api/flights')).json()) as FlightView[];
    expect((await track(a!.key)).airframe).toBeUndefined();
    expect((await post('/api/flight/airframe', { key: a!.key, airframe: 'wing' })).status).toBe(200);
    // the other flight of the same model on the same radio too
    expect((await track(b!.key)).airframe).toBe('wing');
    expect(JSON.parse(await readFile(join(dir, 'data', 'flights.json'), 'utf8')).airframes).toEqual({ 'tx16s/Sample Quad': 'wing' });
    expect((await post('/api/flight/airframe', { key: a!.key, airframe: 'heli' })).status).toBe(400);
    await post('/api/flight/airframe', { key: a!.key, airframe: null });
    expect((await track(a!.key)).airframe).toBeUndefined();
  });

  it('keeps the tile address and the ArcGIS key, and lets the page load tiles only from there', async () => {
    const csp = async () => (await api('/api/state')).headers.get('content-security-policy')!;
    expect(await csp()).toContain('img-src \'self\' data: blob: https://tile.openstreetmap.org;');
    expect(await csp()).toContain("worker-src 'self';");
    expect((await post('/api/map', { tiles: 'http://tiles.example.org/{z}/{x}/{y}.png' })).status).toBe(400);
    expect((await post('/api/map', { tiles: 'https://tiles.example.org/{z}/{x}.png' })).status).toBe(400);
    expect((await post('/api/map', { tiles: 'https://tiles.example.org/{z}/{x}/{y}.png', arcgisKey: 'a b' })).status).toBe(400);
    expect((await post('/api/map', { tiles: 'https://tiles.example.org/{z}/{x}/{y}.png', arcgisKey: 'AAPK.key_1' })).status).toBe(200);
    const m = (await (await api('/api/map')).json()) as MapSettingsView;
    expect(m).toMatchObject({ tiles: 'https://tiles.example.org/{z}/{x}/{y}.png', arcgisKey: 'AAPK.key_1' });
    expect(await csp()).toContain('connect-src \'self\' https://tiles.example.org https://ibasemaps-api.arcgis.com;');
    expect((await post('/api/map', { tiles: m.defaultTiles })).status).toBe(200);
    expect(await csp()).toContain("connect-src 'self' https://tile.openstreetmap.org;");
  });

  it('sends the open source licenses from the build, or says they are missing', async () => {
    expect(await (await api('/api/licenses')).json()).toMatchObject({ code: 'licensesMissing' });
    await writeFile(join(dir, 'THIRD_PARTY_LICENSES.txt'), 'THIRD-PARTY SOFTWARE NOTICES\n');
    const res = await api('/api/licenses');
    expect(res.status).toBe(200);
    expect(((await res.json()) as LicensesView).text).toBe('THIRD-PARTY SOFTWARE NOTICES\n');
  });

  it('imports a log by name; refuses names with a path and too large files', async () => {
    const data = await readFile(join(FIXTURES, 'daily-sensor-added', 'LOGS', 'Daily Quad-2026-10-30.csv'));
    const res = await api('/api/import', { method: 'POST', body: data, headers: { 'x-file-name': encodeURIComponent('Daily Quad-2026-10-30.csv') } });
    expect(await res.json()).toEqual({ count: 1 });
    expect((await api('/api/import', { method: 'POST', body: data, headers: { 'x-file-name': '..%2Fx.csv' } })).status).toBe(400);
    expect(await readdir(join(dir, 'data', 'Logs', 'imported'))).toEqual(['Daily Quad-2026-10-30.csv']);
    const big = await api('/api/import', { method: 'POST', body: Buffer.alloc(101 * 1024 * 1024), headers: { 'x-file-name': 'big.csv' } });
    expect(big.status).toBe(413);
    expect(((await big.json()) as { code: string }).code).toBe('logTooLarge');
  });

  it('cleans up the SD card: deletes logs the app keeps', async () => {
    expect(await (await post('/api/cleanup', { volume: join(dir, 'card') })).json()).toEqual({ count: 1 });
    expect(await readdir(join(dir, 'card', 'LOGS'))).toEqual([]);
    expect((await post('/api/cleanup', { volume: '/elsewhere' })).status).toBe(404);
  });

  it('keeps language, theme and stick mode for the next start, refuses others; limits and bad JSON', async () => {
    expect((await post('/api/prefs', { lang: 'de', theme: 'dark' })).status).toBe(200);
    expect((await post('/api/prefs', { sticks: 1 })).status).toBe(200);
    expect(JSON.parse(await readFile(join(dir, 'data', 'settings.json'), 'utf8')).ui).toEqual({ lang: 'de', theme: 'dark', sticks: 1 });
    expect((await post('/api/prefs', { attitude: 'hidden' })).status).toBe(200);
    expect(JSON.parse(await readFile(join(dir, 'data', 'settings.json'), 'utf8')).ui.attitude).toBe('hidden');
    expect((await post('/api/prefs', { attitude: 'open' })).status).toBe(400);
    expect((await post('/api/prefs', { more: 'shown' })).status).toBe(200);
    expect(JSON.parse(await readFile(join(dir, 'data', 'settings.json'), 'utf8')).ui.more).toBe('shown');
    expect((await post('/api/prefs', { more: 'all' })).status).toBe(400);
    expect((await post('/api/prefs', { theme: 'pink' })).status).toBe(400);
    expect((await post('/api/prefs', { sticks: 5 })).status).toBe(400);
    expect((await api('/api/prefs', { method: 'POST', body: '{x' })).status).toBe(400);
    expect((await api('/api/prefs', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(413);
  });

  it('keeps filters, order and columns of the list, only known values and plain short texts', async () => {
    const list = { model: 'Daily\u0007 Quad', radio: 'x'.repeat(300), deleted: true, sort: 'duration', order: 'ascending', hidden: ['time', 'nope'], other: 1 };
    expect((await post('/api/prefs', { list })).status).toBe(200);
    const kept = JSON.parse(await readFile(join(dir, 'data', 'settings.json'), 'utf8')).ui.list;
    expect(kept).toEqual({ model: 'Daily Quad', radio: 'x'.repeat(200), deleted: true, sort: 'duration', order: 'ascending', hidden: ['time'] });
    expect((await post('/api/prefs', { list: {} })).status).toBe(200);
    expect(JSON.parse(await readFile(join(dir, 'data', 'settings.json'), 'utf8')).ui.list).toEqual({});
    expect((await post('/api/prefs', { list: 'model' })).status).toBe(400);
  });

  it('notes the running server for a second start, only for this user; a note of a killed server does not count', async () => {
    const file = join(dir, 'data', 'server.json');
    const forget = await noteServer(file, server.open);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ url: server.open, pid: process.pid });
    await forget();
    await expect(stat(file)).rejects.toThrow();
    await writeFile(file, JSON.stringify({ url: server.open, pid: 2 ** 22 + 1 }));
    expect(await runningServer(file)).toBeUndefined();
  });
});
