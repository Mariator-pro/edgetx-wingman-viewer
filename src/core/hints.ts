import { linkUp, type Flight } from './flights.ts';
import type { HintKind } from './kinds.ts';
import type { LipoModel, Projects } from './projects.ts';
import { hasRole, type RoleMap, type Sample } from './roles.ts';

// Limits of Link Sentinel and Lipo Nanny, for logs without the cores' sensors.
export const RQLY_THRESHOLD = 42; // %
export const HINT_DEBOUNCE_MS = 2000;
export const CELL_CRIT: Record<string, number> = { LiPo: 3.5, LiPoHV: 3.5, LiIon: 2.9 };
const MAX_CELL_V = 4.35; // for guessing the cell count from the first voltage

export type { HintKind } from './kinds.ts';

export interface Hint {
  t: number;
  kind: HintKind;
}

const STAGE_HINTS = {
  lnst: [undefined, 'battery-warning', 'battery-critical'],
  lsst: [undefined, 'link-warning', 'link-critical'],
  ghst: [undefined, 'max-altitude', 'max-distance', 'gps-lost'],
} as const;

export interface HintSetup {
  rqlyThreshold: number;
  cells?: number; // from Lipo Nanny; otherwise guessed per flight
  cellCrit: number;
}

export function hintSetup(projects: Projects, lipo?: LipoModel, pack?: number): HintSetup {
  const chems = new Set(lipo?.chemistries ?? []);
  const packChem = pack !== undefined ? projects.packs[pack]?.chemistry : undefined;
  const chem = chems.size === 1 ? [...chems][0]! : packChem ?? 'LiPo';
  return { rqlyThreshold: projects.rqlyThreshold ?? RQLY_THRESHOLD, cells: lipo?.cells, cellCrit: CELL_CRIT[chem] ?? CELL_CRIT.LiPo! };
}

export function guessCells(samples: Sample[], f: Flight): number | undefined {
  for (let i = f.first; i <= f.last; i++) {
    const v = samples[i]!.values.volt;
    if (v !== undefined && v > 0.5 && linkUp(samples[i]!)) return Math.max(1, Math.ceil(v / MAX_CELL_V));
  }
  return undefined;
}

// Hints of one flight: from the cores' sensors where the log has them (a rising stage, as Wingman records it),
// otherwise for link and battery by the cores' limits, held for at least 2 s; one hint per drop below.
export function flightHints(samples: Sample[], roles: RoleMap[], f: Flight, setup: HintSetup): Hint[] {
  const hints: Hint[] = [];
  const fromCores = (['lnst', 'lsst', 'ghst'] as const).filter((r) => hasRole(roles, r));
  const prev: Partial<Record<string, number>> = {};
  const below: Partial<Record<'lq' | 'cell', { since: number; told: boolean }>> = {};
  const cells = setup.cells ?? guessCells(samples, f);

  const hold = (key: 'lq' | 'cell', low: boolean, t: number, kind: HintKind) => {
    if (!low) {
      delete below[key];
      return;
    }
    const b = (below[key] ??= { since: t, told: false });
    if (!b.told && t - b.since >= HINT_DEBOUNCE_MS) {
      b.told = true;
      hints.push({ t: b.since, kind });
    }
  };

  for (let i = f.first; i <= f.last; i++) {
    const s = samples[i]!;
    if (!linkUp(s)) continue;
    for (const r of fromCores) {
      const v = s.values[r];
      if (v === undefined) continue;
      const kind = STAGE_HINTS[r][v as 1 | 2 | 3];
      if (kind && v > (prev[r] ?? 0)) hints.push({ t: s.t, kind });
      prev[r] = v;
    }
    if (!fromCores.includes('lsst') && s.values.lq !== undefined) hold('lq', s.values.lq < setup.rqlyThreshold, s.t, 'link-critical');
    const v = s.values.volt;
    if (!fromCores.includes('lnst') && v !== undefined && v > 0 && cells) hold('cell', v / cells < setup.cellCrit, s.t, 'battery-critical');
  }
  return hints.sort((a, b) => a.t - b.t);
}
