import type { EventKind } from '../core/kinds.ts';

const BAD: EventKind[] = ['link-lost', 'failsafe'];
const GOOD: EventKind[] = ['link-back', 'gps-back'];
const NOTICE: EventKind[] = ['rth', 'land', 'gps-lost'];

// The color of an event or hint, the same on the timeline and in the charts (class names written out for Tailwind);
// a bundle of marks takes the most urgent one.
export interface Tone {
  bg: string;
  stroke: string;
  rank: number;
}
const TONES = {
  danger: { bg: 'bg-danger', stroke: 'stroke-danger', rank: 3 },
  warning: { bg: 'bg-warning', stroke: 'stroke-warning', rank: 2 },
  success: { bg: 'bg-success', stroke: 'stroke-success', rank: 1 },
  plain: { bg: 'bg-foreground', stroke: 'stroke-foreground', rank: 0 },
} satisfies Record<string, Tone>;
export const HINT_TONE = TONES.warning;
export const eventTone = (k: EventKind): Tone => (BAD.includes(k) ? TONES.danger : GOOD.includes(k) ? TONES.success : NOTICE.includes(k) ? TONES.warning : TONES.plain);

// An event or a hint above the timeline or the charts.
export interface Mark {
  t: number;
  name: string;
  tone: Tone;
  hint: boolean;
}

export const BUNDLE_PX = 12; // marks closer than this become one with a count

// Marks in time order, those drawn closer than gap px to the one before in one bundle; x gives 0 to 1 across.
export function bundle(marks: Mark[], x: (t: number) => number, width: number, gap = BUNDLE_PX): Mark[][] {
  const out: Mark[][] = [];
  for (const m of [...marks].sort((a, b) => a.t - b.t)) {
    const last = out.at(-1);
    if (last && (x(m.t) - x(last.at(-1)!.t)) * width < gap) last.push(m);
    else out.push([m]);
  }
  return out;
}
