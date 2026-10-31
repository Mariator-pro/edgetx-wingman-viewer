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

export function seriesOf(tr: TrackView, t: Texts): Series[] {
  const out: Series[] = [];
  for (const k of TRACK_VALUES) {
    const values = tr.rows.values[k];
    if (values) out.push({ id: k, name: tr.names[k] ?? k, label: t.valueNames[k], unit: unitShown(tr.units[k]), digits: DIGITS[k] ?? 0, values });
  }
  for (const e of tr.extra ?? []) {
    const unit = unitShown(e.unit);
    out.push({ id: `log:${e.name}`, name: e.name, label: t.logNames[e.name as keyof Texts['logNames']] ?? e.name, unit, digits: unit === 'rad' ? 2 : 0, values: e.values });
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
