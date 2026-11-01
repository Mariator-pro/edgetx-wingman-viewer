import { Card } from '@heroui/react';
import type { AntennaRose as Rose } from '../../core/kinds.ts';
import { EQUAL_DB, roseResult } from '../antennas.ts';
import { usePrefs } from '../usePrefs.ts';

const ANT1 = '#0ea5e9';
const ANT2 = '#f97316';
const CX = 120;
const CY = 112;
const R = 82;

// Per direction a wedge as long as the difference between the antennas, in the color of the weaker one.
export function AntennaRose({ rose }: { rose: Rose }) {
  const { t } = usePrefs();
  const n = rose.sectors.length;
  const most = Math.max(...rose.sectors.map((v) => Math.abs(v ?? 0)));
  const scale = Math.max(12, Math.ceil(most / 6) * 6); // dB at the outer ring
  const pt = (deg: number, r: number) => `${(CX + r * Math.sin((deg * Math.PI) / 180)).toFixed(1)},${(CY - r * Math.cos((deg * Math.PI) / 180)).toFixed(1)}`;
  const names = rose.basis === 'model' ? t.roseModel : t.roseCompass;
  const where = rose.basis === 'model' ? t.radioWhere : t.modelWhere;
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t.antennas}</Card.Title>
        <Card.Description>{rose.basis === 'model' ? t.antennasModel : t.antennasCompass}</Card.Description>
      </Card.Header>
      <Card.Content className="gap-3">
        <svg viewBox="0 0 240 222" className="mx-auto block w-full max-w-72" role="img" aria-label={roseResult(rose, t)}>
          <circle cx={CX} cy={CY} r={R} className="fill-surface-secondary stroke-muted" strokeOpacity={0.3} />
          <circle cx={CX} cy={CY} r={R / 2} fill="none" className="stroke-muted" strokeOpacity={0.3} />
          {/* ring labels at the lower right, away from the direction names */}
          {[scale / 2, scale].map((v) => {
            const [x, y] = pt(135, (v / scale) * R).split(',').map(Number);
            return (
              <text key={v} x={x! + 3} y={y! + 9} fontSize={9} className="fill-muted">
                {`${v} dB`}
              </text>
            );
          })}
          {rose.sectors.map((v, k) => {
            if (v === null) return null;
            const r = Math.max(2, (Math.min(scale, Math.abs(v)) / scale) * R);
            const a0 = (k - 0.5) * (360 / n);
            const a1 = (k + 0.5) * (360 / n);
            const weak = Math.abs(v) < EQUAL_DB;
            const db = Math.abs(v).toLocaleString(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return (
              <path
                key={k}
                d={`M${CX},${CY} L${pt(a0, r)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${pt(a1, r)} Z`}
                fill={weak ? undefined : v > 0 ? ANT2 : ANT1}
                className={weak ? 'fill-muted' : undefined}
                fillOpacity={weak ? 0.35 : 0.85}
              >
                <title>{t.antennaSector(where[k]!, v > 0 ? 2 : 1, db)}</title>
              </path>
            );
          })}
          {names.map((name, i) => (
            <text key={name} x={pt(i * 90, R + 14).split(',')[0]} y={Number(pt(i * 90, R + 14).split(',')[1]) + 4} fontSize={11} textAnchor="middle" className="fill-muted">
              {name}
            </text>
          ))}
          <text x={CX} y={CY + 15} fontSize={9} textAnchor="middle" className="fill-foreground" fontWeight={600}>
            {rose.basis === 'model' ? t.roseCenterModel : t.roseCenterCompass}
          </text>
          <circle cx={CX} cy={CY} r={3} className="fill-foreground" />
        </svg>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
          {[ANT1, ANT2].map((c, i) => (
            <span key={c} className="flex items-center gap-1.5">
              <i className="inline-block size-2.5 rounded-sm" style={{ background: c }} />
              {t.antennaWeaker(i + 1)}
            </span>
          ))}
        </div>
        <p className="m-0 text-sm">{roseResult(rose, t)}</p>
      </Card.Content>
    </Card>
  );
}
