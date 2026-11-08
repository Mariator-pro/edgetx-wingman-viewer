import { copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { analyse, analyseFile, type AnalysedLog } from './analysis.ts';
import { IMPORTED, isSafeKey, isSafeName, type Paths } from './paths.ts';
import { isModelFile, noProjects, PROJECT_FILES, readProjects, readYaml, type Projects } from './projects.ts';

export const UNKNOWN_BOARD = 'unknown';
const FAT_MTIME_MS = 2000; // FAT keeps the modification time to 2 s

export interface RadioCard {
  volume: string;
  board: string;
}

async function isDir(p: string): Promise<boolean> {
  return (await stat(p).catch(() => undefined))?.isDirectory() ?? false;
}

// An EdgeTX SD card has RADIO/ and MODELS/ at its root; the radio type is "board" in RADIO/radio.yml.
export async function readCard(volume: string): Promise<RadioCard | undefined> {
  if (!(await isDir(join(volume, 'RADIO'))) || !(await isDir(join(volume, 'MODELS')))) return undefined;
  let board = UNKNOWN_BOARD;
  try {
    const y: unknown = readYaml(await readFile(join(volume, 'RADIO', 'radio.yml'), 'utf8'));
    const b = typeof y === 'object' && y !== null ? (y as Record<string, unknown>).board : undefined;
    // board becomes a folder name: a card's file must not lead elsewhere
    if (typeof b === 'string' && isSafeKey(b) && b !== IMPORTED) board = b;
  } catch {
    // missing or unreadable radio.yml: the logs still come in, under "unknown"
  }
  return { volume, board };
}

export async function findCards(volumes: string[]): Promise<RadioCard[]> {
  const cards = await Promise.all(volumes.map(readCard));
  return cards.filter((c): c is RadioCard => c !== undefined);
}

// Copies a file when the copy is missing or differs in size or modification time; the copy gets the
// card's time. Written beside and renamed, so a copy is never half there.
async function copyIfChanged(from: string, to: string): Promise<boolean> {
  const src = await stat(from).catch(() => undefined);
  if (!src?.isFile()) return false;
  const dst = await stat(to).catch(() => undefined);
  if (dst && dst.size === src.size && Math.abs(dst.mtimeMs - src.mtimeMs) < FAT_MTIME_MS) return false;
  await mkdir(dirname(to), { recursive: true });
  const tmp = `${to}.part`;
  await copyFile(from, tmp);
  await utimes(tmp, src.atime, src.mtime);
  await rename(tmp, to);
  return true;
}

export interface SyncResult {
  board: string;
  logs: string[]; // file names copied (new or grown)
  newFlights: number;
}

// The key a flight keeps for notes, tags and the deleted mark: radio, file and the time of its first line,
// which stays the same when the file grows.
export const flightKey = (board: string, file: string, firstT: number) => `${board}/${file}@${firstT}`;

export const keysOf = (a: AnalysedLog) => a.flights.map((f) => flightKey(a.board, a.file, a.samples[f.first]!.t));

// New and grown logs from /LOGS/ and the project data into the app's data folder. Reads the card only.
// A log whose copy is in the trash unchanged stays there; deleted flights don't count as new.
export async function syncCard(card: RadioCard, p: Paths, isDeleted: (key: string) => boolean = () => false): Promise<SyncResult> {
  const projects = await copyProjects(card, p);
  const logs: string[] = [];
  let newFlights = 0;
  const entries = await readdir(join(card.volume, 'LOGS')).catch(() => [] as string[]);
  for (const name of entries.filter((n) => /\.csv$/i.test(n) && isSafeName(n) && !n.startsWith('.')).sort()) {
    const from = join(card.volume, 'LOGS', name);
    const copy = join(p.logs, card.board, name);
    const trashed = join(p.trash, card.board, name);
    if (!(await stat(copy).catch(() => undefined)) && (await sameFile(from, trashed, false))) continue;
    const before = (await readFile(copy, 'utf8').catch(() => undefined)) ?? (await readFile(trashed, 'utf8').catch(() => undefined));
    if (!(await copyIfChanged(from, copy))) continue;
    await rm(trashed, { force: true }); // its flights are in the new copy, still marked deleted
    logs.push(name);
    const keys = (text: string) => keysOf(analyse(text, name, card.board, projects));
    const old = new Set(before === undefined ? [] : keys(before));
    newFlights += keys(await readFile(copy, 'utf8')).filter((k) => !old.has(k) && !isDeleted(k)).length;
  }
  return { board: card.board, logs, newFlights };
}

// The card's models and the settings of the Lua apps into Projects/<board>/.
export async function copyProjects(card: RadioCard, p: Paths): Promise<Projects> {
  const target = join(p.projects, card.board);
  const models = await readdir(join(card.volume, 'MODELS')).catch(() => [] as string[]);
  for (const f of models.filter(isModelFile)) await copyIfChanged(join(card.volume, 'MODELS', f), join(target, 'MODELS', f));
  for (const f of PROJECT_FILES) await copyIfChanged(join(card.volume, ...f.split('/')), join(target, ...f.split('/')));
  return readProjects(target);
}

// Same size and modification time (to FAT's 2 s), or with content true the same bytes.
export async function sameFile(a: string, b: string, content: boolean): Promise<boolean> {
  const [x, y] = await Promise.all([stat(a).catch(() => undefined), stat(b).catch(() => undefined)]);
  if (!x?.isFile() || !y?.isFile() || x.size !== y.size) return false;
  if (!content) return Math.abs(x.mtimeMs - y.mtimeMs) < FAT_MTIME_MS;
  const [da, db] = await Promise.all([readFile(a), readFile(b)]);
  return da.equals(db);
}

export interface LogRef {
  path: string;
  board: string;
  projectsRoot?: string; // card root or Projects/<board>
}

async function csvFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && /\.csv$/i.test(e.name) && !e.name.startsWith('.')).map((e) => e.name).sort();
}

// All logs in the app's data folder (or its trash), per radio type.
export async function storedLogs(p: Paths, root = p.logs): Promise<LogRef[]> {
  const out: LogRef[] = [];
  const boards = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const b of boards.filter((d) => d.isDirectory() && isSafeKey(d.name)).map((d) => d.name).sort()) {
    const projectsRoot = b === IMPORTED ? undefined : join(p.projects, b);
    for (const f of await csvFiles(join(root, b))) out.push({ path: join(root, b, f), board: b, projectsRoot });
  }
  return out;
}

// Logs at a path given on the command line: one file, a folder of logs, or an SD card (or its LOGS folder),
// then with the card's models and settings.
export async function logsAt(path: string): Promise<LogRef[]> {
  const st = await stat(path).catch(() => undefined);
  if (!st) return [];
  if (st.isFile()) {
    const card = await readCard(dirname(dirname(path)));
    return [{ path, board: card?.board ?? IMPORTED, projectsRoot: card?.volume }];
  }
  const card = (await readCard(path)) ?? (await readCard(dirname(path)));
  const dir = card && card.volume === path ? join(path, 'LOGS') : path;
  return (await csvFiles(dir)).map((f) => ({ path: join(dir, f), board: card?.board ?? IMPORTED, projectsRoot: card?.volume }));
}

// Reads the logs, each radio's project data only once.
export async function analyseLogs(refs: LogRef[]): Promise<AnalysedLog[]> {
  const projects = new Map<string, Projects>();
  const out: AnalysedLog[] = [];
  for (const ref of refs) {
    let pr = noProjects();
    if (ref.projectsRoot) {
      if (!projects.has(ref.projectsRoot)) projects.set(ref.projectsRoot, await readProjects(ref.projectsRoot));
      pr = projects.get(ref.projectsRoot)!;
    }
    out.push(await analyseFile(ref.path, ref.board, pr));
  }
  return out;
}
