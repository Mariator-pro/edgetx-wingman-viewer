import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { analyse, type AnalysedLog, type FlightInfo } from './analysis.ts';
import { AppError } from './errors.ts';
import { isAirframe, type Airframe } from './kinds.ts';
import { IMPORTED, isSafeName, printable, type Paths } from './paths.ts';
import { noProjects, readProjects, type Projects } from './projects.ts';
import { readJson, writeJson } from './settings.ts';
import { flightKey, logsAt, sameFile, storedLogs, type LogRef, type RadioCard } from './store.ts';

export const DELETED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
export const MAX_NOTE = 500;
export const MAX_TAG = 40;
export const MAX_TAGS = 20;
export const MAX_IMPORT = 100 * 1024 * 1024; // a log with 10 lines a second has about 10 MB per hour
export const SAMPLE_KEY = 'sample';

// What the user adds to a flight, kept apart from the logs so a replaced copy keeps it.
export interface Marks {
  note?: string;
  tags?: string[];
  deleted?: string; // when it was deleted (ISO)
  purged?: boolean; // gone for good: the mark stays, so the next copy from the SD card doesn't bring it back
}

export interface ListedFlight {
  key: string;
  log: AnalysedLog;
  flight: FlightInfo;
  marks: Marks;
  inTrash: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanText = (s: string, max: number) => printable(s).trim().slice(0, max);

export function cleanTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => typeof t === 'string')) return undefined;
  const out = [...new Set(tags.map((t) => cleanText(t, MAX_TAG)).filter((t) => t !== ''))];
  return out;
}

// The kind of model the attitude view shows, per radio and model name.
const airframeKey = (board: string, model: string) => `${board}/${model}`;

// The marks file: flight key -> marks, and the kinds of model. Keys are plain data, kept in maps.
async function loadMarks(file: string): Promise<{ marks: Map<string, Marks>; airframes: Map<string, Airframe> }> {
  const v = await readJson(file);
  const airframes = new Map<string, Airframe>();
  if (isObject(v) && isObject(v.airframes)) for (const [k, a] of Object.entries(v.airframes)) if (isAirframe(a)) airframes.set(k, a);
  return { marks: flightMarks(v), airframes };
}

function flightMarks(v: unknown): Map<string, Marks> {
  const out = new Map<string, Marks>();
  if (!isObject(v) || !isObject(v.flights)) return out;
  for (const [key, m] of Object.entries(v.flights)) {
    if (!isObject(m)) continue;
    const marks: Marks = {};
    if (typeof m.note === 'string' && m.note !== '') marks.note = cleanText(m.note, MAX_NOTE);
    const tags = cleanTags(m.tags);
    if (tags?.length) marks.tags = tags;
    if (typeof m.deleted === 'string') marks.deleted = m.deleted;
    if (m.purged === true) marks.purged = true;
    out.set(key, marks);
  }
  return out;
}

// All flights the app keeps, with what the user added; reads each log again only when it changed.
export class Library {
  private p: Paths;
  private sampleDir?: string;
  private marks?: Map<string, Marks>;
  private airframes = new Map<string, Airframe>();
  private cache = new Map<string, { mtimeMs: number; size: number; log: AnalysedLog }>();
  private projects = new Map<string, Projects>();

  constructor(p: Paths, sampleDir?: string) {
    this.p = p;
    this.sampleDir = sampleDir;
  }

  // Logs or project data changed (a copy from the SD card): read again on the next list.
  forget(): void {
    this.cache.clear();
    this.projects.clear();
  }

  private async allMarks(): Promise<Map<string, Marks>> {
    if (!this.marks) {
      const loaded = await loadMarks(this.p.flights);
      this.marks = loaded.marks;
      this.airframes = loaded.airframes;
    }
    return this.marks;
  }

  private async saveMarks(): Promise<void> {
    const marks = await this.allMarks();
    const flights: Record<string, Marks> = Object.create(null);
    for (const [k, m] of marks) if (Object.keys(m).length > 0) flights[k] = m;
    const airframes: Record<string, Airframe> = Object.create(null);
    for (const [k, a] of this.airframes) airframes[k] = a;
    await writeJson(this.p.flights, { flights, airframes });
  }

  async isDeleted(): Promise<(key: string) => boolean> {
    const marks = await this.allMarks();
    return (key) => marks.get(key)?.deleted !== undefined;
  }

  private async read(ref: LogRef): Promise<AnalysedLog | undefined> {
    const st = await stat(ref.path).catch(() => undefined);
    if (!st) return undefined;
    const hit = this.cache.get(ref.path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.log;
    let projects = noProjects();
    if (ref.projectsRoot) {
      if (!this.projects.has(ref.projectsRoot)) this.projects.set(ref.projectsRoot, await readProjects(ref.projectsRoot));
      projects = this.projects.get(ref.projectsRoot)!;
    }
    const log = analyse(await readFile(ref.path, 'utf8'), basename(ref.path), ref.board, projects);
    this.cache.set(ref.path, { mtimeMs: st.mtimeMs, size: st.size, log });
    return log;
  }

  // Every flight, deleted ones included until they are gone for good; flights deleted more than 30 days
  // ago are gone for good now, and so are trash copies with nothing left.
  async list(now = Date.now()): Promise<ListedFlight[]> {
    const marks = await this.allMarks();
    let changed = false;
    for (const m of marks.values()) {
      if (m.deleted && !m.purged && now - Date.parse(m.deleted) > DELETED_DAYS * DAY_MS) {
        m.purged = true;
        changed = true;
      }
    }
    const out: ListedFlight[] = [];
    for (const [root, inTrash] of [
      [this.p.logs, false],
      [this.p.trash, true],
    ] as const) {
      for (const ref of await storedLogs(this.p, root)) {
        const log = await this.read(ref);
        if (!log) continue;
        const flights = log.flights.map((flight) => ({ key: flightKey(log.board, log.file, log.samples[flight.first]!.t), log, flight, inTrash }));
        if (inTrash && flights.every((f) => marks.get(f.key)?.purged)) {
          await rm(ref.path, { force: true });
          this.cache.delete(ref.path);
          continue;
        }
        for (const f of flights) {
          const m = marks.get(f.key) ?? {};
          if (m.purged) continue;
          // a copy in the trash holds only deleted flights; one without a mark gets it now, once
          if (inTrash && !m.deleted) {
            m.deleted = new Date(now).toISOString();
            marks.set(f.key, m);
            changed = true;
          }
          out.push({ ...f, marks: m });
        }
      }
    }
    if (changed) await this.saveMarks();
    return out.sort((a, b) => a.flight.start - b.flight.start || a.key.localeCompare(b.key));
  }

  async find(key: string): Promise<ListedFlight> {
    if (key === SAMPLE_KEY) return this.sample();
    const f = (await this.list()).find((x) => x.key === key);
    if (!f) throw new AppError('flightNotFound');
    return f;
  }

  // The built-in sample flight: not in the data folder and not in the list.
  async sample(): Promise<ListedFlight> {
    const ref = this.sampleDir ? (await logsAt(this.sampleDir))[0] : undefined;
    const log = ref && (await this.read(ref));
    if (!log?.flights[0]) throw new AppError('flightNotFound');
    return { key: SAMPLE_KEY, log, flight: log.flights[0], marks: {}, inTrash: false };
  }

  private async mark(key: string, fn: (m: Marks) => void): Promise<void> {
    const marks = await this.allMarks();
    const m = marks.get(key) ?? {};
    fn(m);
    marks.set(key, m);
  }

  // The kind of model chosen for a flight's model on its radio; the sample flight is a copter unless chosen.
  async airframe(f: ListedFlight): Promise<Airframe | undefined> {
    await this.allMarks();
    return this.airframes.get(airframeKey(f.log.board, f.log.model)) ?? (f.key === SAMPLE_KEY ? 'copter' : undefined);
  }

  async setAirframe(key: string, airframe: Airframe | null): Promise<void> {
    const f = await this.find(key);
    await this.allMarks();
    const k = airframeKey(f.log.board, f.log.model);
    if (airframe) this.airframes.set(k, airframe);
    else this.airframes.delete(k);
    await this.saveMarks();
  }

  async setNote(key: string, note: string): Promise<void> {
    await this.find(key);
    await this.mark(key, (m) => {
      const text = cleanText(note, MAX_NOTE);
      if (text) m.note = text;
      else delete m.note;
    });
    await this.saveMarks();
  }

  async setTags(key: string, tags: string[]): Promise<void> {
    const clean = cleanTags(tags) ?? [];
    await this.find(key);
    await this.mark(key, (m) => {
      if (clean.length) m.tags = clean;
      else delete m.tags;
    });
    await this.saveMarks();
  }

  // Deleted per flight; a copy whose flights are all deleted goes to the trash.
  async remove(keys: string[], now = Date.now()): Promise<number> {
    const list = await this.list(now);
    const hit = list.filter((f) => keys.includes(f.key) && !f.marks.deleted);
    for (const f of hit) await this.mark(f.key, (m) => (m.deleted = new Date(now).toISOString()));
    await this.saveMarks();
    for (const log of new Set(hit.map((f) => f.log))) {
      const keysOfLog = list.filter((f) => f.log === log).map((f) => f.key);
      if (keysOfLog.every((k) => this.marks!.get(k)?.deleted) && !hit.find((f) => f.log === log)!.inTrash) {
        await this.move(join(this.p.logs, log.board, log.file), join(this.p.trash, log.board, log.file));
      }
    }
    return hit.length;
  }

  // Back from the deleted ones; its copy comes back from the trash.
  async restore(keys: string[]): Promise<number> {
    const list = await this.list();
    const hit = list.filter((f) => keys.includes(f.key) && f.marks.deleted);
    for (const f of hit) await this.mark(f.key, (m) => delete m.deleted);
    await this.saveMarks();
    for (const f of hit.filter((x) => x.inTrash)) {
      const target = join(this.p.logs, f.log.board, f.log.file);
      if (await stat(target).catch(() => undefined)) await rm(join(this.p.trash, f.log.board, f.log.file), { force: true });
      else await this.move(join(this.p.trash, f.log.board, f.log.file), target);
    }
    return hit.length;
  }

  // Deleted flights gone for good before the 30 days are up.
  async purge(keys: string[]): Promise<number> {
    const list = await this.list();
    const hit = list.filter((f) => keys.includes(f.key) && f.marks.deleted);
    for (const f of hit) await this.mark(f.key, (m) => (m.purged = true));
    await this.saveMarks();
    await this.list(); // removes trash copies with nothing left
    return hit.length;
  }

  private async move(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    this.cache.delete(from);
  }

  // A log chosen by hand, into Logs/imported/; a file of the same name is replaced.
  async importLog(name: string, data: Buffer): Promise<number> {
    // a name with a path never comes from the file dialog: refused, not shortened
    const file = name;
    if (!isSafeName(file) || !/\.csv$/i.test(file) || file.startsWith('.')) throw new AppError('notLogFile', { file: printable(file) });
    if (data.length > MAX_IMPORT) throw new AppError('logTooLarge', { file: printable(file) });
    const text = data.toString('utf8');
    const head = text.slice(0, text.indexOf('\n') >>> 0);
    if (!/^(Date,Time|Time),/.test(head)) throw new AppError('notLogFile', { file: printable(file) });
    const target = join(this.p.logs, IMPORTED, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.part`, data);
    await rename(`${target}.part`, target);
    return analyse(text, file, IMPORTED).flights.length;
  }

  // Logs on the SD card whose copy in the data folder (or its trash) has the same content.
  async cleanable(card: RadioCard): Promise<string[]> {
    const dir = join(card.volume, 'LOGS');
    const out: string[] = [];
    for (const name of (await readdir(dir).catch(() => [] as string[])).filter((n) => /\.csv$/i.test(n) && isSafeName(n) && !n.startsWith('.')).sort()) {
      const from = join(dir, name);
      if ((await sameFile(from, join(this.p.logs, card.board, name), true)) || (await sameFile(from, join(this.p.trash, card.board, name), true))) out.push(name);
    }
    return out;
  }

  // The only place the app writes to the SD card: deletes those logs.
  async cleanup(card: RadioCard): Promise<number> {
    const names = await this.cleanable(card);
    for (const n of names) await rm(join(card.volume, 'LOGS', n), { force: true });
    return names.length;
  }
}
