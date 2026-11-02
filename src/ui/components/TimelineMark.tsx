import { Tooltip } from '@heroui/react';
import { fromTakeoff } from '../format.ts';
import { bundle, type Mark } from '../marks.ts';
import { usePrefs } from '../usePrefs.ts';
import { useWidth } from '../useWidth.ts';

// The marks of events and hints in a row above the timeline or the charts. Marks too close to tell apart become one
// with their count; pointing shows names and times at once, a click jumps to the (first) one.
export function MarkRow(props: { marks: Mark[]; at: (t: number) => number; takeoff: number; onPick: (t: number) => void; className: string; style?: React.CSSProperties }) {
  const { t } = usePrefs();
  const [ref, width] = useWidth<HTMLDivElement>();
  const when = (s: number) => fromTakeoff(s, props.takeoff);
  return (
    <div ref={ref} className={`pointer-events-none ${props.className}`} style={props.style}>
      {width > 0 &&
        bundle(props.marks, props.at, width).map((group) => {
          const first = group[0]!;
          const tone = group.reduce((a, m) => (m.tone.rank > a.rank ? m.tone : a), first.tone);
          const shape =
            group.length > 1
              ? `top-0 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold leading-none text-background ${tone.bg}`
              : first.hint
                ? `top-0.5 size-3 rotate-45 rounded-[2px] ${tone.bg}`
                : `top-0 h-3.5 w-[3px] rounded-full ${tone.bg}`;
          const pick = () => props.onPick(first.t);
          return (
            <Tooltip key={`${first.hint ? 'h' : 'e'}${first.t}${first.name}`} delay={0} closeDelay={0}>
              <Tooltip.Trigger
                aria-label={t.jumpTo(group.map((m) => m.name).join(', '), when(first.t))}
                className={`pointer-events-auto absolute -translate-x-1/2 cursor-pointer ${shape}`}
                style={{ left: `${props.at(first.t) * 100}%` }}
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  pick();
                }}
              >
                {group.length > 1 ? group.length : null}
              </Tooltip.Trigger>
              <Tooltip.Content showArrow placement="top">
                <Tooltip.Arrow />
                {group.map((m) => (
                  <div key={`${m.hint ? 'h' : 'e'}${m.t}${m.name}`}>
                    <span className="font-medium">{m.name}</span> <span className="tabular-nums text-muted">{when(m.t)}</span>
                  </div>
                ))}
              </Tooltip.Content>
            </Tooltip>
          );
        })}
    </div>
  );
}
