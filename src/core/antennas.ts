import type { AnalysedLog, FlightInfo } from './analysis.ts';
import { distance } from './analysis.ts';
import { linkUp, validFix } from './flights.ts';
import type { AntennaRose } from './kinds.ts';
import { hasRole } from './roles.ts';

export const ROSE_SECTORS = 8;
export const ROSE_MIN_DISTANCE = 30; // m from home; closer, the direction jumps with every GPS error
export const ROSE_MIN_LINES = 5; // per direction
const RAD = Math.PI / 180;
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

// Both signal strengths of a receiver with two antennas compared by direction, between takeoff and landing.
// The direction is where the radio is as seen from the model (from its heading, Yaw first, else Hdg), since a
// shadowed antenna is shadowed by the model itself; logs without a heading take where the model is from home.
export function antennaRose(a: AnalysedLog, f: FlightInfo): AntennaRose | undefined {
  if (!f.home || !hasRole(a.roles, 'rssi1') || !hasRole(a.roles, 'rssi2')) return undefined;
  const yaw = hasRole(a.roles, 'yaw');
  const basis = yaw || hasRole(a.roles, 'hdg') ? 'model' : 'compass';
  const yawUnit = a.roles.map((r) => r.unit.yaw).find((u) => u !== undefined);
  const sums = new Array<number>(ROSE_SECTORS).fill(0);
  const counts = new Array<number>(ROSE_SECTORS).fill(0);
  const home = f.home;
  for (let i = f.first; i <= f.last; i++) {
    const s = a.samples[i]!;
    if (s.t < f.start || s.t > f.end || !linkUp(s) || !validFix(s, a.minSats)) continue;
    const { rssi1, rssi2 } = s.values;
    // 0 is no value: dBm is never 0, a receiver with one antenna leaves the second at 0
    if (!rssi1 || !rssi2) continue;
    const p = { lat: s.lat!, lon: s.lon! };
    if (distance(home, p) < ROSE_MIN_DISTANCE) continue;
    const fromHome = wrap(Math.atan2((p.lon - home.lon) * Math.cos(home.lat * RAD), p.lat - home.lat) / RAD);
    let dir = fromHome;
    if (basis === 'model') {
      const h = yaw ? s.values.yaw : s.values.hdg;
      if (h === undefined) continue;
      const heading = yaw && yawUnit === 'rad' ? h / RAD : h;
      dir = wrap(fromHome + 180 - heading);
    }
    const k = Math.round(dir / (360 / ROSE_SECTORS)) % ROSE_SECTORS;
    sums[k]! += rssi1 - rssi2;
    counts[k]!++;
  }
  if (counts.every((n) => n < ROSE_MIN_LINES)) return undefined;
  const sectors = sums.map((sum, k) => (counts[k]! >= ROSE_MIN_LINES ? Math.round((sum / counts[k]!) * 10) / 10 : null));
  return { basis, sectors, counts };
}
