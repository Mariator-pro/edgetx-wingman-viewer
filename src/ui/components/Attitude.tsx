import { AmbientLight, COORDINATE_SYSTEM, Deck, DirectionalLight, LightingEffect, OrbitView } from '@deck.gl/core';
import { LineLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '../meshLayer.ts';
import { Button, Card, Dropdown } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { AIRFRAMES, type Airframe } from '../../core/kinds.ts';
import type { TrackView } from '../../server/api.ts';
import { airframeMesh } from '../airframes.ts';
import { attitudeAt } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { CubeIcon, MinusIcon } from './icons.tsx';

// seen from the south and a little above, so the heading matches the map (north up)
const VIEW = { target: [0, 0, -0.25] as [number, number, number], rotationOrbit: 0, rotationX: 22, zoom: 5.7 };
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

// Folds into a round button, so it leaves the map free; the app keeps the choice. On a narrow map it starts folded
// whatever the choice, and opening it there holds only while the flight is shown.
export function Attitude(props: Props & { narrow: boolean }) {
  const { t, attitudeShown, setAttitudeShown } = usePrefs();
  const [opened, setOpened] = useState(false);
  const shown = props.narrow ? opened : attitudeShown;
  const show = (on: boolean) => (props.narrow ? setOpened(on) : setAttitudeShown(on));
  if (shown) return <AttitudeCard {...props} onHide={() => show(false)} />;
  return (
    <Button isIconOnly variant="tertiary" className="rounded-full shadow-sm" aria-label={t.showAttitude} onPress={() => show(true)}>
      <CubeIcon size={18} />
    </Button>
  );
}

// The model at the moment shown, with pitch, roll and yaw from the log; a menu chooses the kind of model.
function AttitudeCard(props: Props & { onHide: () => void }) {
  const { t, theme } = usePrefs();
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
    const mesh = airframeMesh(kind, theme);
    // deck.gl: pitch positive with the nose down, yaw counter-clockwise from east
    const orientation: [number, number, number] = att ? [-att.pitch, 90 - att.yaw, att.roll] : [0, 90, 0];
    const common = { coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, data: [0], getPosition: () => [0, 0, 0] as [number, number, number], getOrientation: () => orientation, updateTriggers: { getOrientation: orientation } };
    deck.current?.setProps({
      layers: [
        new LineLayer({ id: 'ground', data: GRID, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, getSourcePosition: (d) => d.from as [number, number, number], getTargetPosition: (d) => d.to as [number, number, number], getColor: [120, 120, 130, 70], getWidth: 1 }),
        new SimpleMeshLayer<number>({ ...common, id: `body-${kind}-${theme}`, mesh: mesh.body, getColor: [255, 255, 255], parameters: { depthWriteEnabled: true, depthCompare: 'less-equal' } }),
        ...(mesh.props ? [new SimpleMeshLayer<number>({ ...common, id: `props-${kind}-${theme}`, mesh: mesh.props, getColor: [255, 255, 255], opacity: 0.3, parameters: { depthWriteEnabled: false, depthCompare: 'less-equal' } })] : []),
      ],
    });
  }, [kind, theme, att?.pitch, att?.roll, att?.yaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const names: Record<Airframe | 'arrow', string> = t.airframeNames;
  return (
    <Card className="w-40 gap-0 overflow-hidden p-0" aria-label={t.attitude}>
      <div className="flex items-center justify-between gap-1 px-2 pt-1.5">
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
      <div ref={box} className="relative h-28" />
      {att ? (
        <dl className="m-0 grid grid-cols-3 px-2 pb-2 text-center">
          {[att.pitch, att.roll, att.yaw].map((v, i) => (
            <div key={i}>
              <dt className="text-[10px] text-muted">{t.attitudeNames[i]}</dt>
              <dd className="m-0 text-xs font-semibold tabular-nums">{Math.round(v)}°</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 px-2 pb-2 text-center text-[11px] text-muted">{t.noTelemetry}</p>
      )}
    </Card>
  );
}
