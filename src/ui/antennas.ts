import type { AntennaRose } from '../core/kinds.ts';
import type { Texts } from './texts.ts';

export const EQUAL_DB = 3; // less difference than this counts as equally strong

// The result in plain words: the direction where one antenna is weakest, or that it is weaker everywhere.
export function roseResult(rose: AntennaRose, t: Texts): string {
  const vals = rose.sectors.filter((v): v is number => v !== null);
  const db = (v: number) => Math.abs(v).toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const worst = rose.sectors.reduce<number>((w, v, k) => (v !== null && Math.abs(v) > Math.abs(rose.sectors[w] ?? 0) ? k : w), 0);
  const top = rose.sectors[worst] ?? 0;
  if (Math.abs(top) < EQUAL_DB) return t.antennasEqual;
  if (Math.max(...vals) - Math.min(...vals) < EQUAL_DB) {
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    return t.antennasOffset(mean > 0 ? 2 : 1, db(mean));
  }
  const a = top > 0 ? 2 : 1;
  return rose.basis === 'model' ? t.antennasModelResult(a, db(top), t.radioWhere[worst]!) : t.antennasCompassResult(a, db(top), t.modelWhere[worst]!);
}
