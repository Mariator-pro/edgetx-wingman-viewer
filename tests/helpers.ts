// Hand-built EdgeTX logs for the tests.

export interface Row {
  s: number; // seconds after 2026-10-30 10:00:00
  lq?: number;
  rssi?: number;
  fm?: string;
  gps?: [number, number];
  alt?: number;
  sats?: number;
  volt?: number;
  extra?: string[]; // values of extra sensor columns
}

export const T0 = Date.UTC(2026, 9, 30, 10, 0, 0);

const time = (s: number) => {
  const d = new Date(T0 + s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())},${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
};

export const TAIL = 'Rud,Ele,Thr,Ail,SA,LSW,CH1(us),TxBat(V)';
const tailValues = '0,0,-1024,0,-1,0x0000000000000000,1500,7.9';

export function header(extra: string[] = [], names = { lq: 'RQly(%)', rssi: '1RSS(dB)', volt: 'RxBt(V)', alt: 'Alt(m)' }): string {
  return ['Date,Time', names.rssi, names.lq, 'FM', 'GPS', names.alt, 'Sats', names.volt, ...extra, TAIL].join(',');
}

export function line(r: Row): string {
  const up = (r.lq ?? 0) !== 0 || (r.rssi ?? 0) !== 0;
  return [
    time(r.s),
    r.rssi ?? 0,
    r.lq ?? 0,
    `"${r.fm ?? ''}"`,
    r.gps ? `${r.gps[0].toFixed(6)} ${r.gps[1].toFixed(6)}` : '',
    (r.alt ?? 0).toFixed(0),
    r.sats ?? (up ? 12 : 0),
    (r.volt ?? (up ? 25.0 : 0)).toFixed(1),
    ...(r.extra ?? []),
    tailValues,
  ].join(',');
}

export function log(rows: Row[], extra: string[] = []): string {
  return [header(extra), ...rows.map(line)].join('\n') + '\n';
}

// Seconds from a to b (inclusive) in steps, each made into a row.
export function span(a: number, b: number, make: (s: number) => Omit<Row, 's'>, step = 1): Row[] {
  const out: Row[] = [];
  for (let s = a; s <= b; s += step) out.push({ s, ...make(s) });
  return out;
}

export const HOME: [number, number] = [47.1, 11.2];
// A position about n metres north of home.
export const north = (m: number): [number, number] => [HOME[0] + m / 111320, HOME[1]];
export const off = (): Omit<Row, 's'> => ({});
export const link = (fm: string, more: Omit<Row, 's'> = {}): Omit<Row, 's'> => ({ lq: 100, rssi: -60, fm, gps: HOME, ...more });
