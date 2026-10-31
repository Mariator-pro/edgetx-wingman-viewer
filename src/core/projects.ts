import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { isTable, parseLuaTable, type LuaValue } from './luatable.ts';
import type { StickMode } from './kinds.ts';
import { printable } from './paths.ts';

// The files of the SD card read with the logs, relative to the card root (or its copy under Projects/<board>/).
export const LIPONY_CONFIG = 'SCRIPTS/LIPONY/config.lua';
export const SNTNL_CONFIG = 'SCRIPTS/SNTNL/config.lua';
export const GPSHOMER_CONFIG = 'SCRIPTS/GPSHOMER/config.lua';
export const RADIO_SETTINGS = 'RADIO/radio.yml'; // for the stick mode
export const PROJECT_FILES = [LIPONY_CONFIG, SNTNL_CONFIG, GPSHOMER_CONFIG, RADIO_SETTINGS];
export const isModelFile = (name: string) => /^model\d+\.yml$/i.test(name);

export interface SensorDef {
  label: string;
  unit: number; // EdgeTX TelemetryUnit
  prec: number;
  logs: boolean;
}

export interface ModelInfo {
  file: string; // model01.yml
  name: string;
  sensors: SensorDef[]; // in the order EdgeTX writes them into a log line
}

export interface LipoModel {
  cells?: number;
  sensors: { voltage?: string; current?: string; capacity?: string };
  chemistries: string[]; // of the model's batteries
}

export interface Projects {
  models: ModelInfo[];
  lipoModels: Record<string, LipoModel>; // by model file
  packs: Record<number, { battery: string; label: string; chemistry?: string }>; // by the number of pack_NNNN
  rqlyThreshold?: number; // Link Sentinel
  homeMinSats?: number; // GPS Homer
  stickMode?: StickMode; // from the radio's settings
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && printable(v) !== '' ? printable(v) : undefined);
const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined);

// EdgeTX's YAML files as the radio reads them: what can be read is taken even when the end of the file is
// broken (left over from a longer version) or a key appears twice.
export function readYaml(text: string): unknown {
  return parseDocument(text, { uniqueKeys: false }).toJS();
}

// A model file of EdgeTX: its name and its telemetry sensors by slot number.
export function parseModelYml(file: string, text: string): ModelInfo {
  const y: unknown = readYaml(text);
  const o = isObject(y) ? y : {};
  const header = isObject(o.header) ? o.header : {};
  const slots = isObject(o.telemetrySensors) ? o.telemetrySensors : {};
  const sensors = Object.entries(slots)
    .filter(([k, s]) => /^\d+$/.test(k) && isObject(s) && str(s.label) !== undefined)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, s]) => {
      const t = s as Record<string, unknown>;
      return { label: str(t.label)!.slice(0, 4), unit: Number(t.unit) || 0, prec: Number(t.prec) || 0, logs: Number(t.logs) === 1 || t.logs === true };
    });
  return { file, name: typeof header.name === 'string' ? printable(header.name) : '', sensors };
}

function parseLua(text: string | undefined): LuaValue | undefined {
  if (text === undefined) return undefined;
  try {
    return parseLuaTable(text);
  } catch {
    return undefined; // a broken settings file counts as none
  }
}

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return isObject(v) ? Object.values(v) : [];
}

export function parseLipoConfig(text: string | undefined): Pick<Projects, 'lipoModels' | 'packs'> {
  const cfg = parseLua(text);
  const lipoModels: Record<string, LipoModel> = Object.create(null);
  const packs: Projects['packs'] = Object.create(null);
  if (!isTable(cfg)) return { lipoModels, packs };
  const chemistryOf: Record<string, string> = Object.create(null);
  for (const b of list(cfg.batteries)) {
    if (!isObject(b)) continue;
    const id = str(b.id);
    const chemistry = str(b.chemistry);
    if (id && chemistry) chemistryOf[id] = chemistry;
    for (const p of list(b.instances)) {
      if (!isObject(p)) continue;
      const n = /^pack_(\d+)$/.exec(str(p.id) ?? '');
      if (n) packs[Number(n[1])] = { battery: str(b.name) ?? id ?? '', label: String(p.label ?? n[1]), chemistry };
    }
  }
  if (isObject(cfg.models)) {
    for (const [file, m] of Object.entries(cfg.models)) {
      if (!isObject(m)) continue;
      const s = isObject(m.sensors) ? m.sensors : {};
      lipoModels[file] = {
        cells: int(m.cells, 1, 24),
        sensors: { voltage: str(s.voltage), current: str(s.current), capacity: str(s.capacity) },
        chemistries: list(m.batteryIds).map((id) => chemistryOf[String(id)]).filter((c): c is string => c !== undefined),
      };
    }
  }
  return { lipoModels, packs };
}

async function readText(p: string): Promise<string | undefined> {
  return readFile(p, 'utf8').catch(() => undefined);
}

// Models and settings of the cores from a card root or its copy in the app's data folder.
export async function readProjects(root: string): Promise<Projects> {
  const models: ModelInfo[] = [];
  const entries = await readdir(join(root, 'MODELS')).catch(() => [] as string[]);
  for (const f of entries.filter(isModelFile).sort()) {
    const text = await readText(join(root, 'MODELS', f));
    if (text === undefined) continue;
    try {
      models.push(parseModelYml(f, text));
    } catch {
      // unreadable model file: left out
    }
  }
  const sntnl = parseLua(await readText(join(root, SNTNL_CONFIG)));
  const homer = parseLua(await readText(join(root, GPSHOMER_CONFIG)));
  return {
    models,
    ...parseLipoConfig(await readText(join(root, LIPONY_CONFIG))),
    rqlyThreshold: isTable(sntnl) ? int(sntnl.rqlyThreshold, 30, 70) : undefined,
    homeMinSats: isTable(homer) ? int(homer.homeMinSats, 4, 20) : undefined,
    stickMode: await readStickMode(root),
  };
}

// EdgeTX keeps the stick mode as 0 to 3 for mode 1 to 4.
async function readStickMode(root: string): Promise<StickMode | undefined> {
  const text = await readText(join(root, RADIO_SETTINGS));
  if (text === undefined) return undefined;
  try {
    const y = readYaml(text);
    const m = isObject(y) ? y.stickMode : undefined;
    return typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= 3 ? ((m + 1) as StickMode) : undefined;
  } catch {
    return undefined;
  }
}

export const noProjects = (): Projects => ({ models: [], lipoModels: Object.create(null), packs: Object.create(null) });

// EdgeTX names a log after the model, with " : \ / < > ? * replaced by _ (and MODEL01 without a name).
export function sanitizeForFilename(name: string): string {
  return name.slice(0, 15).replace(/[":\\/<>?*]/g, '_');
}

// The model part of a log file name: "Chimera7-2026-10-25-143012.csv" or "Chimera7-2026-10-25.csv".
export function modelNameOfLog(file: string): string {
  return file.replace(/\.csv$/i, '').replace(/-\d{4}-\d{2}-\d{2}(-\d{6})?$/, '');
}

export function modelForLog(file: string, projects: Projects): ModelInfo | undefined {
  const name = modelNameOfLog(file);
  return projects.models.find((m) => (m.name === '' ? 'MODEL01' : sanitizeForFilename(m.name)) === name);
}
