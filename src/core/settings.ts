import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isStickMode, type StickMode } from './kinds.ts';

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

export interface Settings {
  ui?: { lang?: string; theme?: 'light' | 'dark'; sticks?: StickMode; attitude?: 'shown' | 'hidden' }; // interface language, theme, stick mode (for logs without the radio's settings) and the attitude view on the map, as last chosen
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
    },
    map: {
      ...(validTiles(map.tiles) ? { tiles: map.tiles } : {}),
      ...(validKey(map.arcgisKey) ? { arcgisKey: map.arcgisKey } : {}),
    },
    ...(typeof v.lastSync === 'string' ? { lastSync: v.lastSync } : {}),
  };
}

export const saveSettings = (file: string, s: Settings) => writeJson(file, s);
