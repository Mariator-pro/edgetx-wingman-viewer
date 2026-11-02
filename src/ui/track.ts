import type { PathPoint } from '../core/kinds.ts';
import type { TrackView } from '../server/api.ts';

export type Rgb = [number, number, number];
export type ColorBy = 'fm' | 'alt' | 'gspd' | 'lq' | 'volt' | 'lnst' | 'lsst' | 'stage';
export const COLOR_BY: ColorBy[] = ['fm', 'alt', 'gspd', 'lq', 'volt', 'lnst', 'lsst', 'stage'];
const BY_LEVEL: ColorBy[] = ['lnst', 'lsst', 'stage'];
export const byLevel = (by: ColorBy) => BY_LEVEL.includes(by);

// The last index whose time is at or before t (0 before the first).
function indexAt(times: (i: number) => number, n: number, t: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times(mid) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const rowAt = (tr: TrackView, t: number) => indexAt((i) => tr.rows.t[i]!, tr.rows.t.length, t);

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpAngle = (a: number, b: number, f: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * f;

// Where the model is at time t, between two points of the path, so it glides instead of jumping. In a gap
// (no fix) it stays at the last point; before the first fix there is none.
export function positionAt(tr: TrackView, t: number): PathPoint | undefined {
  let last: PathPoint | undefined;
  for (const seg of tr.path) {
    if (seg[0]![0] > t) break;
    const i = indexAt((k) => seg[k]![0], seg.length, t);
    const a = seg[i]!;
    const b = seg[i + 1];
    if (!b) {
      last = a;
      continue;
    }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    return [t, lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f), lerpAngle(a[4], b[4], f), a[5]];
  }
  return last;
}

// The point of a path segment nearest to a spot on the screen, by where each point is drawn.
export function nearestPoint(seg: PathPoint[], project: (p: PathPoint) => [number, number], x: number, y: number): PathPoint | undefined {
  let best: PathPoint | undefined;
  let bestD = Infinity;
  for (const p of seg) {
    const [px, py] = project(p);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// The extremes of a flight between takeoff and landing, each with when it happened: top speed, lowest voltage,
// mAh used, worst link quality, fewest satellites; only what the log has.
export const SUMMARY = [
  ['gspd', 'max'],
  ['volt', 'min'],
  ['capa', 'max'],
  ['lq', 'min'],
  ['sats', 'min'],
] as const;
export type SummaryValue = (typeof SUMMARY)[number][0];
export function summaryOf(tr: TrackView): { k: SummaryValue; v: number; t: number }[] {
  const out: { k: SummaryValue; v: number; t: number }[] = [];
  for (const [k, way] of SUMMARY) {
    const col = tr.rows.values[k];
    if (!col) continue;
    let best: { k: SummaryValue; v: number; t: number } | undefined;
    for (let r = 0; r < col.length; r++) {
      const v = col[r];
      const t = tr.rows.t[r]!;
      if (v == null || t < tr.takeoff || t > tr.landing || (k === 'volt' && v <= 0)) continue;
      if (!best || (way === 'max' ? v > best.v : v < best.v)) best = { k, v, t };
    }
    if (best) out.push(best);
  }
  return out;
}

// The path flown up to time t, ending exactly at the model.
export function flownAt(tr: TrackView, t: number): PathPoint[][] {
  const out: PathPoint[][] = [];
  for (const seg of tr.path) {
    if (seg[0]![0] > t) break;
    const i = indexAt((k) => seg[k]![0], seg.length, t);
    const part = seg.slice(0, i + 1);
    const b = seg[i + 1];
    if (b) {
      const p = positionAt({ ...tr, path: [seg] }, t);
      if (p) part.push(p);
    }
    out.push(part);
  }
  return out;
}

const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
// low to high; link quality and battery from red (bad) to green (good)
const RAMP = ['#38bdf8', '#a78bfa', '#f97316'].map(hex);
const GOOD = ['#d6453d', '#e6c23a', '#2e9e5b'].map(hex);
const MODES = ['#2e9e5b', '#1d8fb8', '#8457c9', '#e07a1f', '#3a5fd9', '#d14d8b', '#8a6d3b', '#0e9aa7', '#c0392b', '#7f8c8d'].map(hex);
export const PLAIN: Rgb = [14, 118, 102];

function ramp(stops: Rgb[], x: number): Rgb {
  const v = Math.min(1, Math.max(0, x)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(v));
  const f = v - i;
  return stops[i]!.map((c, k) => Math.round(c + (stops[i + 1]![k]! - c) * f)) as Rgb;
}

export const rgbCss = (c: Rgb) => `rgb(${c.join(',')})`;

export interface Coloring {
  row: (r: number) => Rgb;
  // legend: a color scale with lowest, middle and highest value, or one color per flight mode
  scale?: { css: string; ticks: [number, number, number] };
  modes?: { color: Rgb; label: string }[];
  levels?: Rgb[]; // OK, warning, critical
}

// The warning level of the cores per log line: Lipo Nanny's or Link Sentinel's, or the worst of all, where
// any reason of GPS Homer counts as a warning.
export function levelsOf(tr: TrackView, by: ColorBy): (number | null)[] | undefined {
  const st = tr.stages;
  if (!st) return undefined;
  if (by === 'lnst' || by === 'lsst') return st[by];
  const cols = [st.lnst, st.lsst, st.ghst?.map((v) => (v === null ? null : v > 0 ? 1 : 0))].filter((c) => c !== undefined);
  if (cols.length === 0) return undefined;
  return tr.rows.t.map((_, r) => {
    const vs = cols.map((c) => c[r]).filter((v): v is number => v !== null && v !== undefined);
    return vs.length > 0 ? Math.max(...vs) : null;
  });
}

// A line without a value (no telemetry) takes the color of the one before.
function filled(colors: (Rgb | undefined)[], first: Rgb): Rgb[] {
  let last = colors.find((c) => c !== undefined) ?? first;
  return colors.map((c) => (last = c ?? last));
}

// Colors of the path per log line; numbers from the lowest to the highest value of the flight.
export function coloring(tr: TrackView, by: ColorBy): Coloring {
  if (by === 'fm') {
    const fm = tr.rows.fm;
    if (!fm) return { row: () => PLAIN };
    const colors = filled(fm.map((m) => (m === null ? undefined : MODES[m % MODES.length]!)), PLAIN);
    return { row: (r) => colors[r]!, modes: tr.modes.flatMap((m, i) => (fm.includes(i) ? [{ color: MODES[i % MODES.length]!, label: m }] : [])) };
  }
  if (byLevel(by)) {
    const levels = levelsOf(tr, by);
    const stops = [...GOOD].reverse();
    if (!levels) return { row: () => PLAIN };
    const colors = filled(levels.map((v) => (v === null ? undefined : stops[Math.min(2, Math.max(0, Math.round(v)))]!)), stops[0]!);
    return { row: (r) => colors[r]!, levels: stops };
  }
  const values = tr.rows.values[by as Exclude<ColorBy, 'fm' | 'lnst' | 'lsst' | 'stage'>];
  const nums = values?.filter((v): v is number => v !== null) ?? [];
  if (!values || nums.length === 0) return { row: () => PLAIN };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const stops = by === 'lq' || by === 'volt' ? GOOD : RAMP;
  const colors = filled(values.map((v) => (v === null ? undefined : ramp(stops, (v - min) / (max - min || 1)))), stops[0]!);
  return {
    row: (r) => colors[r]!,
    scale: { css: `linear-gradient(to right, ${stops.map(rgbCss).join(', ')})`, ticks: [min, (min + max) / 2, max] },
  };
}

// The values the path can be colored by in this flight.
export const colorChoices = (tr: TrackView) =>
  COLOR_BY.filter((c) => {
    if (c === 'fm') return tr.modes.length > 0;
    if (byLevel(c)) return levelsOf(tr, c)?.some((v) => v !== null) ?? false;
    return tr.rows.values[c as Exclude<ColorBy, 'fm' | 'lnst' | 'lsst' | 'stage'>]?.some((v) => v !== null);
  });

// The attitude at time t, between two log lines, so the model turns smoothly; none without telemetry there.
export function attitudeAt(tr: TrackView, t: number): { pitch: number; roll: number; yaw: number } | undefined {
  const at = tr.attitude;
  if (!at) return undefined;
  const r = rowAt(tr, t);
  const p0 = at.pitch[r];
  const r0 = at.roll[r];
  if (p0 == null || r0 == null) return undefined;
  const n = r + 1 < tr.rows.t.length ? r + 1 : r;
  const f = n === r ? 0 : Math.min(1, Math.max(0, (t - tr.rows.t[r]!) / (tr.rows.t[n]! - tr.rows.t[r]! || 1)));
  const next = (col: (number | null)[], v: number) => col[n] ?? v;
  const y0 = at.yaw?.[r] ?? 0;
  return {
    pitch: lerp(p0, next(at.pitch, p0), f),
    roll: lerp(r0, next(at.roll, r0), f),
    yaw: (lerpAngle(y0, at.yaw ? next(at.yaw, y0) : y0, f) + 360) % 360,
  };
}
