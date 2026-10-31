import type { PathPoint } from '../core/kinds.ts';
import type { TrackView } from '../server/api.ts';

export type Rgb = [number, number, number];
export type ColorBy = 'fm' | 'alt' | 'gspd' | 'lq' | 'volt';
export const COLOR_BY: ColorBy[] = ['fm', 'alt', 'gspd', 'lq', 'volt'];

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
  const values = tr.rows.values[by];
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
export const colorChoices = (tr: TrackView) => COLOR_BY.filter((c) => (c === 'fm' ? tr.modes.length > 0 : tr.rows.values[c]?.some((v) => v !== null)));
