import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { DEFAULT_MIN_SATS, linkUp, splitFlights, validFix, type Flight } from './flights.ts';
import { flightHints, hintSetup, type Hint } from './hints.ts';
import type { StickMode } from './kinds.ts';
import { parseLog, type LogFile } from './logfile.ts';
import { printable } from './paths.ts';
import { modelForLog, modelNameOfLog, noProjects, type Projects } from './projects.ts';
import { samples as toSamples, type RoleMap, type Sample } from './roles.ts';

export interface FlightInfo extends Flight {
  n: number; // number within the file, from 1
  start: number; // takeoff, else the first line with telemetry
  end: number; // last landing, else the last line with telemetry
  home?: { lat: number; lon: number };
  maxDistance?: number; // m from home
  maxAlt?: number; // in the log's unit
  hints: Hint[];
}

export interface AnalysedLog {
  file: string; // file name
  board: string; // radio type, or "imported"
  model: string;
  log: LogFile;
  samples: Sample[];
  roles: RoleMap[];
  altUnit?: string;
  minSats: number; // GPS Homer's minimum for a valid fix
  stickMode?: StickMode;
  flights: FlightInfo[];
}

const EARTH_M = 6371008.8;
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function describe(f: Flight, n: number, samples: Sample[], minSats: number, hints: Hint[]): FlightInfo {
  const takeoff = f.events.find((e) => e.kind === 'takeoff');
  const landings = f.events.filter((e) => e.kind === 'landing');
  const start = takeoff?.t ?? samples[f.first]!.t;
  const end = landings.length > 0 ? landings[landings.length - 1]!.t : samples[f.last]!.t;
  const info: FlightInfo = { ...f, n, start, end, hints };
  for (let i = f.first; i <= f.last; i++) {
    const s = samples[i]!;
    if (!linkUp(s) || s.t < start) continue;
    if (validFix(s, minSats)) {
      const p = { lat: s.lat!, lon: s.lon! };
      info.home ??= p;
      info.maxDistance = Math.max(info.maxDistance ?? 0, distance(info.home, p));
    }
    const alt = s.values.alt;
    if (alt !== undefined) info.maxAlt = Math.max(info.maxAlt ?? alt, alt);
  }
  return info;
}

export function analyse(text: string, file: string, board: string, projects: Projects = noProjects()): AnalysedLog {
  const model = modelForLog(file, projects);
  const lipo = model ? projects.lipoModels[model.file] : undefined;
  const log = parseLog(text, model);
  const { samples, roles } = toSamples(log, lipo);
  const minSats = projects.homeMinSats ?? DEFAULT_MIN_SATS;
  const flights = splitFlights(samples, minSats).map((f, n) => {
    const pack = samples.slice(f.first, f.last + 1).find((s) => s.values.lnpk !== undefined && s.values.lnpk > 0)?.values.lnpk;
    const hints = flightHints(samples, roles, f, hintSetup(projects, lipo, pack));
    return describe(f, n + 1, samples, minSats, hints);
  });
  const altUnit = roles.map((r) => r.unit.alt).find((u) => u !== undefined);
  return {
    file,
    board,
    model: printable(model?.name || modelNameOfLog(file)),
    log,
    samples,
    roles,
    altUnit,
    minSats,
    ...(projects.stickMode ? { stickMode: projects.stickMode } : {}),
    flights,
  };
}

export async function analyseFile(path: string, board: string, projects?: Projects): Promise<AnalysedLog> {
  return analyse(await readFile(path, 'utf8'), basename(path), board, projects);
}

// The radio's local time of a log line as a real point in time, in the computer's time zone.
export function realTime(t: number): Date {
  const d = new Date(t);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
