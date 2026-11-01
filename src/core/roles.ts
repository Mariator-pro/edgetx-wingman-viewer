import type { LogFile, Schema } from './logfile.ts';
import type { LipoModel } from './projects.ts';

// What the app computes with, independent of the sensor names of a radio system. Per role the names in the
// order they are tried: first those of the cores (ELRS/Crossfire with Betaflight), then other systems.
export const ROLES = {
  rssi1: ['1RSS', 'RSSI'],
  rssi2: ['2RSS'],
  lq: ['RQly', 'LQ', 'TQly'],
  snr: ['RSNR'],
  rfmd: ['RFMD'],
  ant: ['ANT'],
  tpwr: ['TPWR'],
  fm: ['FM'],
  gps: ['GPS'],
  sats: ['Sats'],
  gspd: ['GSpd'],
  hdg: ['Hdg'],
  alt: ['GAlt', 'Alt'], // GPS altitude first, as GPS Homer does
  vspd: ['VSpd'],
  pitch: ['Ptch'],
  roll: ['Roll'],
  yaw: ['Yaw'],
  volt: ['RxBt', 'VFAS', 'A1'],
  curr: ['Curr'],
  capa: ['Capa'],
  fuel: ['Bat%', 'Fuel'],
  lnst: ['LNst'], // sensors of the cores
  lnpk: ['LNpk'],
  lsst: ['LSst'],
  ghst: ['GHst'],
} as const;

export type Role = keyof typeof ROLES;
const NUMERIC = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'fm' && r !== 'gps');
type NumericRole = Exclude<Role, 'fm' | 'gps'>;

export interface Sample {
  i: number; // index into the log's lines
  t: number;
  values: Partial<Record<NumericRole, number>>;
  fm?: string; // undefined: no text (no telemetry)
  lat?: number;
  lon?: number;
}

export interface RoleMap {
  index: Partial<Record<Role, number>>;
  unit: Partial<Record<Role, string>>;
}

// Column index per role in one header. Battery sensors a model has in Lipo Nanny's settings come first.
export function mapRoles(schema: Schema, lipo?: LipoModel): RoleMap {
  const names = schema.columns.map((c) => c.name);
  const index: RoleMap['index'] = {};
  const unit: RoleMap['unit'] = {};
  const own: Partial<Record<Role, string | undefined>> = { volt: lipo?.sensors.voltage, curr: lipo?.sensors.current, capa: lipo?.sensors.capacity };
  for (const role of Object.keys(ROLES) as Role[]) {
    const tries = [own[role], ...ROLES[role]].filter((n): n is string => n !== undefined);
    for (const n of tries) {
      const i = names.indexOf(n);
      if (i >= 0) {
        index[role] = i;
        const u = schema.columns[i]!.unit;
        if (u !== undefined) unit[role] = u;
        break;
      }
    }
  }
  return { index, unit };
}

// The cores write -1 into their level sensors when they have nothing to judge (no telemetry, sensor missing,
// no pack or no stable GPS fix): no value, not a level.
const NO_VALUE_BELOW_ZERO: readonly Role[] = ['lnst', 'lsst', 'ghst'];

const num = (s: string | undefined) => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

export function samples(log: LogFile, lipo?: LipoModel): { samples: Sample[]; roles: RoleMap[] } {
  const roles = log.schemas.map((s) => mapRoles(s, lipo));
  const out = log.lines.map((line, i): Sample => {
    const { index } = roles[line.schema]!;
    const values: Sample['values'] = {};
    for (const r of NUMERIC as NumericRole[]) {
      const c = index[r];
      if (c === undefined) continue;
      const v = num(line.cells[c]);
      if (v !== undefined && !(v < 0 && NO_VALUE_BELOW_ZERO.includes(r))) values[r] = v;
    }
    const s: Sample = { i, t: line.t, values };
    if (index.fm !== undefined) {
      const fm = (line.cells[index.fm] ?? '').trim().replace(/^"(.*)"$/, '$1');
      if (fm !== '') s.fm = fm;
    }
    if (index.gps !== undefined) {
      const [lat, lon] = (line.cells[index.gps] ?? '').trim().split(/\s+/).map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        s.lat = lat;
        s.lon = lon;
      }
    }
    return s;
  });
  return { samples: out, roles };
}

// Whether any header of the log has a column for the role.
export const hasRole = (roles: RoleMap[], role: Role) => roles.some((r) => r.index[role] !== undefined);
