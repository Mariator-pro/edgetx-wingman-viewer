import { Button, Dropdown, Label, Switch } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { TrackView } from '../../server/api.ts';
import { extent, formatDelta, formatValue, type Series } from '../series.ts';
import { rowAt } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { useWidth } from '../useWidth.ts';
import { SlidersIcon } from './icons.tsx';
import { clockText } from '../format.ts';

export type Range = [number, number];
export interface Marks {
  a?: number;
  b?: number;
}

// one color per strip, readable on light and dark
const STRIP_COLORS = ['#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#e11d48', '#ca8a04', '#2563eb', '#db2777'];
const STRIP_H = 72;
// fixed room for name and value on the left, scale on the right; the lines start after it
const LABEL_W = 120;
const AXIS_W = 72;
const OVERVIEW_H = 44;
const PAD = 8;
const FOLD_MS = 200; // a strip opens and closes this fast, so the page grows and shrinks smoothly

// Colors for the chosen values: the ones they had, the first free one for new ones.
function paint(old: Record<string, string>, chosen: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of chosen) if (old[id]) out[id] = old[id];
  for (const id of chosen) if (!out[id]) out[id] = STRIP_COLORS.find((c) => !Object.values(out).includes(c)) ?? STRIP_COLORS[Object.keys(out).length % STRIP_COLORS.length]!;
  return out;
}

// The line of one value between r0 and r1 as an SVG path. Per pixel column only the first, smallest, largest
// and last value, so long logs draw as fast as short ones; missing values break the line.
function linePath(times: number[], values: (number | null)[], r: Range, w: number, h: number, lo: number, hi: number): string {
  const x = (t: number) => ((t - r[0]) / (r[1] - r[0] || 1)) * w;
  const y = (v: number) => (hi === lo ? h / 2 : h - PAD - ((v - lo) / (hi - lo)) * (h - 2 * PAD));
  const from = Math.max(0, rowIndex(times, r[0]) - 1);
  const to = Math.min(times.length - 1, rowIndex(times, r[1]) + 1);
  let d = '';
  let col = NaN;
  let first = 0, min = 0, max = 0, last = 0;
  let open = false; // a line is being drawn
  const flush = () => {
    if (Number.isNaN(col)) return;
    d += `${open ? 'L' : 'M'}${col},${y(first).toFixed(1)}L${col},${y(min).toFixed(1)}L${col},${y(max).toFixed(1)}L${col},${y(last).toFixed(1)}`;
    open = true;
  };
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (v == null) {
      flush();
      col = NaN;
      open = false;
      continue;
    }
    const c = Math.round(x(times[i]!));
    if (c !== col) {
      flush();
      col = c;
      first = min = max = last = v;
    } else {
      min = Math.min(min, v);
      max = Math.max(max, v);
      last = v;
    }
  }
  flush();
  return d;
}

const rowIndex = (times: number[], t: number) => {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export function Charts(props: {
  track: TrackView;
  series: Series[];
  chosen: string[];
  onChoose: (ids: string[]) => void;
  time: number;
  hover?: number;
  onHover: (t: number | undefined) => void;
  onSeek: (t: number) => void;
  range: Range;
  onRange: (r: Range | undefined) => void;
  measure: boolean;
  marks: Marks;
  onMarks: (m: Marks) => void;
}) {
  const { track, series, chosen, time, hover, range, measure, marks } = props;
  const { t } = usePrefs();
  const [boxRef, box] = useWidth<HTMLDivElement>();
  const w = Math.max(0, box - LABEL_W - AXIS_W); // width of the plot
  const [drag, setDrag] = useState<{ from: number; to: number }>();
  const [tipY, setTipY] = useState(0); // pointer height over the charts, for the tooltip
  const shown = chosen.map((id) => series.find((s) => s.id === id)).filter((s): s is Series => !!s);
  // each value keeps its color while it is shown
  const [colors, setColors] = useState<Record<string, string>>(() => paint({}, chosen));
  // strips just taken away stay a moment while they close; new ones open. Worked out while rendering, so a
  // strip taken away never disappears before it closes.
  const [leaving, setLeaving] = useState<string[]>([]);
  const [opening, setOpening] = useState<string[]>([]);
  const [before, setBefore] = useState(chosen);
  if (before !== chosen) {
    const gone = before.filter((id) => !chosen.includes(id));
    setBefore(chosen);
    setLeaving([...leaving.filter((id) => !chosen.includes(id)), ...gone]);
    setOpening(chosen.filter((id) => !before.includes(id)));
    setColors(paint(colors, [...chosen, ...gone]));
  }
  useEffect(() => {
    if (leaving.length === 0 && opening.length === 0) return;
    const timer = setTimeout(() => {
      setLeaving([]);
      setOpening([]);
    }, FOLD_MS);
    return () => clearTimeout(timer);
  }, [leaving, opening]);
  const strips = series.filter((s) => chosen.includes(s.id) || leaving.includes(s.id));
  const colorOf = (id: string) => colors[id] ?? STRIP_COLORS.find((c) => !Object.values(colors).includes(c)) ?? STRIP_COLORS[0]!;
  const times = track.rows.t;
  const full: Range = [0, track.duration];
  const zoomed = range[0] > 0 || range[1] < track.duration;
  const x = (s: number) => ((s - range[0]) / (range[1] - range[0] || 1)) * w;
  const xFull = (s: number) => (s / (track.duration || 1)) * w;
  const at = hover ?? time;
  const row = rowAt(track, at);
  const timeOf = (e: React.PointerEvent | React.MouseEvent, r: Range) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - box.left) / (box.width || 1)));
    return r[0] + f * (r[1] - r[0]);
  };
  const pick = (s: number) => {
    if (!measure) return props.onSeek(s);
    const m = props.marks;
    props.onMarks(m.a === undefined || m.b !== undefined ? { a: s } : { a: m.a, b: s });
  };

  // the difference between A and B for every value shown, e.g. "12 s · GAlt +40 m · RxBt −0,80 V"
  let delta: string | undefined;
  if (marks.a !== undefined && marks.b !== undefined) {
    const [a, b] = marks.a <= marks.b ? [marks.a, marks.b] : [marks.b, marks.a];
    const ra = rowAt(track, a);
    const rb = rowAt(track, b);
    const parts = shown.flatMap((s) => {
      const va = s.values[ra];
      const vb = s.values[rb];
      return va != null && vb != null ? [`${s.name} ${formatDelta(s, vb - va, t.locale)}`] : [];
    });
    delta = [`${(b - a).toLocaleString(t.locale, { maximumFractionDigits: 1 })} s`, ...parts].join(' · ');
  }

  const overview = shown[0] ?? series.find((s) => s.id === 'alt');
  const overviewExtent = overview ? extent(overview.values) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div ref={boxRef} className="relative select-none">
        {w > 0 && shown.length === 0 && <p className="m-0 py-6 text-center text-sm text-muted">{t.noChartValues}</p>}
        {w > 0 &&
          strips.map((s) => {
            const ext = extent(s.values, rowIndex(times, range[0]), rowIndex(times, range[1]) + 1);
            const color = colorOf(s.id);
            const v = s.values[row];
            const out = leaving.includes(s.id);
            return (
              <div
                key={s.id}
                className={`flex overflow-hidden border-t border-separator transition-[height,opacity] ease-out first:border-t-0 ${opening.includes(s.id) ? 'animate-[strip-open_200ms_ease-out]' : ''}`}
                style={{ height: out ? 0 : STRIP_H, opacity: out ? 0 : 1, transitionDuration: `${FOLD_MS}ms` }}
              >
                <div className="flex flex-col justify-center gap-0.5 pl-1 text-xs" style={{ width: LABEL_W }} title={s.label}>
                  <span className="font-mono font-semibold" style={{ color }}>
                    {s.name}
                  </span>
                  <span className="tabular-nums">{v != null ? formatValue(s, v, t.locale) : '–'}</span>
                </div>
                <div
                  className="relative cursor-crosshair"
                  style={{ width: w }}
                  onPointerMove={(e) => {
                    props.onHover(timeOf(e, range));
                    setTipY(e.clientY - (boxRef.current?.getBoundingClientRect().top ?? 0));
                  }}
                  onPointerLeave={() => props.onHover(undefined)}
                  onClick={(e) => pick(timeOf(e, range))}
                >
                  <svg width={w} height={STRIP_H} className="absolute inset-0 block" aria-hidden="true">
                    {ext && <path d={linePath(times, s.values, range, w, STRIP_H, ext[0], ext[1])} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />}
                  </svg>
                </div>
                {ext && (
                  <div className="relative text-right text-[10px] tabular-nums text-muted" style={{ width: AXIS_W }}>
                    <span className="absolute right-1" style={{ top: ext[1] > ext[0] ? PAD - 7 : STRIP_H / 2 - 7 }}>
                      {formatValue(s, ext[1], t.locale)}
                    </span>
                    {ext[1] > ext[0] && (
                      <span className="absolute right-1" style={{ bottom: PAD - 7 }}>
                        {formatValue(s, ext[0], t.locale)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        {w > 0 && shown.length > 0 && (
          <svg width={w} height={shown.length * STRIP_H} className="pointer-events-none absolute top-0" style={{ left: LABEL_W }} aria-hidden="true">
            {[marks.a, marks.b].map((m, i) =>
              m !== undefined && m >= range[0] && m <= range[1] ? (
                <g key={i}>
                  <line x1={x(m)} x2={x(m)} y1={0} y2={shown.length * STRIP_H} className="stroke-foreground" strokeWidth={1.5} />
                  <text x={x(m) + 4} y={shown.length * STRIP_H - 6} className="fill-foreground text-[11px] font-semibold">
                    {i === 0 ? 'A' : 'B'}
                  </text>
                </g>
              ) : null,
            )}
            {hover !== undefined && <line x1={x(hover)} x2={x(hover)} y1={0} y2={shown.length * STRIP_H} className="stroke-muted" strokeDasharray="4 3" />}
            {time >= range[0] && time <= range[1] && <line x1={x(time)} x2={x(time)} y1={0} y2={shown.length * STRIP_H} className="stroke-accent" strokeWidth={1.5} />}
          </svg>
        )}
        {w > 0 && hover !== undefined && shown.length > 0 && (
          // the values under the pointer, beside the line; on the left of it near the right edge
          <div
            className="pointer-events-none absolute z-10 flex min-w-40 flex-col gap-1 rounded-lg bg-surface px-3 py-2 text-xs shadow-md ring-1 ring-separator"
            style={{
              top: Math.max(0, Math.min(tipY - 20, shown.length * STRIP_H - 28 - shown.length * 18)),
              ...(x(hover) > w - 200 ? { right: AXIS_W + w - x(hover) + 12 } : { left: LABEL_W + x(hover) + 12 }),
            }}
          >
            <span className="font-semibold tabular-nums">{clockText(hover)}</span>
            {shown.map((s) => {
              const v = s.values[row];
              return (
                <span key={s.id} className="flex items-center gap-2">
                  <i className="inline-block size-2 rounded-full" style={{ background: colorOf(s.id) }} />
                  <span className="flex-1 text-muted">{s.label}</span>
                  <span className="font-semibold tabular-nums">{v != null ? formatValue(s, v, t.locale) : '–'}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {delta && <p className="m-0 rounded-lg bg-surface-secondary px-3 py-2 text-sm tabular-nums">{delta}</p>}
      <div className="flex justify-between text-[10px] tabular-nums text-muted" style={{ marginLeft: LABEL_W, marginRight: AXIS_W }}>
        <span>{clockText(range[0])}</span>
        <span>{clockText(range[1])}</span>
      </div>

      {w > 0 && overview && overviewExtent && (
        <div className="flex flex-col gap-1" style={{ marginLeft: LABEL_W, marginRight: AXIS_W }}>
          <div
            className="relative cursor-ew-resize overflow-hidden rounded-lg bg-surface-secondary"
            style={{ height: OVERVIEW_H }}
            role="slider"
            aria-label={t.chartOverview}
            aria-valuemin={0}
            aria-valuemax={Math.round(track.duration)}
            aria-valuenow={Math.round(range[0])}
            aria-valuetext={`${clockText(range[0])} – ${clockText(range[1])}`}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const s = timeOf(e, full);
              setDrag({ from: s, to: s });
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, to: timeOf(e, full) })}
            onPointerUp={(e) => {
              if (!drag) return;
              const to = timeOf(e, full);
              setDrag(undefined);
              if (Math.abs(xFull(to) - xFull(drag.from)) < 4) props.onSeek(to);
              else props.onRange([Math.min(drag.from, to), Math.max(drag.from, to)]);
            }}
            onDoubleClick={() => props.onRange(undefined)}
          >
            <svg width={w} height={OVERVIEW_H} className="absolute inset-0 block" aria-hidden="true">
              <path d={linePath(times, overview.values, full, w, OVERVIEW_H, overviewExtent[0], overviewExtent[1])} fill="none" className="stroke-muted" strokeWidth={1.2} />
              {zoomed && !drag && (
                <>
                  <rect x={0} y={0} width={xFull(range[0])} height={OVERVIEW_H} className="fill-foreground" fillOpacity={0.12} />
                  <rect x={xFull(range[1])} y={0} width={w - xFull(range[1])} height={OVERVIEW_H} className="fill-foreground" fillOpacity={0.12} />
                  <rect x={xFull(range[0])} y={0.5} width={xFull(range[1]) - xFull(range[0])} height={OVERVIEW_H - 1} fill="none" className="stroke-accent" />
                </>
              )}
              {drag && <rect x={Math.min(xFull(drag.from), xFull(drag.to))} y={0} width={Math.abs(xFull(drag.to) - xFull(drag.from))} height={OVERVIEW_H} className="fill-accent" fillOpacity={0.2} />}
              <line x1={xFull(time)} x2={xFull(time)} y1={0} y2={OVERVIEW_H} className="stroke-accent" strokeWidth={1.5} />
            </svg>
          </div>
          <span className="text-xs text-muted">{t.overviewHint}</span>
        </div>
      )}
    </div>
  );
}

// Above the charts, beside the tabs: the values shown and the switch for measuring.
export function ChartTools(props: {
  series: Series[];
  chosen: string[];
  onChoose: (ids: string[]) => void;
  measure: boolean;
  onMeasure: (on: boolean) => void;
  marks: Marks;
  zoomed: boolean;
  onWholeFlight: () => void;
}) {
  const { series, chosen } = props;
  const { t } = usePrefs();
  return (
    <div className="flex flex-wrap items-center gap-3">
      {props.measure && props.marks.b === undefined && <span className="text-sm text-muted">{props.marks.a === undefined ? t.measureA : t.measureB}</span>}
      {props.zoomed && (
        <Button variant="ghost" size="sm" onPress={props.onWholeFlight}>
          {t.wholeFlight}
        </Button>
      )}
      <Switch isSelected={props.measure} onChange={props.onMeasure} size="sm">
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label className="text-sm">{t.measure}</Label>
        </Switch.Content>
      </Switch>
      <Dropdown>
        <Button variant="outline" size="sm">
          <SlidersIcon size={14} />
          {t.chooseValues}
        </Button>
        <Dropdown.Popover placement="bottom end" className="max-h-80 overflow-y-auto">
          <Dropdown.Menu
            aria-label={t.chartValues}
            selectionMode="multiple"
            selectedKeys={new Set(chosen)}
            onSelectionChange={(k) => k !== 'all' && props.onChoose(series.filter((s) => k.has(s.id)).map((s) => s.id))}
          >
            {series.map((s) => (
              <Dropdown.Item key={s.id} id={s.id} textValue={s.label}>
                <span className="flex items-baseline gap-2">
                  <span className="w-10 font-mono text-xs text-muted">{s.name}</span>
                  {s.label}
                </span>
                <Dropdown.ItemIndicator />
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
