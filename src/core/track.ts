import { distance, type AnalysedLog, type FlightInfo } from './analysis.ts';
import { FIX_LOSS_MS, linkUp, validFix } from './flights.ts';
import { printable } from './paths.ts';
import { STICKS, TRACK_VALUES, type ExtraValue, type PathPoint, type Stick, type Track, type TrackValue } from './kinds.ts';
import type { Sample } from './roles.ts';

export { STICKS, TRACK_VALUES, type PathPoint, type Track, type TrackValue } from './kinds.ts';

const STICK_COLUMNS: Record<Stick, string> = { rud: 'Rud', ele: 'Ele', thr: 'Thr', ail: 'Ail' };
// columns that aren't values: time, position, flight mode text
const NOT_VALUES = new Set(['Date', 'Time', 'GPS', 'FM']);

const FT = 0.3048;
const EARTH_M = 6371008.8;
const RAD = Math.PI / 180;
const STEP_S = 0.2; // spacing of the points between two fixes on the curve
const MAX_STEPS = 25;
const HOLD_S = 2; // the same position this long: standing still, not just a repeated value

// Ground speed in m/s from the unit in the column name.
const SPEED_TO_MS: Record<string, number> = { kmh: 1 / 3.6, 'km/h': 1 / 3.6, kts: 0.514444, mph: 0.44704, 'm/s': 1, mps: 1, 'f/s': FT, fps: FT };

interface Fix {
  t: number; // s
  lon: number;
  lat: number;
  h: number;
  hdg?: number;
  speed?: number; // m/s
  row: number;
}

const wrap = (deg: number) => ((deg % 360) + 360) % 360;
// Course from a to b, 0 is north, clockwise.
const bearing = (dx: number, dy: number) => wrap(Math.atan2(dx, dy) / RAD);

// Between two fixes the path follows course and speed at both ends (a cubic Hermite curve) instead of a
// straight line, since many links send only about one position a second. Where course or speed is missing,
// or the course points away from the next fix (bad data, turning on the spot), the line stays straight.
function curve(a: Fix, b: Fix): { x: number; y: number }[] {
  const kx = Math.cos(a.lat * RAD) * EARTH_M * RAD;
  const ky = EARTH_M * RAD;
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * ky;
  const chord = Math.hypot(dx, dy);
  const dt = b.t - a.t;
  const steps = chord < 0.01 ? 1 : Math.min(MAX_STEPS, Math.max(1, Math.round(dt / STEP_S)));
  const tangent = (f: Fix) => {
    if (f.hdg === undefined || f.speed === undefined || chord < 1) return undefined;
    const ux = Math.sin(f.hdg * RAD);
    const uy = Math.cos(f.hdg * RAD);
    if (ux * dx + uy * dy <= 0) return undefined;
    const len = Math.min(f.speed * dt, 1.5 * chord);
    return { x: ux * len, y: uy * len };
  };
  const m0 = tangent(a);
  const m1 = tangent(b);
  const out: { x: number; y: number }[] = [];
  for (let k = 1; k <= steps; k++) {
    const s = k / steps;
    if (!m0 || !m1) {
      out.push({ x: dx * s, y: dy * s });
      continue;
    }
    const s2 = s * s;
    const s3 = s2 * s;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    out.push({ x: h10 * m0.x + h01 * dx + h11 * m1.x, y: h10 * m0.y + h01 * dy + h11 * m1.y });
  }
  return out.map((p) => ({ x: p.x / kx, y: p.y / ky }));
}

// Course at a time from the logged heading, else along the path.
function courseAt(lines: Sample[], row: number, fallback: number): number {
  const s = lines[row]!;
  const h = s.values.hdg;
  return h !== undefined && linkUp(s) ? wrap(h) : fallback;
}

export function flightTrack(a: AnalysedLog, f: FlightInfo): Track {
  const lines = a.samples.slice(f.first, f.last + 1);
  const t0 = lines[0]!.t;
  const unit = (role: TrackValue) => (role === 'dist' ? 'm' : a.roles.map((r) => r.unit[role as keyof typeof r.unit]).find((u) => u !== undefined));
  const toM = a.altUnit === 'ft' ? FT : 1;
  const speedUnit = unit('gspd');
  const toMs = speedUnit !== undefined ? SPEED_TO_MS[speedUnit] : SPEED_TO_MS.kmh;

  const values: Track['rows']['values'] = {};
  const has = (r: TrackValue) => (r === 'dist' ? f.home !== undefined : lines.some((s) => s.values[r as keyof Sample['values']] !== undefined));
  for (const r of TRACK_VALUES) if (has(r)) values[r] = [];
  const modes: string[] = [];
  const hasFm = lines.some((s) => s.fm !== undefined);
  const fm: (number | null)[] = [];
  const t: number[] = [];

  // height above home: the altitude at takeoff is the ground (GPS altitude is above sea level)
  const startLine = lines.find((s) => s.t >= f.start && linkUp(s) && s.values.alt !== undefined);
  const ground = startLine?.values.alt ?? 0;
  const fixes: Fix[][] = [];
  let seg: Fix[] = [];
  let lastFix: number | undefined;
  let held: { time: number; row: number } | undefined;
  // a position held to the given line, with that line's course and speed, which tell how the model sets off
  const hold = (prev: Fix, h: { time: number; row: number }): Fix => {
    const v = lines[h.row]!.values;
    return {
      t: h.time,
      lon: prev.lon,
      lat: prev.lat,
      h: prev.h,
      ...(v.hdg !== undefined ? { hdg: wrap(v.hdg) } : {}),
      ...(v.gspd !== undefined && toMs !== undefined ? { speed: v.gspd * toMs } : {}),
      row: h.row,
    };
  };
  const pushSeg = () => {
    const prev = seg[seg.length - 1];
    if (prev && held && held.time > prev.t) seg.push(hold(prev, held));
    held = undefined;
    if (seg.length > 0) fixes.push(seg);
  };

  lines.forEach((s, row) => {
    const up = linkUp(s);
    t.push((s.t - t0) / 1000);
    for (const r of Object.keys(values) as TrackValue[]) {
      let v: number | undefined;
      if (!up) v = undefined;
      else if (r === 'dist') v = f.home && validFix(s, a.minSats) ? Math.round(distance(f.home, { lat: s.lat!, lon: s.lon! })) : undefined;
      else v = s.values[r];
      values[r]!.push(v ?? null);
    }
    if (hasFm) {
      let i = up && s.fm !== undefined ? modes.indexOf(s.fm) : -1;
      if (up && s.fm !== undefined && i < 0) i = modes.push(s.fm) - 1;
      fm.push(i >= 0 ? i : null);
    }
    if (!up || !validFix(s, a.minSats)) return;
    if (lastFix !== undefined && s.t - lastFix >= FIX_LOSS_MS && seg.length > 0) {
      pushSeg();
      seg = [];
    }
    lastFix = s.t;
    const prev = seg[seg.length - 1];
    const time = (s.t - t0) / 1000;
    if (prev && prev.lat === s.lat && prev.lon === s.lon) {
      held = { time, row }; // the same position again: no new fix yet
      return;
    }
    // standing still for a while: the model stays there until the new position, instead of creeping towards it
    if (prev && held && held.time - prev.t >= HOLD_S) seg.push(hold(prev, held));
    held = undefined;
    const alt = s.values.alt;
    const speed = s.values.gspd;
    seg.push({
      t: time,
      lon: s.lon!,
      lat: s.lat!,
      h: alt !== undefined ? Math.max(0, (alt - ground) * toM) : prev?.h ?? 0,
      ...(s.values.hdg !== undefined ? { hdg: wrap(s.values.hdg) } : {}),
      ...(speed !== undefined && toMs !== undefined ? { speed: speed * toMs } : {}),
      row,
    });
  });
  pushSeg();

  const rowAt = (time: number, from: number) => {
    let r = from;
    while (r + 1 < t.length && t[r + 1]! <= time) r++;
    return r;
  };
  const path = fixes.map((fs) => {
    const pts: PathPoint[] = [];
    const first = fs[0]!;
    pts.push([first.t, first.lon, first.lat, first.h, courseAt(lines, first.row, 0), first.row]);
    for (let i = 1; i < fs.length; i++) {
      const p = fs[i - 1]!;
      const q = fs[i]!;
      const steps = curve(p, q);
      let x0 = p.lon;
      let y0 = p.lat;
      steps.forEach((d, k) => {
        const s = (k + 1) / steps.length;
        const time = p.t + (q.t - p.t) * s;
        const lon = p.lon + d.x;
        const lat = p.lat + d.y;
        const along = bearing((lon - x0) * Math.cos(lat * RAD), lat - y0);
        const row = rowAt(time, pts[pts.length - 1]![5]);
        pts.push([time, lon, lat, p.h + (q.h - p.h) * s, courseAt(lines, row, along), row]);
        x0 = lon;
        y0 = lat;
      });
    }
    // a lone first point gets the course of the line after it
    if (pts.length > 1 && lines[first.row]!.values.hdg === undefined) pts[0]![4] = pts[1]![4];
    return pts;
  });

  // the sensor's name as the log has it; the distance from home is the app's own
  const names: Track['names'] = {};
  for (const r of [...(Object.keys(values) as TrackValue[]), ...(hasFm ? ['fm' as const] : [])]) {
    if (r === 'dist') {
      names.dist = 'Dist';
      continue;
    }
    for (let k = 0; k < a.roles.length; k++) {
      const c = a.roles[k]!.index[r];
      if (c !== undefined) {
        names[r] = printable(a.log.schemas[k]!.columns[c]!.name);
        break;
      }
    }
  }
  const units: Track['units'] = {};
  for (const r of Object.keys(values) as TrackValue[]) {
    const u = unit(r);
    if (u !== undefined) units[r] = u;
  }
  const { sticks, extra } = otherColumns(a, lines, names);
  const lastSeg = path[path.length - 1];
  const lastPt = lastSeg?.[lastSeg.length - 1];
  return {
    rows: { t, values, ...(hasFm ? { fm } : {}) },
    modes,
    units,
    names,
    ...(sticks ? { sticks } : {}),
    ...(sticks && a.stickMode ? { stickMode: a.stickMode } : {}),
    ...(extra.length > 0 ? { extra } : {}),
    path,
    ...(f.home ? { home: [f.home.lon, f.home.lat] as [number, number] } : path[0] ? { home: [path[0][0]![1], path[0][0]![2]] as [number, number] } : {}),
    ...(lastPt ? { end: [lastPt[1], lastPt[2]] as [number, number] } : {}),
  };
}

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

// The sticks, and the sensors the track doesn't carry yet (e.g. RSNR, TPWR, Ptch), by column name, since a log
// can have two headers. Sensors stand between the time and the first stick; without telemetry they are null.
function otherColumns(a: AnalysedLog, lines: Sample[], names: Track['names']): { sticks?: Track['sticks']; extra: ExtraValue[] } {
  const shown = new Set(Object.values(names));
  // per header: stick column indexes and the sensor columns not shown otherwise
  const per = a.log.schemas.map((sc) => {
    const cols = sc.columns.map((c) => printable(c.name));
    const firstStick = cols.findIndex((c) => Object.values(STICK_COLUMNS).includes(c));
    const sensors = cols
      .map((name, i) => ({ name, unit: sc.columns[i]!.unit, i }))
      .filter((c) => (firstStick < 0 || c.i < firstStick) && !NOT_VALUES.has(c.name) && !shown.has(c.name));
    const sticks = Object.fromEntries(STICKS.map((k) => [k, cols.indexOf(STICK_COLUMNS[k])]).filter(([, i]) => (i as number) >= 0));
    return { sensors, sticks: sticks as Partial<Record<Stick, number>> };
  });
  const cells = (s: Sample) => a.log.lines[s.i]!;

  const stickCols: Partial<Record<Stick, (number | null)[]>> = {};
  for (const k of STICKS) {
    if (!per.some((p) => p.sticks[k] !== undefined)) continue;
    stickCols[k] = lines.map((s) => {
      const line = cells(s);
      const i = per[line.schema]!.sticks[k];
      return i !== undefined ? (num(line.cells[i]) ?? null) : null;
    });
  }

  const extra: ExtraValue[] = [];
  const seen = new Set<string>();
  for (const p of per) {
    for (const c of p.sensors) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const values = lines.map((s) => {
        const line = cells(s);
        const col = per[line.schema]!.sensors.find((x) => x.name === c.name);
        return col && linkUp(s) ? (num(line.cells[col.i]) ?? null) : null;
      });
      if (values.some((v) => v !== null)) extra.push({ name: c.name, ...(c.unit !== undefined ? { unit: c.unit } : {}), values });
    }
  }
  return { ...(Object.keys(stickCols).length > 0 ? { sticks: stickCols } : {}), extra };
}
