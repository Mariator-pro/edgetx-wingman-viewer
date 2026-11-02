import { STICKS, TRACK_VALUES, type Stick, type TrackValue } from '../core/kinds.ts';
import type { TrackView } from '../server/api.ts';
import type { Texts } from './texts.ts';

// One value over the flight, whatever its source: a value the app knows, a stick, or another sensor of the log.
export interface Series {
  id: string; // 'alt', 'stick:thr', 'log:RSNR'
  name: string; // as in the log, e.g. GAlt
  label: string; // in plain words
  unit: string;
  digits: number;
  values: (number | null)[];
}

const UNIT_SHOWN: Record<string, string> = { kmh: 'km/h', mps: 'm/s', fps: 'ft/s' };
const DIGITS: Partial<Record<TrackValue, number>> = { volt: 2, curr: 1, vspd: 1, gspd: 1 };
const STICK_NAMES: Record<Stick, string> = { rud: 'Rud', ele: 'Ele', thr: 'Thr', ail: 'Ail' };
// the values the charts start with
export const PRESET = ['alt', 'volt', 'gspd', 'lq'];
// ready-made pairs for value vs value: throttle and current, distance and link quality, throttle and climb rate
export const PAIRS: [string, string][] = [
  ['stick:thr', 'curr'],
  ['dist', 'lq'],
  ['stick:thr', 'vspd'],
];

export const unitShown = (u: string | undefined) => (u ? (UNIT_SHOWN[u] ?? u) : '');

// Pitch, roll and yaw in degrees as the attitude view shows them (pitch nose up positive, yaw 0 to 360°); without
// it, any column in rad is only turned into degrees.
const ATTITUDE: Record<string, 'pitch' | 'roll' | 'yaw'> = { Ptch: 'pitch', Roll: 'roll', Yaw: 'yaw' };
const wrap = (deg: number) => ((deg % 360) + 360) % 360;
function inDegrees(tr: TrackView, e: NonNullable<TrackView['extra']>[number]): (number | null)[] | undefined {
  const a = ATTITUDE[e.name];
  const att = a ? tr.attitude?.[a] : undefined;
  if (att) return att;
  if (e.unit !== 'rad') return undefined;
  return e.values.map((v) => (v === null ? null : e.name === 'Yaw' ? wrap((v * 180) / Math.PI) : (v * 180) / Math.PI));
}

export function seriesOf(tr: TrackView, t: Texts): Series[] {
  const out: Series[] = [];
  for (const k of TRACK_VALUES) {
    const values = tr.rows.values[k];
    if (values) out.push({ id: k, name: tr.names[k] ?? k, label: t.valueNames[k], unit: unitShown(tr.units[k]), digits: DIGITS[k] ?? 0, values });
  }
  for (const e of tr.extra ?? []) {
    const deg = inDegrees(tr, e);
    const label = t.logNames[e.name as keyof Texts['logNames']] ?? e.name;
    out.push({ id: `log:${e.name}`, name: e.name, label, unit: deg ? '°' : unitShown(e.unit), digits: 0, values: deg ?? e.values });
  }
  for (const k of STICKS) {
    const values = tr.sticks?.[k];
    if (values) out.push({ id: `stick:${k}`, name: STICK_NAMES[k], label: t.stickNames[k], unit: '', digits: 0, values });
  }
  return out;
}

export function formatValue(s: Series, v: number, locale: string): string {
  if (s.id === 'dist') return v < 1000 ? `${Math.round(v)} m` : `${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
  const n = v.toLocaleString(locale, { maximumFractionDigits: s.digits, minimumFractionDigits: s.digits });
  if (s.unit === '°') return `${n}°`;
  return `${n} ${s.unit}`.trim();
}

// A difference with its sign, e.g. "+40 m" or "−0,80 V"
export function formatDelta(s: Series, d: number, locale: string): string {
  const text = formatValue({ ...s, id: s.id === 'dist' ? 'delta' : s.id }, Math.abs(d), locale);
  return `${d < 0 ? '−' : '+'}${text}`;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]; // s between two marks of the time axis
const TICK_GAP = 72; // px at least between two marks

// Marks of the time axis, counted from takeoff: the smallest step that leaves room for the labels, at most 8.
export function timeTicks(r: [number, number], takeoff: number, w: number): number[] {
  const span = r[1] - r[0];
  if (span <= 0 || w <= 0) return [];
  const most = Math.max(1, Math.min(8, Math.floor(w / TICK_GAP)));
  const step = STEPS.find((s) => span / s <= most) ?? STEPS.at(-1)!;
  const out: number[] = [];
  for (let k = Math.ceil((r[0] - takeoff) / step); takeoff + k * step <= r[1]; k++) out.push(takeoff + k * step);
  return out;
}

// one color per strip, readable on light and dark
export const STRIP_COLORS = ['#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#e11d48', '#ca8a04', '#2563eb', '#db2777'];
// Colors for the chosen values: the ones they had, the first free one for new ones.
export function paint(old: Record<string, string>, chosen: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of chosen) if (old[id]) out[id] = old[id];
  for (const id of chosen) if (!out[id]) out[id] = STRIP_COLORS.find((c) => !Object.values(out).includes(c)) ?? STRIP_COLORS[Object.keys(out).length % STRIP_COLORS.length]!;
  return out;
}

// Smallest and largest value, ignoring missing ones
export function extent(values: (number | null)[], from = 0, to = values.length - 1): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i];
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : undefined;
}

// Least squares fit y = c0 + c1 u + c2 u² with u = x scaled to about -1..1 (keeps the sums well conditioned),
// for the curve through a point cloud.
export function fitCurve(xs: number[], ys: number[]): ((x: number) => number) | undefined {
  const n = xs.length;
  if (n < 3) return undefined;
  const mid = xs.reduce((a, b) => a + b, 0) / n;
  const half = Math.max(...xs.map((x) => Math.abs(x - mid))) || 1;
  const s = [0, 0, 0, 0, 0];
  const r = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const u = (xs[i]! - mid) / half;
    let p = 1;
    for (let k = 0; k < 5; k++) {
      s[k]! += p;
      if (k < 3) r[k]! += p * ys[i]!;
      p *= u;
    }
  }
  const m = [
    [s[0]!, s[1]!, s[2]!],
    [s[1]!, s[2]!, s[3]!],
    [s[2]!, s[3]!, s[4]!],
  ];
  const det = (a: number[][]) =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return undefined;
  // Cramer's rule
  const c = [0, 1, 2].map((k) => det(m.map((row, i) => row.map((v, j) => (j === k ? r[i]! : v)))) / d);
  return (x: number) => {
    const u = (x - mid) / half;
    return c[0]! + c[1]! * u + c[2]! * u * u;
  };
}
