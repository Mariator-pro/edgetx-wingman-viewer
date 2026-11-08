import { Label, ListBox, Select, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useMemo } from 'react';
import type { TrackView } from '../../server/api.ts';
import { extent, fitCurve, formatValue, PAIRS, type Series } from '../series.ts';
import { rowAt } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { useWidth } from '../useWidth.ts';
import type { Range } from './Charts.tsx';

const H = 360;
const PAD = { left: 64, right: 16, top: 12, bottom: 32 };
const INSET = 14; // room between the outermost points and the edge of the plot

// Two values against each other, one point per log line in the air (and in the zoomed range), with a fitted
// curve and the current moment as a point that moves along when playing.
export function Scatter(props: { track: TrackView; series: Series[]; pair: [string, string]; onPair: (p: [string, string]) => void; time: number; range: Range }) {
  const { track, series, pair, time, range } = props;
  const { t } = usePrefs();
  const [boxRef, w] = useWidth<HTMLDivElement>();
  const xs = series.find((s) => s.id === pair[0]);
  const ys = series.find((s) => s.id === pair[1]);

  const cloud = useMemo(() => {
    if (!xs || !ys) return undefined;
    const from = Math.max(range[0], track.takeoff);
    const to = Math.min(range[1], track.landing);
    const px: number[] = [];
    const py: number[] = [];
    track.rows.t.forEach((s, i) => {
      const x = xs.values[i];
      const y = ys.values[i];
      if (s >= from && s <= to && x != null && y != null) {
        px.push(x);
        py.push(y);
      }
    });
    const ex = extent(px);
    const ey = extent(py);
    return ex && ey ? { px, py, ex, ey, fit: fitCurve(px, py) } : undefined;
  }, [xs, ys, track, range]);

  const choose = (k: number, id: string) => props.onPair(k === 0 ? [id, pair[1]] : [pair[0], id]);
  const axis = (k: number) => (
    <Select variant="secondary" className="w-56" selectedKey={pair[k]} onSelectionChange={(id) => id !== null && choose(k, String(id))}>
      <Label>{k === 0 ? t.horizontal : t.vertical}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="field-list">
        <ListBox>
          {series.map((s) => (
            <ListBox.Item key={s.id} id={s.id} textValue={`${s.name} ${s.label}`}>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted">{s.name}</span>
                {s.label}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );

  let plot: React.ReactNode = <p className="m-0 py-10 text-center text-sm text-muted">{t.noScatter}</p>;
  if (cloud && xs && ys && w > 0) {
    const { px, py, ex, ey, fit } = cloud;
    // a value that doesn't change sits in the middle
    const share = (v: number, e: [number, number]) => (e[1] > e[0] ? (v - e[0]) / (e[1] - e[0]) : 0.5);
    const sx = (v: number) => PAD.left + INSET + share(v, ex) * (w - PAD.left - PAD.right - 2 * INSET);
    const sy = (v: number) => H - PAD.bottom - INSET - share(v, ey) * (H - PAD.top - PAD.bottom - 2 * INSET);
    const row = rowAt(track, time);
    const cx = xs.values[row];
    const cy = ys.values[row];
    let curve = '';
    if (fit) {
      for (let k = 0; k <= 60; k++) {
        const v = ex[0] + ((ex[1] - ex[0]) * k) / 60;
        const y = Math.min(ey[1], Math.max(ey[0], fit(v)));
        curve += `${k ? 'L' : 'M'}${sx(v).toFixed(1)},${sy(y).toFixed(1)}`;
      }
    }
    plot = (
      <svg width={w} height={H} className="block" role="img" aria-label={`${xs.label} – ${ys.label}`}>
        <rect x={PAD.left} y={PAD.top} width={w - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} className="fill-surface-secondary" rx={8} />
        {px.map((v, i) => (
          <circle key={i} cx={sx(v)} cy={sy(py[i]!)} r={2.2} className="fill-accent" fillOpacity={0.35} />
        ))}
        {curve && <path d={curve} fill="none" className="stroke-foreground" strokeWidth={2} />}
        {cx != null && cy != null && <circle cx={sx(cx)} cy={sy(cy)} r={6} fill="#f97316" className="stroke-surface" strokeWidth={2} />}
        <g className="fill-muted text-[10px] tabular-nums">
          <text x={PAD.left - 6} y={sy(ey[1]) + 3} textAnchor="end">
            {formatValue(ys, ey[1], t.locale)}
          </text>
          {ey[1] > ey[0] && (
            <text x={PAD.left - 6} y={sy(ey[0]) + 3} textAnchor="end">
              {formatValue(ys, ey[0], t.locale)}
            </text>
          )}
          {ex[1] > ex[0] && (
            <text x={sx(ex[0])} y={H - PAD.bottom + 14} textAnchor="middle">
              {formatValue(xs, ex[0], t.locale)}
            </text>
          )}
          <text x={sx(ex[1])} y={H - PAD.bottom + 14} textAnchor="middle">
            {formatValue(xs, ex[1], t.locale)}
          </text>
        </g>
        <text x={(PAD.left + w - PAD.right) / 2} y={H - 6} textAnchor="middle" className="fill-foreground text-xs">
          {xs.name} · {xs.label}
        </text>
        <text transform={`translate(14 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-foreground text-xs">
          {ys.name} · {ys.label}
        </text>
      </svg>
    );
  }

  const pairs = PAIRS.map((p, i) => ({ p, name: t.pairNames[i]! })).filter(({ p }) => p.every((id) => series.some((s) => s.id === id)));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <ToggleButtonGroup
          aria-label={t.scatterTab}
          size="sm"
          selectionMode="single"
          selectedKeys={[pair.join()]}
          onSelectionChange={(k) => {
            const hit = pairs.find(({ p }) => p.join() === [...k][0]);
            if (hit) props.onPair(hit.p);
          }}
        >
          {pairs.map(({ p, name }) => (
            <ToggleButton key={p.join()} id={p.join()}>
              {name}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <span className="flex-1" />
        {axis(0)}
        {axis(1)}
      </div>
      <div ref={boxRef}>{plot}</div>
      <p className="m-0 text-xs text-muted">{t.scatterHint}</p>
    </div>
  );
}
