import type { PickingInfo } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, LineLayer, PathLayer } from '@deck.gl/layers';
import { AttributionControl, Map as MapLibre, setWorkerUrl, type IControl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PathPoint } from '../../core/kinds.ts';
import type { MapSettingsView, TrackView } from '../../server/api.ts';
import { flownAt, nearestPoint, positionAt, type Coloring } from '../track.ts';

// MapLibre's worker is a file of its own, built with the page and loaded from the app itself
setWorkerUrl(workerUrl);

export type View = '2d' | '3d';
export type Base = 'street' | 'satellite';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const ESRI_ATTR = 'Powered by <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> | Esri, Vantor, Earthstar Geographics, and the GIS User Community';
const esriTiles = (key: string) =>
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(key)}`;

const FUTURE_ALPHA = 64; // the part still to come: the same colors, pale
const STEM: [number, number, number, number] = [90, 100, 97, 90];
const MAX_STEMS = 400;
// room for the controls on the map: legend at the top left, timeline at the bottom, the attitude view at the right
const fit = (roomRight: boolean) => ({ padding: { top: 150, bottom: 130, left: 60, right: roomRight ? 200 : 80 }, maxZoom: 18 });
const camera = (view: View) => (view === '3d' ? { pitch: 60, bearing: -20 } : { pitch: 0, bearing: 0 });
const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800);

// The model symbol (an outlined arrow pointing north), the start (a ring) and the end (a square), drawn once,
// so no image has to be loaded.
function iconAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  g.strokeStyle = '#17201e';
  g.fillStyle = '#ffffff';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(32, 5);
  g.lineTo(55, 58);
  g.lineTo(32, 45);
  g.lineTo(9, 58);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(96, 32, 20, 0, 2 * Math.PI);
  g.fill();
  g.lineWidth = 9;
  g.stroke();
  g.fillStyle = '#17201e';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.fillRect(142, 12, 40, 40);
  g.strokeRect(142, 12, 40, 40);
  return c;
}
const ICONS = {
  arrow: { x: 0, y: 0, width: 64, height: 64, anchorY: 32 },
  start: { x: 64, y: 0, width: 64, height: 64, anchorY: 32 },
  end: { x: 128, y: 0, width: 64, height: 64, anchorY: 32 },
};

function style(settings: MapSettingsView): StyleSpecification {
  return {
    version: 8,
    sources: {
      street: { type: 'raster', tiles: [settings.tiles], tileSize: 256, maxzoom: 19, attribution: OSM_ATTR },
      ...(settings.arcgisKey
        ? { satellite: { type: 'raster' as const, tiles: [esriTiles(settings.arcgisKey)], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTR } }
        : {}),
    },
    layers: [
      { id: 'street', type: 'raster', source: 'street' },
      ...(settings.arcgisKey ? [{ id: 'satellite', type: 'raster' as const, source: 'satellite', layout: { visibility: 'none' as const } }] : []),
    ],
  };
}

function bounds(tr: TrackView): [[number, number], [number, number]] | undefined {
  const pts = tr.path.flat();
  if (pts.length === 0) return undefined;
  const lons = pts.map((p) => p[1]);
  const lats = pts.map((p) => p[2]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function FlightMap(props: {
  track: TrackView;
  time: number;
  view: View;
  base: Base;
  colors: Coloring;
  settings: MapSettingsView;
  label: string;
  onSatelliteError: () => void;
  onMap: (m: MapLibre | null) => void; // for the zoom buttons
  roomRight: boolean; // the attitude view covers the lower right
  wholeFlight: number; // counts the presses of "Show whole flight"
  follow?: number; // the time whose model the map keeps in the middle; undefined: the map stays
  onFollowOff: () => void; // the map was moved by hand
  onPoint: (t: number | undefined) => void; // pointing at the path: the time there, undefined when off it
  onPick: (t: number) => void; // a click on the path
  describe: (p: PathPoint) => string; // the tooltip at the path, e.g. "+1:31 · 84 m"
}) {
  const { track, time, view, base, colors, settings, label, onSatelliteError, onMap } = props;
  const roomRight = useRef(props.roomRight);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre>(null);
  const overlay = useRef<MapboxOverlay>(null);
  const onError = useRef(onSatelliteError);
  const onMapRef = useRef(onMap);
  const onFollowOff = useRef(props.onFollowOff);
  useEffect(() => {
    onError.current = onSatelliteError;
    onMapRef.current = onMap;
    roomRight.current = props.roomRight;
    onFollowOff.current = props.onFollowOff;
  });
  const atlas = useMemo(() => iconAtlas(), []);
  const [tip, setTip] = useState<{ x: number; y: number; text: string }>();
  // the point of the path under the pointer: deck.gl finds the segment, the nearest of its points gives the time
  const pointAt = (info: PickingInfo): PathPoint | undefined => {
    const seg = info.layer?.id === 'future' ? (info.object as PathPoint[] | undefined) : undefined;
    const vp = info.viewport;
    if (!seg || !vp) return undefined;
    return nearestPoint(seg, (p) => vp.project([p[1], p[2], view === '3d' ? p[3] : 0]) as [number, number], info.x, info.y);
  };
  const pointing = useRef(false);
  const onHover = (info: PickingInfo) => {
    const p = pointAt(info);
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = p ? 'pointer' : '';
    setTip(p ? { x: info.x, y: info.y, text: props.describe(p) } : undefined);
    if (p || pointing.current) props.onPoint(p?.[0]);
    pointing.current = !!p;
  };
  const onClick = (info: PickingInfo) => {
    const p = pointAt(info);
    if (p) props.onPick(p[0]);
  };
  const handlers = useRef({ onHover, onClick });
  useEffect(() => {
    handlers.current = { onHover, onClick };
  });

  useEffect(() => {
    const b = bounds(track);
    const m = new MapLibre({
      container: box.current!,
      style: style(settings),
      ...(b ? { bounds: b, fitBoundsOptions: fit(roomRight.current) } : { center: [0, 0], zoom: 1 }),
      maxPitch: 80,
      attributionControl: false,
    });
    m.addControl(new AttributionControl({ compact: false }), 'bottom-right');
    const o = new MapboxOverlay({
      interleaved: false,
      layers: [],
      pickingRadius: 6, // the path is only 4 px wide
      onHover: (info) => handlers.current.onHover(info),
      onClick: (info) => handlers.current.onClick(info),
    });
    m.addControl(o as unknown as IControl);
    // the box has its final size only once the page is laid out
    m.once('load', () => {
      m.resize();
      if (b) m.fitBounds(b, { ...fit(roomRight.current), duration: 0 });
    });
    // moving the map by hand ends following, so the map doesn't pull against the hand
    m.on('dragstart', () => onFollowOff.current());
    let refused = false;
    m.on('error', (e) => {
      if ((e as { sourceId?: string }).sourceId === 'satellite' && !refused) {
        refused = true;
        onError.current();
      }
    });
    map.current = m;
    overlay.current = o;
    onMapRef.current(m);
    return () => {
      onMapRef.current(null);
      m.remove();
      map.current = null;
      overlay.current = null;
    };
  }, [track, settings]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.easeTo({ ...camera(view), duration: motion() });
  }, [view, track, settings]);

  // back to the whole path, seen as the chosen view shows it
  useEffect(() => {
    const m = map.current;
    const b = bounds(track);
    if (m && b && props.wholeFlight > 0) m.fitBounds(b, { ...fit(roomRight.current), ...camera(view), duration: motion() });
  }, [props.wholeFlight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      if (!m.getLayer('satellite')) return;
      const sat = base === 'satellite';
      m.setLayoutProperty('satellite', 'visibility', sat ? 'visible' : 'none');
      m.setLayoutProperty('street', 'visibility', sat ? 'none' : 'visible');
    };
    if (m.isStyleLoaded()) apply();
    else m.once('load', apply);
  }, [base, track, settings]);

  // following: the model stays in the middle, zoom, tilt and turn as they are
  useEffect(() => {
    const m = map.current;
    if (!m || props.follow === undefined) return;
    const p = positionAt(track, props.follow);
    if (p) m.jumpTo({ center: [p[1], p[2]] });
  }, [props.follow, track]);

  // stems from the ground to the path in 3D, at the fixes, at most a few hundred
  const stems = useMemo(() => {
    const pts = track.path.flat();
    const every = Math.max(1, Math.ceil(pts.length / MAX_STEMS));
    return pts.filter((_, i) => i % every === 0);
  }, [track]);

  useEffect(() => {
    const o = overlay.current;
    if (!o) return;
    const up = view === '3d';
    const z = (p: PathPoint) => (up ? p[3] : 0);
    const pos = (p: PathPoint): [number, number, number] => [p[1], p[2], z(p)];
    const model = positionAt(track, time);
    const first = track.path[0]?.[0];
    const lastSeg = track.path[track.path.length - 1];
    const last = lastSeg?.[lastSeg.length - 1];
    const ends = [
      ...(track.home ? [{ p: [track.home[0], track.home[1], 0] as [number, number, number], icon: 'start' }] : []),
      ...(last && first ? [{ p: pos(last), icon: 'end' }] : []),
    ];
    const atlasProp = atlas as unknown as string; // deck.gl takes a canvas as well, its types only name URLs and textures
    o.setProps({
      layers: [
        ...(up
          ? [
              new LineLayer<PathPoint>({
                id: 'stems',
                data: stems,
                getSourcePosition: (p) => [p[1], p[2], 0],
                getTargetPosition: pos,
                getColor: STEM,
                getWidth: 1,
                updateTriggers: { getTargetPosition: [up] },
              }),
            ]
          : []),
        new PathLayer<PathPoint[]>({
          id: 'future',
          data: track.path,
          pickable: true,
          getPath: (seg) => seg.map(pos),
          getColor: (seg) => seg.map((p): [number, number, number, number] => [...colors.row(p[5]), FUTURE_ALPHA]),
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getPath: [up], getColor: [colors] },
        }),
        new PathLayer<PathPoint[]>({
          id: 'flown',
          data: flownAt(track, time),
          getPath: (seg) => seg.map(pos),
          getColor: (seg) => seg.map((p) => colors.row(p[5])),
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getPath: [up, time], getColor: [colors, time] },
        }),
        new IconLayer<(typeof ends)[number]>({
          id: 'ends',
          data: ends,
          iconAtlas: atlasProp,
          iconMapping: ICONS,
          getIcon: (d) => d.icon,
          getPosition: (d) => d.p,
          getSize: 16,
          sizeUnits: 'pixels',
          updateTriggers: { getPosition: [up] },
        }),
        ...(model
          ? [
              new IconLayer<PathPoint>({
                id: 'model',
                data: [model],
                iconAtlas: atlasProp,
                iconMapping: ICONS,
                getIcon: () => 'arrow',
                getPosition: pos,
                getAngle: (p) => -p[4],
                getSize: 30,
                sizeUnits: 'pixels',
                billboard: false,
                updateTriggers: { getPosition: [up, time], getAngle: [time] },
              }),
            ]
          : []),
      ],
    });
  }, [track, settings, time, view, colors, stems, atlas]);

  return (
    <div className="relative h-full min-h-[360px] w-full">
      <div ref={box} role="region" aria-label={label} className="h-full w-full" />
      {tip && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface px-2 py-1 text-xs font-medium tabular-nums shadow-md ring-1 ring-separator"
          style={{ left: tip.x, top: tip.y - 36 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
