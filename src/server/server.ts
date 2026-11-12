import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { AppError, errorInfo, type ErrorArgs, type ErrorCode } from '../core/errors.ts';
import { exportFlight, exportName, FORMATS, type ExportFormat } from '../core/export.ts';
import { cleanTags, Library, MAX_IMPORT, MAX_NOTE, type ListedFlight } from '../core/library.ts';
import { isAirframe, isStickMode } from '../core/kinds.ts';
import type { Paths } from '../core/paths.ts';
import { radioName } from '../core/radios.ts';
import { DEFAULT_TILES, ESRI_ORIGIN, listPrefs, loadSettings, saveSettings, tilesOrigin, validKey, validTiles, type MapSettings, type Settings } from '../core/settings.ts';
import { flightTrack } from '../core/track.ts';
import { batteryEdit, changeBattery, changeModel, checkDraft, checkEdits, fixFlightBag, flightBagAction, flightBagApps, flightBagView, isFlightBagPage, modelEdit, readAppIcon, readSound, saveFlightBag } from '../core/flightbag.ts';
import { copyProjects, findCards, readCard, syncCard, type RadioCard } from '../core/store.ts';
import { listVolumes } from '../platform/volumes.ts';
import {
  FILE_NAME_HEADER,
  TOKEN_HASH,
  TOKEN_HEADER,
  withPageData,
  type AppUpdateView,
  type FlightDetailView,
  type FlightView,
  type MapSettingsView,
  type LicensesView,
  type PrefsView,
  type ProgressEvent,
  type StateView,
  type TrackView,
} from './api.ts';

export interface ServerOptions {
  paths: Paths;
  port: number;
  staticDir?: string; // built interface; without it only /api is served (Vite serves the page)
  sampleDir?: string; // the built-in sample flight, as a small SD card
  licensesFile?: string; // THIRD_PARTY_LICENSES.txt from the build, shown under About
  pollMs?: number;
  appUpdates?: AppUpdates; // desktop app only
}

// The desktop app's own updates: the newer release found, and installing it where the app can do that itself.
export interface AppUpdates {
  view: () => AppUpdateView | undefined;
  onChange: (fn: () => void) => void;
  install: (onProgress: (pct: number) => void) => Promise<void>;
}

class HttpError<C extends ErrorCode> extends AppError<C> {
  status: number;
  constructor(status: number, code: C, ...args: ErrorArgs<C>) {
    super(code, ...args);
    this.status = status;
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const EXPORT_TYPES: Record<ExportFormat, string> = {
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  csv: 'text/csv; charset=utf-8',
};

// The page loads only its own files and the map's tiles, and no other site may show it in a frame of its
// own, where it could be clicked unseen.
export function securityHeaders(map: MapSettings = {}): Record<string, string> {
  const tiles = [tilesOrigin(map.tiles ?? DEFAULT_TILES), ...(map.arcgisKey ? [ESRI_ORIGIN] : [])].join(' ');
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${tiles}`,
      "font-src 'self' data:",
      `connect-src 'self' ${tiles}`,
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; '),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // tile servers of OpenStreetMap ask browsers for a referrer; they get only http://localhost:<port>/
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

// The names this computer's browser reaches the server by, on any port (Vite forwards from its own).
const LOCAL_NAMES = ['localhost', '127.0.0.1'];

function hostName(host: string | undefined): string {
  try {
    return host ? new URL(`http://${host}`).hostname : '';
  } catch {
    return '';
  }
}

// A JSON request; the page sends a few KB at most.
const MAX_BODY = 1024 * 1024;

// Too large: the rest is read but not kept, so the page gets the answer instead of a broken connection.
async function rawBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size <= max) chunks.push(c as Buffer);
  }
  if (size > max) throw new HttpError(413, 'invalidRequest', { what: 'too large' });
  return Buffer.concat(chunks);
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const data = await rawBody(req, MAX_BODY);
  try {
    return (data.length ? JSON.parse(data.toString('utf8')) : {}) as T;
  } catch {
    throw new HttpError(400, 'invalidRequest', { what: 'JSON' });
  }
}

// A file instead of JSON: an exported flight, or a sound to play (no download name).
class FileAnswer {
  data: string | Buffer;
  type: string;
  download?: string;
  constructor(data: string | Buffer, type: string, download?: string) {
    this.data = data;
    this.type = type;
    this.download = download;
  }
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data ?? null));
}

// One call at a time; a forced call while one runs is made up for right after it instead of dropped.
export function oneAtATime(fn: (force: boolean) => Promise<void>): (force?: boolean) => Promise<void> {
  let running = false;
  let again = false;
  const call = async (force = false): Promise<void> => {
    if (running) {
      again ||= force;
      return;
    }
    running = true;
    try {
      await fn(force);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      await call(true);
    }
  };
  return call;
}

function openFolder(dir: string): void {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [dir], () => {});
}

const stamp = (t: number) => new Date(t).toISOString().slice(0, 19);

export function flightView(f: ListedFlight): FlightView {
  const { log, flight } = f;
  return {
    key: f.key,
    board: log.board,
    radio: radioName(log.board),
    file: log.file,
    model: log.model,
    start: stamp(flight.start),
    hasDate: log.log.hasDate,
    duration: Math.max(0, flight.end - flight.start),
    ...(flight.maxDistance !== undefined ? { maxDistance: Math.round(flight.maxDistance) } : {}),
    ...(flight.maxAlt !== undefined ? { maxAlt: flight.maxAlt } : {}),
    ...(log.altUnit ? { altUnit: log.altUnit } : {}),
    ...(flight.minVolt !== undefined ? { minVolt: flight.minVolt } : {}),
    ...(flight.usedCapa !== undefined ? { usedCapa: Math.round(flight.usedCapa) } : {}),
    hints: flight.hints.length,
    ...(flight.pack ? { pack: flight.pack } : {}),
    ...(f.marks.note ? { note: f.marks.note } : {}),
    tags: f.marks.tags ?? [],
    ...(f.marks.deleted ? { deleted: f.marks.deleted } : {}),
  };
}

export interface RunningServer {
  url: string;
  token: string;
  open: string; // the address to open the interface at, with the key behind # (never sent to the server)
  page: (html: string) => string; // the page with this start's key and the stored choices, for Vite in development only
  close: () => void;
}

const isKeyList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 10000 && v.every((k) => typeof k === 'string');

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const p = o.paths;
  const token = randomBytes(24).toString('base64url');
  const s: Settings = await loadSettings(p.settings);
  const library = new Library(p, o.sampleDir);

  let cards: RadioCard[] = [];
  const seen = new Map<string, { newFlights: number; cleanable: number }>(); // volume -> since it was connected
  const clients = new Set<ServerResponse>();
  let busy: string | undefined;
  let flightsVersion = 0;

  const send = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const progress = (e: ProgressEvent) => send('progress', e);
  const state = (): StateView => {
    const appUpdate = o.appUpdates?.view();
    return {
      radios: cards.map((c) => ({ volume: c.volume, board: c.board, name: radioName(c.board), newFlights: seen.get(c.volume)?.newFlights ?? 0, cleanable: seen.get(c.volume)?.cleanable ?? 0 })),
      ...(busy ? { busy } : {}),
      ...(s.lastSync ? { lastSync: s.lastSync } : {}),
      flightsVersion,
      ...(appUpdate ? { appUpdate } : {}),
    };
  };
  const pushState = () => send('state', state());
  const changed = () => {
    flightsVersion++;
    pushState();
  };

  // One long operation at a time; the state shows which one runs.
  const op = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (busy) throw new HttpError(409, 'busy', { op: busy });
    busy = name;
    pushState();
    try {
      return await fn();
    } finally {
      busy = undefined;
      pushState();
    }
  };

  // A newly connected SD card: copy new logs and the project data, right away.
  const sync = async (c: RadioCard) => {
    const r = await syncCard(c, p, await library.isDeleted());
    const entry = seen.get(c.volume) ?? { newFlights: 0, cleanable: 0 };
    entry.newFlights += r.newFlights;
    library.forget();
    entry.cleanable = (await library.cleanable(c)).length;
    seen.set(c.volume, entry);
    s.lastSync = new Date().toISOString();
    await saveSettings(p.settings, s);
    if (r.logs.length > 0) flightsVersion++;
  };

  let lastKey = '';
  const poll = oneAtATime(async (force) => {
    const now = await findCards(await listVolumes());
    const key = JSON.stringify(now.map((c) => [c.volume, c.board]));
    if (key === lastKey && !force) return;
    lastKey = key;
    const added = now.filter((c) => !seen.has(c.volume));
    for (const v of seen.keys()) if (!now.some((c) => c.volume === v)) seen.delete(v);
    cards = now;
    for (const c of added) {
      if (busy) {
        lastKey = ''; // try again on the next poll
        break;
      }
      await op('sync', () => sync(c)).catch((e: unknown) => console.error(e));
    }
    pushState();
  });

  const cardAt = async (volume: unknown): Promise<RadioCard> => {
    const c = typeof volume === 'string' && cards.some((x) => x.volume === volume) ? await readCard(volume) : undefined;
    if (!c) throw new HttpError(404, 'radioNotConnected');
    return c;
  };

  const detail = async (key: string): Promise<FlightDetailView> => {
    const f = await library.find(key);
    const list = f.key === 'sample' ? [] : (await library.list()).filter((x) => !!x.marks.deleted === !!f.marks.deleted);
    const i = list.findIndex((x) => x.key === f.key);
    return {
      ...flightView(f),
      events: f.flight.events.map((e) => ({ t: stamp(e.t), kind: e.kind })),
      hintList: f.flight.hints.map((h) => ({ t: stamp(h.t), kind: h.kind })),
      skipped: f.log.log.skipped,
      ...(i > 0 ? { prev: list[i - 1]!.key } : {}),
      ...(i >= 0 && i < list.length - 1 ? { next: list[i + 1]!.key } : {}),
      ...(f.key === 'sample' ? { sample: true } : {}),
    };
  };

  // A Flight Bag request: the connected card and the page.
  const flightBagArgs = async (req: IncomingMessage) => {
    const b = await body<{ volume?: unknown; page?: unknown; edits?: unknown; app?: unknown }>(req);
    if (!isFlightBagPage(b.page)) throw new HttpError(400, 'invalidRequest', { what: 'page' });
    return { card: await cardAt(b.volume), page: b.page, edits: checkEdits(b.edits), app: b.app };
  };
  // After Flight Bag wrote to the card: its settings into the app's copy, and the flights again with them.
  const afterFlightBag = async (c: RadioCard) => {
    await copyProjects(c, p);
    library.forget();
    changed();
  };

  type Route = (req: IncomingMessage, q: URLSearchParams) => Promise<unknown>;
  const routes: Record<string, Route> = {
    'GET /api/state': async () => state(),
    'GET /api/flights': async () => (await library.list()).map(flightView),
    'GET /api/flight': async (_req, q) => detail(q.get('key') ?? ''),
    'GET /api/flight/track': async (_req, q) => {
      const f = await library.find(q.get('key') ?? '');
      const track = flightTrack(f.log, f.flight);
      const airframe = await library.airframe(f);
      const t0 = f.log.samples[f.flight.first]!.t;
      const rel = (t: number) => (t - t0) / 1000;
      const view: TrackView = {
        key: f.key,
        start: stamp(t0),
        duration: rel(f.log.samples[f.flight.last]!.t),
        takeoff: rel(f.flight.start),
        landing: rel(f.flight.end),
        events: f.flight.events.map((e) => ({ t: rel(e.t), kind: e.kind })),
        hints: f.flight.hints.map((h) => ({ t: rel(h.t), kind: h.kind })),
        ...track,
        ...(airframe ? { airframe } : {}),
      };
      return view;
    },
    'GET /api/map': async (): Promise<MapSettingsView> => ({
      tiles: s.map?.tiles ?? DEFAULT_TILES,
      defaultTiles: DEFAULT_TILES,
      ...(s.map?.arcgisKey ? { arcgisKey: s.map.arcgisKey } : {}),
    }),
    'POST /api/map': async (req) => {
      const { tiles, arcgisKey } = await body<{ tiles?: unknown; arcgisKey?: unknown }>(req);
      if (!validTiles(tiles) || (arcgisKey !== undefined && arcgisKey !== '' && !validKey(arcgisKey))) {
        throw new HttpError(400, 'invalidRequest', { what: 'map' });
      }
      s.map = { ...(tiles !== DEFAULT_TILES ? { tiles } : {}), ...(arcgisKey ? { arcgisKey } : {}) };
      await saveSettings(p.settings, s);
    },
    'POST /api/flight/airframe': async (req) => {
      const { key, airframe } = await body<{ key: unknown; airframe: unknown }>(req);
      if (typeof key !== 'string' || (airframe !== null && !isAirframe(airframe))) throw new HttpError(400, 'invalidRequest', { what: 'airframe' });
      await library.setAirframe(key, airframe);
    },
    'POST /api/flight/note': async (req) => {
      const { key, note } = await body<{ key: string; note: string }>(req);
      if (typeof key !== 'string' || typeof note !== 'string' || note.length > MAX_NOTE * 2) throw new HttpError(400, 'invalidRequest', { what: 'note' });
      await library.setNote(key, note);
      changed();
    },
    'POST /api/flight/tags': async (req) => {
      const { key, tags } = await body<{ key: string; tags: unknown }>(req);
      const clean = cleanTags(tags);
      if (typeof key !== 'string' || !clean) throw new HttpError(400, 'invalidRequest', { what: 'tags' });
      await library.setTags(key, clean);
      changed();
    },
    'POST /api/flights/delete': async (req) => {
      const { keys } = await body<{ keys: unknown }>(req);
      if (!isKeyList(keys)) throw new HttpError(400, 'invalidRequest', { what: 'flights' });
      const n = await library.remove(keys);
      changed();
      return { count: n };
    },
    'POST /api/flights/restore': async (req) => {
      const { keys } = await body<{ keys: unknown }>(req);
      if (!isKeyList(keys)) throw new HttpError(400, 'invalidRequest', { what: 'flights' });
      const n = await library.restore(keys);
      changed();
      return { count: n };
    },
    'POST /api/flights/purge': async (req) => {
      const { keys } = await body<{ keys: unknown }>(req);
      if (!isKeyList(keys)) throw new HttpError(400, 'invalidRequest', { what: 'flights' });
      const n = await library.purge(keys);
      changed();
      return { count: n };
    },
    'GET /api/export': async (_req, q) => {
      const format = q.get('format') as ExportFormat;
      if (!FORMATS.includes(format)) throw new HttpError(400, 'invalidRequest', { what: 'format' });
      const f = await library.find(q.get('key') ?? '');
      return new FileAnswer(exportFlight(f.log, f.flight, format), EXPORT_TYPES[format], exportName(f.log, f.flight, format));
    },
    'POST /api/import': async (req) => {
      const name = decodeURIComponent(String(req.headers[FILE_NAME_HEADER] ?? ''));
      const data = await rawBody(req, MAX_IMPORT + 1).catch((e: unknown) => {
        throw e instanceof HttpError && e.status === 413 ? new HttpError(413, 'logTooLarge', { file: name }) : e;
      });
      const count = await library.importLog(name, data);
      changed();
      return { count };
    },
    'POST /api/cleanup': async (req) => {
      const { volume } = await body<{ volume: string }>(req);
      const c = await cardAt(volume);
      return op('cleanup', async () => {
        const count = await library.cleanup(c);
        const entry = seen.get(c.volume);
        if (entry) entry.cleanable = (await library.cleanable(c)).length;
        return { count };
      });
    },
    'POST /api/flightbag/view': async (req) => {
      const { card, page, edits } = await flightBagArgs(req);
      return flightBagView(card.volume, page, edits);
    },
    'POST /api/flightbag/save': async (req) => {
      const { card, page, edits } = await flightBagArgs(req);
      return op('flightBag', async () => {
        const r = await saveFlightBag(card.volume, page, edits);
        if (r.written.length > 0) await afterFlightBag(card);
        return { problems: r.problems };
      });
    },
    'POST /api/flightbag/fix': async (req) => {
      const { card, page, app } = await flightBagArgs(req);
      if (typeof app !== 'string') throw new HttpError(400, 'invalidRequest', { what: 'app' });
      return op('flightBag', async () => {
        await fixFlightBag(card.volume, page, app);
        await afterFlightBag(card);
      });
    },
    'POST /api/flightbag/battery': async (req) => {
      const b = await body<{ volume?: unknown; id?: unknown; draft?: unknown; action?: unknown }>(req);
      const card = await cardAt(b.volume);
      const id = typeof b.id === 'string' && b.id.length <= 32 ? b.id : undefined;
      const draft = checkDraft(b.draft);
      if (b.action === 'save' || b.action === 'delete') {
        const action = b.action;
        return op('flightBag', async () => {
          const r = await changeBattery(card.volume, id, draft, action);
          if (!r.problem) await afterFlightBag(card);
          return r;
        });
      }
      return batteryEdit(card.volume, id, draft);
    },
    'POST /api/flightbag/model': async (req) => {
      const b = await body<{ volume?: unknown; file?: unknown; draft?: unknown; action?: unknown }>(req);
      const card = await cardAt(b.volume);
      const draft = checkDraft(b.draft);
      if (b.action === 'save' || b.action === 'delete') {
        const action = b.action;
        return op('flightBag', async () => {
          const r = await changeModel(card.volume, b.file, draft, action);
          if (!r.problem) await afterFlightBag(card);
          return r;
        });
      }
      return modelEdit(card.volume, b.file, draft);
    },
    'GET /api/flightbag/apps': async (_req, q) => {
      const card = await cardAt(q.get('volume'));
      return flightBagApps(card.volume);
    },
    'POST /api/flightbag/action': async (req) => {
      const b = await body<{ volume?: unknown; app?: unknown; reset?: unknown }>(req);
      const card = await cardAt(b.volume);
      return op('flightBag', async () => {
        await flightBagAction(card.volume, b.app, b.reset ?? undefined);
        await afterFlightBag(card);
      });
    },
    'GET /api/flightbag/icon': async (_req, q) => {
      const card = await cardAt(q.get('volume'));
      return new FileAnswer(await readAppIcon(card.volume, q.get('app') ?? ''), 'image/png');
    },
    'GET /api/flightbag/sound': async (_req, q) => {
      const card = await cardAt(q.get('volume'));
      return new FileAnswer(await readSound(card.volume, q.get('path') ?? ''), 'audio/wav');
    },
    'GET /api/licenses': async (): Promise<LicensesView> => {
      const text = o.licensesFile ? await readFile(o.licensesFile, 'utf8').catch(() => undefined) : undefined;
      if (text === undefined) throw new HttpError(404, 'licensesMissing');
      return { text };
    },
    'POST /api/open-folder': async () => openFolder(p.root),
    'POST /api/app-update': async () => {
      const u = o.appUpdates;
      if (!u?.view()?.installable) throw new HttpError(400, 'invalidRequest', { what: 'app update' });
      return op('appUpdate', () =>
        u.install((pct) => progress({ op: 'appUpdate', text: `App update ${pct} %`, done: pct, total: 100 })).catch((e: unknown) => {
          console.error(e);
          throw new AppError('appUpdateFailed');
        }),
      );
    },
    'POST /api/prefs': async (req) => {
      const { lang, theme, sticks, attitude, more, list } = await body<PrefsView>(req);
      if (
        (lang !== undefined && !/^[a-z]{2}$/.test(lang)) ||
        (theme !== undefined && theme !== 'light' && theme !== 'dark') ||
        (sticks !== undefined && !isStickMode(sticks)) ||
        (attitude !== undefined && attitude !== 'shown' && attitude !== 'hidden') ||
        (more !== undefined && more !== 'shown' && more !== 'hidden') ||
        (list !== undefined && (typeof list !== 'object' || list === null || Array.isArray(list)))
      ) {
        throw new HttpError(400, 'invalidRequest', { what: 'prefs' });
      }
      s.ui = { ...s.ui, ...(lang ? { lang } : {}), ...(theme ? { theme } : {}), ...(sticks ? { sticks } : {}), ...(attitude ? { attitude } : {}), ...(more ? { more } : {}), ...(list ? { list: listPrefs(list) } : {}) };
      await saveSettings(p.settings, s);
    },
  };

  const page = (html: string) => withPageData(html, s.ui ?? {}, token);

  const serveStatic = async (res: ServerResponse, urlPath: string) => {
    const root = o.staticDir!;
    let file = normalize(join(root, decodeURIComponent(urlPath)));
    if (!file.startsWith(root + sep) && file !== root) throw new HttpError(404, 'notFound');
    if (!(await stat(file).catch(() => undefined))?.isFile()) file = join(root, 'index.html');
    if (extname(file) !== '.html') {
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
      return;
    }
    // without the key, which comes behind # in the address; never cached, it carries the stored choices
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(withPageData(await readFile(file, 'utf8'), s.ui ?? {}));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    for (const [name, value] of Object.entries(securityHeaders(s.map))) res.setHeader(name, value);
    try {
      // only under its own name: another site whose name was pointed at this computer (DNS rebinding)
      // would count as the same site to the browser
      if (!LOCAL_NAMES.includes(hostName(req.headers.host))) throw new HttpError(403, 'invalidRequest', { what: 'host' });
      if (url.pathname.startsWith('/api/') && (req.headers[TOKEN_HEADER] ?? url.searchParams.get('token')) !== token) {
        throw new HttpError(403, 'invalidRequest', { what: 'token' });
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        res.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
        return;
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        const answer = await route(req, url.searchParams);
        if (!(answer instanceof FileAnswer)) return json(res, answer);
        const head = {
          'Content-Type': answer.type,
          'Cache-Control': 'no-store',
          'Accept-Ranges': 'bytes',
          ...(answer.download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(answer.download)}` } : {}),
        };
        // Safari asks for sounds piece by piece and plays nothing without them
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const data = typeof answer.data === 'string' ? Buffer.from(answer.data) : answer.data;
          const size = data.length;
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` });
            res.end();
            return;
          }
          res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}` });
          res.end(data.subarray(start, end + 1));
          return;
        }
        res.writeHead(200, head);
        res.end(answer.data);
        return;
      }
      if (url.pathname.startsWith('/api/') || !o.staticDir) throw new HttpError(404, 'notFound');
      await serveStatic(res, url.pathname);
    } catch (e) {
      // coded errors are the user's to fix (400 unless said otherwise), anything else is a bug
      const status = e instanceof HttpError ? e.status : e instanceof AppError ? 400 : 500;
      if (status === 500) console.error(e);
      const { message, ...coded } = errorInfo(e);
      json(res, { error: message, ...coded }, status);
    }
  });

  o.appUpdates?.onChange(() => pushState());
  await library.list(); // flights deleted more than 30 days ago go now
  await poll(true);
  const timer = setInterval(() => void poll().catch(() => {}), o.pollMs ?? 2000);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://localhost:${typeof address === 'object' && address ? address.port : o.port}`;
  return {
    url,
    token,
    open: `${url}/#${TOKEN_HASH}=${token}`,
    page,
    close: () => {
      clearInterval(timer);
      for (const c of clients) c.end();
      server.close();
    },
  };
}
