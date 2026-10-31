import type { Stick, StickMode } from '../../core/kinds.ts';
import type { TrackView } from '../../server/api.ts';
import { usePrefs } from '../usePrefs.ts';

// Which stick moves which way, per field [horizontal, vertical]: mode 2 has throttle on the left, mode 1 on the
// right; modes 3 and 4 swap rudder and aileron.
const LAYOUT: Record<StickMode, [[Stick, Stick], [Stick, Stick]]> = {
  1: [
    ['rud', 'ele'],
    ['ail', 'thr'],
  ],
  2: [
    ['rud', 'thr'],
    ['ail', 'ele'],
  ],
  3: [
    ['ail', 'ele'],
    ['rud', 'thr'],
  ],
  4: [
    ['ail', 'thr'],
    ['rud', 'ele'],
  ],
};
const SIZE = 84;
const MAX = 1024;
const NAMES: Record<Stick, string> = { rud: 'Rud', ele: 'Ele', thr: 'Thr', ail: 'Ail' };

// The two sticks at a log line, as a dot in a square each, with the stick names below.
export function Sticks({ track, row, mode }: { track: TrackView; row: number; mode: StickMode }) {
  const { t } = usePrefs();
  const s = track.sticks;
  if (!s) return null;
  const pos = (k: Stick) => Math.max(-1, Math.min(1, (s[k]?.[row] ?? 0) / MAX));
  return (
    <div className="flex w-full justify-center gap-3" role="img" aria-label={`${t.sticks}, ${t.stickModeShort(mode)}`}>
      {LAYOUT[mode].map(([h, v]) => (
        <div key={h + v} className="flex flex-col items-center gap-1">
          <svg width={SIZE} height={SIZE} className="rounded-xl border border-separator bg-surface-secondary" aria-hidden="true">
            <line x1={SIZE / 2} x2={SIZE / 2} y1={8} y2={SIZE - 8} className="stroke-separator" />
            <line y1={SIZE / 2} y2={SIZE / 2} x1={8} x2={SIZE - 8} className="stroke-separator" />
            <circle cx={SIZE / 2 + (pos(h) * (SIZE - 20)) / 2} cy={SIZE / 2 - (pos(v) * (SIZE - 20)) / 2} r={6} className="fill-foreground" />
          </svg>
          <span className="text-[11px] text-muted">
            {NAMES[v]} · {NAMES[h]}
          </span>
        </div>
      ))}
    </div>
  );
}
