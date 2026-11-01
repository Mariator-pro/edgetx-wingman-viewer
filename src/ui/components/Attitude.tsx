import { AmbientLight, COORDINATE_SYSTEM, Deck, DirectionalLight, LightingEffect, OrbitView } from '@deck.gl/core';
import { LineLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '../meshLayer.ts';
import { Button, Card, Dropdown } from '@heroui/react';
import { useEffect, useRef } from 'react';
import { AIRFRAMES, type Airframe } from '../../core/kinds.ts';
import type { TrackView } from '../../server/api.ts';
import { airframeMesh } from '../airframes.ts';
import { attitudeAt } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { CubeIcon, MinusIcon } from './icons.tsx';

// seen from the south and a little above, so the heading matches the map (north up)
const VIEW = { target: [0, 0, -0.25] as [number, number, number], rotationOrbit: 0, rotationX: 22, zoom: 6.25 };
const GROUND = -1.15;
// soft light all round, the sun from above behind the viewer
const LIGHT = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 0.75 }),
  sun: new DirectionalLight({ color: [255, 255, 255], intensity: 1.6, direction: [-0.4, 1, -2] }),
});
const GRID = Array.from({ length: 7 }, (_, i) => (i - 3) * 0.6).flatMap((v) => [
  { from: [v, -1.8, GROUND], to: [v, 1.8, GROUND] },
  { from: [-1.8, v, GROUND], to: [1.8, v, GROUND] },
]);

type Props = { track: TrackView; time: number; airframe?: Airframe; onAirframe: (a: Airframe | null) => void };

// Folds into a round button, so it leaves the map free; the app keeps the choice.
export function Attitude(props: Props) {
  const { t, attitudeShown, setAttitudeShown } = usePrefs();
  if (attitudeShown) return <AttitudeCard {...props} onHide={() => setAttitudeShown(false)} />;
  return (
    <Button isIconOnly variant="tertiary" className="rounded-full shadow-sm" aria-label={t.showAttitude} onPress={() => setAttitudeShown(true)}>
      <CubeIcon size={18} />
    </Button>
  );
}

// The model at the moment shown, with pitch, roll and yaw from the log; a menu chooses the kind of model.
function AttitudeCard(props: Props & { onHide: () => void }) {
  const { t } = usePrefs();
  const box = useRef<HTMLDivElement>(null);
  const deck = useRef<Deck<OrbitView> | null>(null);
  const kind = props.airframe ?? 'arrow';
  const att = attitudeAt(props.track, props.time);

  useEffect(() => {
    const parent = box.current;
    if (!parent) return;
    const d = new Deck<OrbitView>({
      parent,
      views: new OrbitView({ orbitAxis: 'Z', fovy: 30 }),
      initialViewState: VIEW,
      controller: false,
      effects: [LIGHT],
      style: { position: 'absolute', inset: '0' },
      useDevicePixels: true,
    });
    deck.current = d;
    return () => {
      d.finalize();
      deck.current = null;
    };
  }, []);

  useEffect(() => {
    const mesh = airframeMesh(kind);
    // deck.gl: pitch positive with the nose down, yaw counter-clockwise from east
    const orientation: [number, number, number] = att ? [-att.pitch, 90 - att.yaw, att.roll] : [0, 90, 0];
    const common = { coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, data: [0], getPosition: () => [0, 0, 0] as [number, number, number], getOrientation: () => orientation, updateTriggers: { getOrientation: orientation } };
    deck.current?.setProps({
      layers: [
        new LineLayer({ id: 'ground', data: GRID, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, getSourcePosition: (d) => d.from as [number, number, number], getTargetPosition: (d) => d.to as [number, number, number], getColor: [120, 120, 130, 70], getWidth: 1 }),
        new SimpleMeshLayer<number>({ ...common, id: `body-${kind}`, mesh: mesh.body, getColor: [255, 255, 255], parameters: { depthWriteEnabled: true, depthCompare: 'less-equal' } }),
        ...(mesh.props ? [new SimpleMeshLayer<number>({ ...common, id: `props-${kind}`, mesh: mesh.props, getColor: [255, 255, 255], opacity: 0.3, parameters: { depthWriteEnabled: false, depthCompare: 'less-equal' } })] : []),
      ],
    });
  }, [kind, att?.pitch, att?.roll, att?.yaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const names: Record<Airframe | 'arrow', string> = t.airframeNames;
  return (
    <Card className="w-60 gap-0 overflow-hidden p-0" aria-label={t.attitude}>
      <div className="flex items-center gap-1 px-3 pt-2">
        <span className="mr-auto text-xs font-semibold">{t.attitude}</span>
        <Dropdown>
          <Button size="sm" variant="ghost" className="h-6 min-w-0 px-2 text-xs" aria-label={t.airframe}>
            {names[kind]}
          </Button>
          <Dropdown.Popover placement="top end">
            <Dropdown.Menu
              selectionMode="single"
              selectedKeys={[kind]}
              onSelectionChange={(k) => {
                if (k === 'all' || k.size === 0) return;
                const v = [...k][0] as Airframe | 'arrow';
                props.onAirframe(v === 'arrow' ? null : v);
              }}
            >
              {[...AIRFRAMES, 'arrow' as const].map((a) => (
                <Dropdown.Item key={a} id={a} textValue={names[a]}>
                  {names[a]}
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button isIconOnly size="sm" variant="ghost" className="size-6 min-w-0" aria-label={t.hideAttitude} onPress={props.onHide}>
          <MinusIcon size={14} />
        </Button>
      </div>
      <div ref={box} className="relative h-40" />
      <div className="whitespace-nowrap px-3 pb-2 text-[11px] tabular-nums text-muted">
        {att ? t.attitudeValues(Math.round(att.pitch), Math.round(att.roll), Math.round(att.yaw)) : t.noTelemetry}
      </div>
    </Card>
  );
}
