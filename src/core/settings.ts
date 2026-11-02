import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isStickMode, LIST_COLUMNS, LIST_SORTS, type ListColumn, type ListSort, type StickMode } from './kinds.ts';
import { printable } from './paths.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Writes beside and renames, so a crash never leaves half a file.
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined; // missing or broken: starts afresh
  }
}

export const DEFAULT_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ESRI_ORIGIN = 'https://ibasemaps-api.arcgis.com';
const MAX_SETTING = 500;

export interface MapSettings {
  tiles?: string; // street map tile address, if not the default
  arcgisKey?: string; // the user's own key for satellite imagery
}

// A tile address the page may load from: https, with {z}, {x} and {y}.
export function validTiles(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > MAX_SETTING || !['{z}', '{x}', '{y}'].every((p) => v.includes(p))) return false;
  try {
    const u = new URL(v.replace(/[{}]/g, ''));
    return u.protocol === 'https:' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

export const validKey = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_SETTING && /^[\w.-]+$/.test(v);

export const tilesOrigin = (tiles: string) => new URL(tiles.replace(/[{}]/g, '')).origin;

// Filters, order and hidden columns of the list of flights, as last chosen; the search is not kept.
export interface ListPrefs {
  model?: string;
  radio?: string;
  pack?: string; // "board:number"
  tag?: string;
  deleted?: boolean;
  sort?: ListSort;
  order?: 'ascending' | 'descending';
  hidden?: ListColumn[];
}

const MAX_FILTER = 200;
const filterText = (v: unknown) => (typeof v === 'string' && v !== '' ? printable(v).slice(0, MAX_FILTER) : undefined);

// Only known values and short plain texts; anything else is left out.
export function listPrefs(v: unknown): ListPrefs {
  if (!isObject(v)) return {};
  const out: ListPrefs = {};
  for (const k of ['model', 'radio', 'pack', 'tag'] as const) {
    const s = filterText(v[k]);
    if (s) out[k] = s;
  }
  if (v.deleted === true) out.deleted = true;
  if (LIST_SORTS.includes(v.sort as ListSort)) out.sort = v.sort as ListSort;
  if (v.order === 'ascending' || v.order === 'descending') out.order = v.order;
  if (Array.isArray(v.hidden)) out.hidden = LIST_COLUMNS.filter((c) => (v.hidden as unknown[]).includes(c));
  return out;
}

export interface Settings {
  ui?: { lang?: string; theme?: 'light' | 'dark'; sticks?: StickMode; attitude?: 'shown' | 'hidden'; more?: 'shown' | 'hidden'; list?: ListPrefs }; // interface language, theme, stick mode (for logs without the radio's settings), the attitude view on the map and the other values of the log in the values bar, as last chosen
  map?: MapSettings;
  lastSync?: string; // when logs were last copied from an SD card
}

export async function loadSettings(file: string): Promise<Settings> {
  const v = await readJson(file);
  if (!isObject(v)) return {};
  const ui = isObject(v.ui) ? v.ui : {};
  const map = isObject(v.map) ? v.map : {};
  return {
    ui: {
      ...(typeof ui.lang === 'string' && /^[a-z]{2}$/.test(ui.lang) ? { lang: ui.lang } : {}),
      ...(ui.theme === 'light' || ui.theme === 'dark' ? { theme: ui.theme } : {}),
      ...(isStickMode(ui.sticks) ? { sticks: ui.sticks } : {}),
      ...(ui.attitude === 'shown' || ui.attitude === 'hidden' ? { attitude: ui.attitude } : {}),
      ...(ui.more === 'shown' || ui.more === 'hidden' ? { more: ui.more } : {}),
      ...(isObject(ui.list) ? { list: listPrefs(ui.list) } : {}),
    },
    map: {
      ...(validTiles(map.tiles) ? { tiles: map.tiles } : {}),
      ...(validKey(map.arcgisKey) ? { arcgisKey: map.arcgisKey } : {}),
    },
    ...(typeof v.lastSync === 'string' ? { lastSync: v.lastSync } : {}),
  };
}

export const saveSettings = (file: string, s: Settings) => writeJson(file, s);
