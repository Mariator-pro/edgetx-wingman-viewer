import type { MeshAttributes } from '@loaders.gl/schema';
import type { Airframe } from '../core/kinds.ts';

// The models of the attitude view, built from simple shapes: light grey (blue grey in light mode) with dark
// details, the front marked orange. Authored with x to the right, y up and the nose towards -z, then turned into deck.gl's frame
// (x forward, y left, z up), in which pitch turns about y, roll about x and yaw about z.

type V3 = [number, number, number];
type Rgb = V3;
export type MeshData = MeshAttributes;
export interface AirframeMesh {
  body: MeshData;
  props?: MeshData; // drawn see-through
}

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
interface Palette {
  front: Rgb;
  light: Rgb;
  mid: Rgb;
  dark: Rgb;
  prop: Rgb;
}
// light grey on the dark card; on the light card a blue grey, so the model stands out from the white
const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: { front: hex(0xf97316), light: hex(0xe4e4e7), mid: hex(0x71717a), dark: hex(0x27272a), prop: hex(0xd4d4d8) },
  light: { front: hex(0xf97316), light: hex(0x94a3b8), mid: hex(0x475569), dark: hex(0x1e293b), prop: hex(0x64748b) },
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotY = (p: V3, a: number): V3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];

// Collects flat-shaded triangles.
class Builder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];

  tri(a: V3, b: V3, c: V3, color: Rgb, outside?: V3): void {
    let n = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(...n);
    if (len < 1e-9) return;
    n = [n[0] / len, n[1] / len, n[2] / len];
    // a reference point inside: the face must point away from it
    if (outside && dot(n, sub([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], outside)) < 0) {
      [b, c] = [c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    for (const p of [a, b, c]) {
      // authored frame to deck.gl's: forward = -z, left = -x, up = y
      this.pos.push(-p[2], -p[0], p[1]);
      this.nor.push(-n[2], -n[0], n[1]);
      this.col.push(...color);
    }
  }

  // A surface turned about an axis through center: profile of [position along the axis, radius], radii
  // scaled per side for ellipsoids, upper only the half above the axis (a dome).
  revolve(profile: [number, number][], axis: 'x' | 'y' | 'z', center: V3, color: Rgb, segments = 24, scale: [number, number] = [1, 1], upper = false): void {
    const at = (s: number, r: number, t: number): V3 => {
      const u = r * Math.cos(t) * scale[0];
      const v = r * Math.sin(t) * scale[1];
      // about z, v is up, so a dome is the upper half
      const p: V3 = axis === 'x' ? [s, u, v] : axis === 'y' ? [u, s, v] : [u, v, s];
      return [p[0] + center[0], p[1] + center[1], p[2] + center[2]];
    };
    const mid = (profile[0]![0] + profile[profile.length - 1]![0]) / 2;
    const inside = at(mid, 0, 0);
    for (let i = 0; i + 1 < profile.length; i++) {
      const [s0, r0] = profile[i]!;
      const [s1, r1] = profile[i + 1]!;
      for (let j = 0; j < segments; j++) {
        const turn = upper ? Math.PI : 2 * Math.PI;
        const t0 = (j / segments) * turn;
        const t1 = ((j + 1) / segments) * turn;
        const a = at(s0, r0, t0);
        const b = at(s0, r0, t1);
        const c = at(s1, r1, t1);
        const d = at(s1, r1, t0);
        // the side faces point away from the axis, end caps away from the middle
        const ref = Math.abs(s1 - s0) < 1e-9 ? inside : at((s0 + s1) / 2, 0, 0);
        this.tri(a, b, c, color, ref);
        this.tri(a, c, d, color, ref);
      }
    }
  }

  // A flat outline thickened: map turns (u, v, w) into the authored frame, the outline lies in u/v.
  extrude(outline: [number, number][], w0: number, w1: number, map: (u: number, v: number, w: number) => V3, color: Rgb): void {
    const pts = area(outline) < 0 ? [...outline].reverse() : outline;
    const cu = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cv = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (const [i, j, k] of earcut(pts)) {
      const [a, b, c] = [pts[i]!, pts[j]!, pts[k]!];
      this.tri(map(a[0], a[1], w1), map(b[0], b[1], w1), map(c[0], c[1], w1), color, map(cu, cv, w0));
      this.tri(map(a[0], a[1], w0), map(c[0], c[1], w0), map(b[0], b[1], w0), color, map(cu, cv, w1));
    }
    for (let i = 0; i < pts.length; i++) {
      const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
      // outward: to the right of the edge of a counter-clockwise outline
      const out = map(a[0] + (b[1] - a[1]) * 0.01 + (b[0] - a[0]) * 0.5, a[1] - (b[0] - a[0]) * 0.01 + (b[1] - a[1]) * 0.5, (w0 + w1) / 2);
      const mid = map((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (w0 + w1) / 2);
      const ref: V3 = [2 * mid[0] - out[0], 2 * mid[1] - out[1], 2 * mid[2] - out[2]];
      this.tri(map(a[0], a[1], w0), map(b[0], b[1], w0), map(b[0], b[1], w1), color, ref);
      this.tri(map(a[0], a[1], w0), map(b[0], b[1], w1), map(a[0], a[1], w1), color, ref);
    }
  }

  // A box, optionally turned about the vertical axis.
  box(center: V3, size: V3, color: Rgb, turn = 0): void {
    const [sx, sy, sz] = size.map((s) => s / 2) as V3;
    this.extrude(
      [
        [-sx, -sz],
        [sx, -sz],
        [sx, sz],
        [-sx, sz],
      ],
      -sy,
      sy,
      (u, v, w) => {
        const p = rotY([u, w, v], turn);
        return [p[0] + center[0], p[1] + center[1], p[2] + center[2]];
      },
      color,
    );
  }

  mesh(): MeshData {
    return {
      positions: { value: new Float32Array(this.pos), size: 3 },
      normals: { value: new Float32Array(this.nor), size: 3 },
      colors: { value: new Float32Array(this.col), size: 3 },
    };
  }
}

function area(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// Triangles of a simple counter-clockwise outline, by cutting off ears.
function earcut(pts: [number, number][]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cr = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    for (let k = 0; k < idx.length; k++) {
      const i = idx[(k + idx.length - 1) % idx.length]!;
      const j = idx[k]!;
      const l = idx[(k + 1) % idx.length]!;
      const [a, b, c] = [pts[i]!, pts[j]!, pts[l]!];
      if (cr(a, b, c) <= 0) continue;
      const inside = idx.some((m) => m !== i && m !== j && m !== l && cr(a, b, pts[m]!) >= 0 && cr(b, c, pts[m]!) >= 0 && cr(c, a, pts[m]!) >= 0);
      if (inside) continue;
      out.push([i, j, l]);
      idx.splice(k, 1);
      break;
    }
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

// Outline of a wing half seen from above (span outwards, chord backwards), with tapered, cut tips, mirrored.
function wingOutline(span: number, root: number, tip: number, sweep: number): [number, number][] {
  const half: [number, number][] = [
    [0, -root / 2],
    [span - 0.06, -root / 2 + sweep],
    [span, -tip / 2 + sweep + 0.03],
    [span, tip / 2 + sweep - 0.03],
    [span - 0.06, tip / 2 + sweep],
    [0, root / 2],
  ];
  return [...half, ...half.slice(1, -1).reverse().map(([x, z]): [number, number] => [-x, z])];
}
// outline from above at height y: (u, v, w) = (x, z, y)
const flat = (y: number, z: number) => (u: number, v: number, w: number): V3 => [u, y + w, z + v];

function plane(col: Palette): AirframeMesh {
  const b = new Builder();
  const p = new Builder();
  // fuselage: round nose, widest behind the cowling, thin towards the tail
  const prof: [number, number][] = [[0, 0], [0.01, 0.07], [0.05, 0.11], [0.14, 0.13], [0.3, 0.135], [0.55, 0.12], [0.9, 0.08], [1.2, 0.045], [1.32, 0.03], [1.33, 0]];
  b.revolve(prof.map(([z, r]) => [z - 0.5, r]), 'z', [0, 0, 0], col.light);
  b.extrude(wingOutline(1.15, 0.36, 0.22, 0.04), -0.02, 0.02, flat(0.145, -0.04), col.light);
  b.extrude(wingOutline(0.42, 0.2, 0.12, 0.05), -0.012, 0.012, flat(0.03, 0.66), col.light);
  // fin, swept back: outline (back, up), thin across
  b.extrude([[0, 0], [0.26, 0], [0.24, 0.24], [0.12, 0.27]], -0.01, 0.01, (u, v, w) => [w, 0.05 + v, 0.55 + u], col.mid);
  // cabin under the wing, windscreen in front of it
  b.revolve(ellipse(0.3, 10), 'z', [0, 0.06, -0.06], col.light, 24, [0.11, 0.1]);
  b.revolve(ellipse(0.16, 8), 'z', [0, 0.075, -0.27], col.dark, 24, [0.095, 0.085], true);
  b.revolve([[-0.5, 0], [-0.5, 0.06], [-0.63, 0]], 'z', [0, 0, 0], col.front);
  for (const x of [0.16, -0.16]) {
    b.box([x * 0.62, -0.17, -0.3], [0.016, 0.22, 0.016], col.dark);
    b.revolve([[-0.018, 0], [-0.018, 0.055], [0.018, 0.055], [0.018, 0]], 'x', [x, -0.27, -0.3], col.dark, 20);
  }
  b.revolve([[-0.01, 0], [-0.01, 0.025], [0.01, 0.025], [0.01, 0]], 'x', [0, -0.085, 0.66], col.dark, 14);
  p.revolve([[-0.005, 0], [-0.005, 0.3], [0.005, 0.3], [0.005, 0]], 'z', [0, 0, -0.52], col.prop, 40);
  return { body: b.mesh(), props: p.mesh() };
}

// Profile of an ellipsoid with the given half length and radius 1; the radii across come from revolve's scale.
function ellipse(len: number, steps: number): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = Math.PI * (i / steps);
    return [-Math.cos(a) * len, Math.sin(a)] as [number, number];
  });
}

function quad(col: Palette): AirframeMesh {
  const b = new Builder();
  const p = new Builder();
  for (const a of [Math.PI / 4, -Math.PI / 4]) b.box([0, 0, 0], [2, 0.05, 0.12], col.dark, a);
  b.box([0, 0.05, 0], [0.42, 0.08, 0.62], col.mid);
  b.box([0, 0.18, 0], [0.3, 0.16, 0.5], col.light);
  b.box([0, 0.08, -0.36], [0.18, 0.16, 0.14], col.front);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const c: V3 = [x * 0.707, 0, z * 0.707];
    b.revolve([[0, 0], [0, 0.08], [0.12, 0.08], [0.12, 0]], 'y', c, z < 0 ? col.front : col.mid, 20);
    p.revolve([[0.125, 0], [0.125, 0.36], [0.135, 0.36], [0.135, 0]], 'y', c, col.prop, 40);
  }
  return { body: b.mesh(), props: p.mesh() };
}

function wing(col: Palette): AirframeMesh {
  const b = new Builder();
  const p = new Builder();
  const outline: [number, number][] = [[0, -0.7], [1.15, 0.25], [1.15, 0.5], [0.25, 0.25], [0, 0.35], [-0.25, 0.25], [-1.15, 0.5], [-1.15, 0.25]];
  b.extrude(outline, -0.035, 0.035, flat(0, 0), col.light);
  // pod with an orange nose
  b.revolve([[-0.42, 0.1], [0.05, 0.1], [0.12, 0.08], [0.17, 0]], 'z', [0, 0.06, 0], col.mid);
  b.revolve(ellipse(0.1, 8).filter(([s]) => s <= 0.001), 'z', [0, 0.06, -0.42], col.front, 24, [0.1, 0.1]);
  for (const x of [1.13, -1.13]) b.box([x, 0.07, 0.38], [0.03, 0.22, 0.25], col.mid);
  p.revolve([[-0.005, 0], [-0.005, 0.25], [0.005, 0.25], [0.005, 0]], 'z', [0, 0.06, 0.42], col.prop, 40);
  return { body: b.mesh(), props: p.mesh() };
}

// Until the kind of model is chosen: a plain arrow with an orange tip.
function arrow(col: Palette): AirframeMesh {
  const b = new Builder();
  b.extrude([[0, -0.9], [0.7, 0.7], [0, 0.35], [-0.7, 0.7]], -0.04, 0.04, flat(0, 0), col.light);
  b.extrude([[0, -0.9], [0.18, -0.48], [-0.18, -0.48]], -0.045, 0.045, flat(0.002, 0), col.front);
  return { body: b.mesh() };
}

const BUILD: Record<Airframe | 'arrow', (col: Palette) => AirframeMesh> = { copter: quad, plane, wing, arrow };
const cache = new Map<string, AirframeMesh>();
export function airframeMesh(kind: Airframe | 'arrow', theme: 'dark' | 'light'): AirframeMesh {
  const key = `${kind}-${theme}`;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = BUILD[kind](PALETTES[theme])));
  return m;
}
