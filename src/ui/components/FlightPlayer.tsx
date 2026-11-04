import { Alert, Button, ButtonGroup, Card, Chip, Disclosure, Dropdown, ListBox, Select, Slider, Tabs, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import type { Map as MapLibre } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Airframe, TrackValue } from '../../core/kinds.ts';
import { ROLES } from '../../core/roles.ts';
import type { MapSettingsView, TrackView } from '../../server/api.ts';
import { get, post } from '../api.ts';
import { distance, fromTakeoff } from '../format.ts';
import { formatValue, paint, PAIRS, PRESET, seriesOf } from '../series.ts';
import { byLevel, colorChoices, coloring, levelsOf, rgbCss, rowAt, summaryOf, type ColorBy } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { useWidthOf } from '../useWidth.ts';
import { AntennaRose } from './AntennaRose.tsx';
import { Attitude } from './Attitude.tsx';
import { Charts, ChartTools, type Marks, type Range } from './Charts.tsx';
import { FlightMap, type Base, type View } from './FlightMap.tsx';
import { Scatter } from './Scatter.tsx';
import { Sticks } from './Sticks.tsx';
import { FitIcon, FollowIcon, LayersIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon } from './icons.tsx';
import { eventTone, HINT_TONE } from '../marks.ts';
import { BADGE } from './badge.ts';
import { MarkRow } from './TimelineMark.tsx';

// Warning levels and pack number of the cores: shown as colors, hints and the pack, not as bare numbers.
const CORE_SENSORS = new Set<string>([...ROLES.lnst, ...ROLES.lnpk, ...ROLES.lsst, ...ROLES.ghst]);

const SPEEDS = [1, 2, 5, 10, 30];
// The values bar in groups, by what the app knows of a value; a list of names is another sensor of the log. The rest
// of the log follows folded.
type GroupItem = TrackValue | 'fm' | readonly string[];
const GROUPS: { id: 'flight' | 'battery' | 'link'; items: GroupItem[] }[] = [
  { id: 'flight', items: ['fm', 'alt', 'vspd', 'gspd', 'dist', 'hdg', 'sats'] },
  { id: 'battery', items: ['volt', 'curr', 'capa', 'fuel'] },
  { id: 'link', items: ['lq', 'rssi1', 'rssi2', ROLES.snr, ROLES.ant, ROLES.rfmd, ROLES.tpwr] },
];
const IN_GROUPS = new Set(GROUPS.flatMap((g) => g.items.filter((i): i is readonly string[] => Array.isArray(i)).flat()));
// shown by the attitude view, so not in the values bar when there is one (the charts keep them)
const ATTITUDE_SENSORS = new Set<string>([...ROLES.pitch, ...ROLES.roll, ...ROLES.yaw]);
// the link as the radio receives it: rarely needed while looking at a flight, so only in the charts
const AT_RADIO = new Set(['TRSS', 'TQly', 'TSNR']);
const UNIT_SHOWN: Record<string, string> = { kmh: 'km/h', mps: 'm/s', fps: 'ft/s' };
const DIGITS: Partial<Record<TrackValue, number>> = { volt: 2, curr: 1, vspd: 1, gspd: 1 };
const NARROW_MAP = 800; // px
const HINT_ZOOM_S = 30; // a hint picked in the list: the charts show this much before and after it

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// Typing in a field, or a control that takes the key itself (the space bar on a button, arrows in tabs, menus or
// on the map): the Viewer's keys don't act there. The timeline's own slider gives its keys to the Viewer.
function ownsKey(el: EventTarget | null, space: boolean): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-flight-slider]')) return false;
  if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  if (space && el.tagName === 'BUTTON') return true;
  return !!el.closest('[role="menu"],[role="listbox"],[role="dialog"],[role="tablist"],[role="radiogroup"],[role="toolbar"],[role="grid"],.maplibregl-map');
}

export function FlightPlayer({ flightKey }: { flightKey: string }) {
  const { t, sticks, attitudeShown, moreShown, setMoreShown } = usePrefs();
  const [loaded, setTrack] = useState<TrackView>();
  const [hover, setHover] = useState<number>();
  const [range, setRange] = useState<Range>();
  const [chosen, setChosen] = useState<string[]>(PRESET);
  // each value in the charts keeps its color while it is shown; one just taken away keeps it while its strip closes
  const [stripColors, setStripColors] = useState(() => paint({}, PRESET));
  const [painted, setPainted] = useState(chosen);
  if (painted !== chosen) {
    setPainted(chosen);
    setStripColors(paint(stripColors, [...chosen, ...painted.filter((id) => !chosen.includes(id))]));
  }
  const toggleChart = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const [pair, setPair] = useState<[string, string]>(PAIRS[0]!);
  // the tabs keep the tallest height seen, so the page doesn't jump when switching tabs
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('charts');
  const [measure, setMeasure] = useState(false);
  const [marks, setMarks] = useState<Marks>({});
  const [tabsHeight, setTabsHeight] = useState(0);
  const keepTabsHeight = () => setTabsHeight((h) => Math.max(h, tabsRef.current?.offsetHeight ?? 0));
  const [settings, setSettings] = useState<MapSettingsView>();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [view, setView] = useState<View>('2d');
  const [base, setBase] = useState<Base>('street');
  const [colorBy, setColorBy] = useState<ColorBy>('fm');
  const [satError, setSatError] = useState(false);
  const [wholeFlight, setWholeFlight] = useState(0);
  const [follow, setFollow] = useState(false); // the map keeps the model in the middle
  const [airframe, setAirframe] = useState<Airframe>();
  const clockRef = useRef({ time: 0, last: 0 });
  // on a narrow map the attitude view starts folded, so it doesn't cover the path
  const [mapBox, mapWidth] = useWidthOf<HTMLDivElement>();
  const narrowMap = mapWidth > 0 && mapWidth < NARROW_MAP;
  const mapRef = useRef<MapLibre | null>(null);
  const track = loaded?.key === flightKey ? loaded : undefined;

  useEffect(() => {
    let gone = false;
    get<TrackView>(`/api/flight/track?key=${encodeURIComponent(flightKey)}`).then(
      (tr) => {
        if (gone) return;
        setPlaying(false);
        setTrack(tr);
        setAirframe(tr.airframe);
        // opens at takeoff: Play plays the flight at once, the values show a moment that says something
        clockRef.current.time = tr.takeoff;
        setTime(tr.takeoff);
        setHover(undefined);
        setRange(undefined);
        setTabsHeight(0);
        setMarks({});
        const choices = colorChoices(tr);
        setColorBy((c) => (choices.includes(c) ? c : (choices[0] ?? 'alt')));
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [flightKey]);
  useEffect(() => {
    get<MapSettingsView>('/api/map').then(setSettings, () => {});
  }, []);

  // playback: the clock runs in real time times the speed, until the end of the flight
  useEffect(() => {
    if (!playing || !track) return;
    let frame = 0;
    clockRef.current.last = 0;
    const tick = (now: number) => {
      const c = clockRef.current;
      const dt = c.last ? (now - c.last) / 1000 : 0;
      c.last = now;
      c.time = Math.min(track.duration, c.time + dt * speed);
      setTime(c.time);
      if (c.time >= track.duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, track]);

  const seek = (s: number) => {
    clockRef.current.time = s;
    setTime(s);
  };
  const toggle = () => {
    if (!track) return;
    if (!playing && time >= track.duration) seek(track.takeoff);
    else clockRef.current.time = time;
    setPlaying((p) => !p);
  };
  // the Viewer's keys: space plays and pauses, arrows step 1 s (with Shift 10 s), Home and End go to start and end,
  // N and P to the next or previous event or hint
  const key = (e: KeyboardEvent) => {
    if (!track || e.metaKey || e.ctrlKey || e.altKey) return;
    const space = e.code === 'Space';
    if (ownsKey(e.target, space)) return;
    const to = (s: number) => seek(Math.min(track.duration, Math.max(0, s)));
    const marks = [...track.events.map((m) => m.t), ...track.hints.map((m) => m.t)].sort((a, b) => a - b);
    const k = e.key.toLowerCase();
    if (space) {
      if (!e.repeat) toggle();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') to(time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(track.duration);
    else if (k === 'n' && !e.shiftKey) {
      const next = marks.find((m) => m > time + 0.05);
      if (next !== undefined) to(next);
    } else if (k === 'p' && !e.shiftKey) {
      const prev = marks.findLast((m) => m < time - 0.05);
      if (prev !== undefined) to(prev);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    // before the slider, which would step 0.1 s itself
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const unit = (k: TrackValue) => {
    const u = track?.units[k];
    return u ? (UNIT_SHOWN[u] ?? u) : '';
  };
  const format = (v: number, k: TrackValue) => {
    if (k === 'dist') return distance(v, t.locale);
    const n = v.toLocaleString(t.locale, { maximumFractionDigits: DIGITS[k] ?? 0, minimumFractionDigits: DIGITS[k] ?? 0 });
    const u = unit(k);
    return u === '°' || u === '%' ? `${n}${u === '%' ? ' %' : u}` : `${n} ${u}`.trim();
  };
  const colors = useMemo(() => (track ? coloring(track, colorBy) : undefined), [track, colorBy]);

  if (!track || !colors) return <div className="h-[clamp(520px,calc(100vh_-_280px),820px)] animate-pulse rounded-3xl bg-surface-secondary" />;

  const hasPath = track.path.length > 0;
  // over a chart, map and values follow the mouse
  const shownTime = hover ?? time;
  const row = rowAt(track, shownTime);
  const series = seriesOf(track, t);
  const extra = series.filter((s) => s.id.startsWith('log:') && !CORE_SENSORS.has(s.name));
  const up = track.rows.fm?.[row] != null || Object.values(track.rows.values).some((col) => col?.[row] != null);
  type Line = { k: string; name: string; label: string; value: string };
  const lineOf = (item: GroupItem): Line[] => {
    if (Array.isArray(item)) {
      const s = extra.find((e) => item.includes(e.name));
      if (!s) return [];
      const v = s.values[row];
      return [{ k: s.id, name: s.name, label: s.label, value: v != null ? formatValue(s, v, t.locale) : '–' }];
    }
    if (item === 'fm') {
      if (!track.rows.fm) return [];
      const m = track.rows.fm[row];
      return [{ k: item, name: track.names.fm ?? 'FM', label: t.valueNames.fm, value: m != null ? track.modes[m]! : '–' }];
    }
    const k = item as TrackValue;
    const col = track.rows.values[k];
    if (!col) return [];
    const v = col[row];
    // with two antennas their signals are named after them
    const label = k === 'volt' ? t.voltage : k === 'rssi1' && track.rows.values.rssi2 ? t.antenna(1) : k === 'rssi2' ? t.antenna(2) : t.valueNames[k];
    return [{ k, name: track.names[k] ?? k, label, value: v != null ? format(v, k) : '–' }];
  };
  const groups = GROUPS.map((g) => ({ id: g.id, lines: g.items.flatMap(lineOf) })).filter((g) => g.lines.length > 0);
  const more = extra.filter((e) => !IN_GROUPS.has(e.name) && !(track.attitude && ATTITUDE_SENSORS.has(e.name)) && !AT_RADIO.has(e.name)).map((e): Line => {
    const v = e.values[row];
    return { k: e.id, name: e.name, label: e.label, value: v != null ? formatValue(e, v, t.locale) : '–' };
  });
  const choices = colorChoices(track);
  const summary = summaryOf(track);
  const chartable = new Set(series.map((s) => s.id));
  // the value the path is colored by, in a log line: flight mode, warning level or the number with its unit
  const levels = byLevel(colorBy) ? levelsOf(track, colorBy) : undefined;
  const colorValue = (r: number): string | undefined => {
    if (colorBy === 'fm') {
      const m = track.rows.fm?.[r];
      return m != null ? track.modes[m] : undefined;
    }
    if (levels) {
      const v = levels[r];
      return v != null ? t.stageNames[Math.min(2, Math.max(0, Math.round(v)))] : undefined;
    }
    const v = track.rows.values[colorBy as TrackValue]?.[r];
    return v != null ? format(v, colorBy as TrackValue) : undefined;
  };
  const tick = (v: number) => v.toLocaleString(t.locale, { maximumFractionDigits: DIGITS[colorBy as TrackValue] ?? 0 });
  const scaleUnit = colorBy === 'fm' || byLevel(colorBy) ? '' : unit(colorBy as TrackValue);
  // a hint picked: jump there and zoom the charts around it
  const pickHint = (s: number) => {
    seek(s);
    setRange([Math.max(0, s - HINT_ZOOM_S), Math.min(track.duration, s + HINT_ZOOM_S)]);
  };

  return (
    <div className="flex flex-col gap-6">
      {track.hints.length > 0 && (
        // the hints first, without scrolling; over one, map and values show its moment
        <Alert status="warning" className="items-center">
          <Alert.Indicator />
          <Alert.Content className="flex-row flex-wrap items-center gap-1.5">
            <Alert.Title className="sr-only">{t.hintCount(track.hints.length)}</Alert.Title>
            {track.hints.map((h) => (
              <Button
                key={`${h.t}${h.kind}`}
                size="sm"
                variant="tertiary"
                className={`${BADGE} gap-1.5`}
                aria-label={t.jumpTo(t.hintNames[h.kind], fromTakeoff(h.t, track.takeoff))}
                onPress={() => pickHint(h.t)}
                onHoverStart={() => setHover(h.t)}
                onHoverEnd={() => setHover(undefined)}
              >
                <span className="font-mono tabular-nums text-muted">{fromTakeoff(h.t, track.takeoff)}</span>
                {t.hintNames[h.kind]}
              </Button>
            ))}
          </Alert.Content>
        </Alert>
      )}
      <div className="flex flex-wrap gap-4">
        {/* map and values grow with the window, so the top of the charts stays in view */}
        <Card ref={mapBox} className="relative h-[clamp(520px,calc(100vh_-_280px),820px)] min-w-0 flex-[999_1_520px] overflow-hidden p-0">
          <div className="contents">
            {hasPath && settings ? (
              <FlightMap
                track={track}
                time={shownTime}
                view={view}
                base={base}
                colors={colors}
                settings={settings}
                label={t.map}
                onSatelliteError={() => setSatError(true)}
                onMap={(m) => (mapRef.current = m)}
                roomRight={!!track.attitude && attitudeShown && !narrowMap}
                wholeFlight={wholeFlight}
                follow={follow ? time : undefined}
                onFollowOff={() => setFollow(false)}
                onPoint={setHover}
                onPick={seek}
                describe={(p) => [fromTakeoff(p[0], track.takeoff), colorValue(p[5])].filter(Boolean).join(' · ')}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 pb-32">
                {hasPath ? null : (
                  <Alert status="default" className="max-w-md">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{t.noGps}</Alert.Title>
                      <Alert.Description>{t.noGpsText}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
              </div>
            )}
            {hasPath && (
              <>
                <div className="absolute left-4 top-4 z-10 flex flex-col items-start gap-3">
                  <div className="flex items-center gap-2">
                    <ToggleButtonGroup
                      aria-label={t.mapView}
                      selectionMode="single"
                      disallowEmptySelection
                      selectedKeys={[view]}
                      onSelectionChange={(k) => setView(([...k][0] as View) ?? '2d')}
                      className="map-control shadow-sm"
                    >
                      <ToggleButton id="2d">{t.view2d}</ToggleButton>
                      <ToggleButton id="3d">{t.view3d}</ToggleButton>
                    </ToggleButtonGroup>
                    {choices.length > 0 && (
                      <Select aria-label={t.colorBy} selectedKey={colorBy} onSelectionChange={(k) => k !== null && setColorBy(k as ColorBy)}>
                        <Select.Trigger className="shadow-sm">
                          <span className="mr-1 text-muted">{t.colorBy}</span>
                          <Select.Value className="font-semibold" />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {choices.map((c) => (
                              <ListBox.Item key={c} id={c} textValue={t.colorNames[c]}>
                                {t.colorNames[c]}
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    )}
                  </div>
                  {/* one slim row under "Color by", so the path stays free */}
                  <Card className="max-w-md flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    {colors.scale && (
                      <span className="flex items-center gap-1.5 tabular-nums text-muted">
                        {tick(colors.scale.ticks[0]!)}
                        <i className="inline-block h-2 w-24 rounded-full" style={{ background: colors.scale.css }} />
                        {`${tick(colors.scale.ticks.at(-1)!)} ${scaleUnit}`.trim()}
                      </span>
                    )}
                    {(colors.levels?.map((c, i) => ({ label: t.stageNames[i]!, color: c })) ?? colors.modes ?? []).map((l) => (
                      <span key={l.label} className="flex items-center gap-1.5">
                        <i className="inline-block h-1 w-4 rounded" style={{ background: rgbCss(l.color) }} />
                        {l.label}
                      </span>
                    ))}
                    <span className="flex items-center gap-1.5">
                      <i className="inline-block size-2.5 rounded-full border-2 border-foreground" />
                      {t.markStart}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="inline-block size-2.5 bg-foreground" />
                      {t.markEnd}
                    </span>
                    {base === 'satellite' && satError && <p className="m-0 w-full text-danger">{t.satelliteRefused}</p>}
                  </Card>
                </div>
                <ButtonGroup orientation="vertical" variant="tertiary" className="map-control absolute right-4 top-4 z-10 shadow-sm">
                  <Button isIconOnly aria-label={t.zoomIn} onPress={() => mapRef.current?.zoomIn()}>
                    <PlusIcon size={16} />
                  </Button>
                  <Button isIconOnly aria-label={t.zoomOut} onPress={() => mapRef.current?.zoomOut()}>
                    <MinusIcon size={16} />
                  </Button>
                  <Button
                    isIconOnly
                    aria-label={t.wholeFlight}
                    onPress={() => {
                      setFollow(false);
                      setWholeFlight((n) => n + 1);
                    }}
                  >
                    <FitIcon size={16} />
                  </Button>
                  {/* square like the buttons around it; the group only squares its own buttons */}
                  <ToggleButton isIconOnly className="rounded-none" aria-label={t.follow} isSelected={follow} onChange={setFollow}>
                    <FollowIcon size={16} />
                  </ToggleButton>
                  <Dropdown>
                    <Button isIconOnly variant="tertiary" aria-label={t.baseMap}>
                      <LayersIcon size={16} />
                    </Button>
                    <Dropdown.Popover placement="left top">
                      <Dropdown.Menu
                        selectionMode="single"
                        selectedKeys={[base]}
                        disabledKeys={settings?.arcgisKey ? [] : ['satellite']}
                        onSelectionChange={(k) => k !== 'all' && k.size > 0 && setBase([...k][0] as Base)}
                      >
                        <Dropdown.Item id="street" textValue={t.streetMap}>
                          {t.streetMap}
                          <Dropdown.ItemIndicator />
                        </Dropdown.Item>
                        <Dropdown.Item id="satellite" textValue={t.satellite}>
                          <div className="flex flex-col">
                            <span>{t.satellite}</span>
                            {!settings?.arcgisKey && <span className="max-w-56 text-xs text-muted">{t.satelliteNeedsKey}</span>}
                          </div>
                          <Dropdown.ItemIndicator />
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                </ButtonGroup>
              </>
            )}
            {track.attitude && (
              <div className="absolute bottom-[124px] right-4 z-10">
                <Attitude
                  narrow={narrowMap}
                  track={track}
                  time={shownTime}
                  airframe={airframe}
                  onAirframe={(a) => {
                    setAirframe(a ?? undefined);
                    post('/api/flight/airframe', { key: flightKey, airframe: a }).catch(() => {});
                  }}
                />
              </div>
            )}
            {/* z-10: above the canvas of the flight path, which the map lays over its own */}
            <Card className="absolute inset-x-4 bottom-8 z-10 flex-row items-center gap-4 px-4 py-3">
              <div className="flex shrink-0 items-center gap-2">
                <Tooltip delay={600}>
                  <Button isIconOnly size="lg" className="rounded-full" aria-label={playing ? t.pause : t.play} onPress={toggle}>
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </Button>
                  <Tooltip.Content placement="top">
                    <dl className="m-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
                      {t.keys(MAC).map(([k, what]) => (
                        <div key={k} className="contents">
                          <dt className="whitespace-nowrap font-mono text-muted">{k}</dt>
                          <dd className="m-0">{what}</dd>
                        </div>
                      ))}
                    </dl>
                  </Tooltip.Content>
                </Tooltip>
                <Select
                  aria-label={t.speed}
                  variant="secondary"
                  className="w-20 shrink-0"
                  selectedKey={String(speed)}
                  onSelectionChange={(k) => k !== null && setSpeed(Number(k))}
                >
                  <Select.Trigger className="rounded-full">
                    <Select.Value className="tabular-nums" />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover placement="top">
                    <ListBox>
                      {SPEEDS.map((v) => (
                        <ListBox.Item key={v} id={String(v)} textValue={`${v}×`}>
                          {v}×
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <span className="whitespace-nowrap text-sm tabular-nums">
                <span className="font-semibold">{fromTakeoff(time, track.takeoff)}</span>
                <span className="text-muted"> / {fromTakeoff(track.duration, track.takeoff)}</span>
              </span>
              <div className="relative min-w-0 flex-1 pt-4" data-flight-slider>
                {/* inset like the slider's own track (room for the thumb at both ends), so a mark sits where the thumb goes */}
                <MarkRow
                  className="absolute inset-x-3 top-0 h-4"
                  marks={[
                    ...track.events.map((e) => ({ t: e.t, name: t.eventNames[e.kind], tone: eventTone(e.kind), hint: false })),
                    ...track.hints.map((h) => ({ t: h.t, name: t.hintNames[h.kind], tone: HINT_TONE, hint: true })),
                  ]}
                  at={(s) => s / (track.duration || 1)}
                  takeoff={track.takeoff}
                  onPick={seek}
                />
                <Slider aria-label={t.flightTime} minValue={0} maxValue={track.duration} step={0.1} value={time} onChange={(v: number | number[]) => seek(Array.isArray(v) ? v[0]! : v)}>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </div>
            </Card>
          </div>
        </Card>
        {/* as high as the map; the values scroll, the sticks stay at the bottom */}
        <Card className="h-[clamp(520px,calc(100vh_-_280px),820px)] flex-[1_1_260px] gap-3 p-4" aria-label={t.values}>
          <Card.Header className="flex-row items-baseline justify-between">
            <Card.Title>{t.values}</Card.Title>
            <span className="text-xs tabular-nums text-muted">{t.atTime(fromTakeoff(shownTime, track.takeoff))}</span>
          </Card.Header>
          <Card.Content className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <section key={g.id} aria-label={t.valueGroups[g.id]}>
                  <h3 className="m-0 mb-1 text-xs font-medium text-muted">{t.valueGroups[g.id]}</h3>
                  <ValueLines lines={g.lines} charts={chartable} colors={stripColors} chosen={chosen} onToggle={toggleChart} />
                </section>
              ))}
              {more.length > 0 && (
                <Disclosure isExpanded={moreShown} onExpandedChange={setMoreShown}>
                  <Disclosure.Heading className="m-0">
                    <Disclosure.Trigger className="flex w-full items-center text-xs font-medium text-muted">
                      {t.moreValues(more.length)}
                      <Disclosure.Indicator />
                    </Disclosure.Trigger>
                  </Disclosure.Heading>
                  <Disclosure.Content>
                    <Disclosure.Body className="p-0 pt-1">
                      <ValueLines lines={more} charts={chartable} colors={stripColors} chosen={chosen} onToggle={toggleChart} />
                    </Disclosure.Body>
                  </Disclosure.Content>
                </Disclosure>
              )}
            </div>
            {!up && <p className="m-0 mt-2 text-xs text-muted">{t.noTelemetry}</p>}
          </Card.Content>
          {track.sticks && (
            <Card.Footer className="border-t border-separator pt-3">
              <Sticks track={track} row={row} mode={track.stickMode ?? sticks} />
            </Card.Footer>
          )}
        </Card>
      </div>

      <Card ref={tabsRef} className="p-4" style={{ minHeight: tabsHeight }}>
        <Tabs
          aria-label={t.chartsTab}
          selectedKey={tab}
          onSelectionChange={(k) => {
            keepTabsHeight();
            setTab(String(k));
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator pb-3">
            <Tabs.ListContainer className="w-fit">
              <Tabs.List aria-label={t.chartsTab} className="w-fit">
                <Tabs.Tab id="charts" className="whitespace-nowrap">
                  {t.chartsTab}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="scatter" className="whitespace-nowrap">
                  {t.scatterTab}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="analysis" className="whitespace-nowrap">
                  {t.analysisTab}
                  {track.hints.length > 0 && (
                    <Chip size="sm" color="warning" variant="primary" className="ml-1.5" aria-label={t.hintCount(track.hints.length)}>
                      {track.hints.length}
                    </Chip>
                  )}
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            {tab === 'charts' && (
              <ChartTools
                series={series}
                chosen={chosen}
                onChoose={setChosen}
                measure={measure}
                onMeasure={(on) => {
                  setMeasure(on);
                  setMarks({});
                }}
                marks={marks}
                zoomed={!!range && (range[0] > 0 || range[1] < track.duration)}
                onWholeFlight={() => setRange(undefined)}
              />
            )}
          </div>
          <Tabs.Panel id="charts" className="pt-3">
            <Charts
              track={track}
              series={series}
              chosen={chosen.filter((id) => series.some((s) => s.id === id))}
              onChoose={setChosen}
              colors={stripColors}
              time={time}
              hover={hover}
              onHover={setHover}
              onSeek={seek}
              range={range ?? [0, track.duration]}
              onRange={setRange}
              measure={measure}
              marks={marks}
              onMarks={setMarks}
            />
          </Tabs.Panel>
          <Tabs.Panel id="scatter" className="pt-3">
            <Scatter track={track} series={series} pair={pair} onPair={setPair} time={time} range={range ?? [0, track.duration]} />
          </Tabs.Panel>
          <Tabs.Panel id="analysis" className="pt-3">
            {/* as many cards side by side as fit at 340 px; those in a row share what is left */}
            <div className="flex flex-wrap gap-6">
              {summary.length > 0 && (
                <EventList
                  title={t.summary}
                  empty=""
                  items={summary.map((x) => ({ t: x.t, text: t.summaryNames[x.k], value: format(x.v, x.k) }))}
                  takeoff={track.takeoff}
                  onPick={seek}
                />
              )}
              <EventList title={t.events} empty={t.noEvents} items={track.events.map((e) => ({ t: e.t, text: t.eventNames[e.kind] }))} takeoff={track.takeoff} onPick={seek} />
              <EventList
                title={t.hints}
                empty={t.noHints}
                items={track.hints.map((h) => ({ t: h.t, text: t.hintNames[h.kind] }))}
                takeoff={track.takeoff}
                onPick={pickHint}
              />
              {track.antennas && <AntennaRose rose={track.antennas} />}
            </div>
          </Tabs.Panel>
        </Tabs>
      </Card>
    </div>
  );
}

function EventList(props: { title: string; empty: string; items: { t: number; text: string; value?: string }[]; takeoff: number; onPick: (t: number) => void }) {
  const { t } = usePrefs();
  return (
    <Card variant="secondary" className="min-w-0 flex-[1_1_340px]">
      <Card.Header>
        <Card.Title>{props.title}</Card.Title>
      </Card.Header>
      <Card.Content className="p-0">
        {props.items.length === 0 ? (
          <p className="m-0 text-sm text-muted">{props.empty}</p>
        ) : (
          <ul className="-mx-2 m-0 list-none p-0">
            {props.items.map((e) => (
              <li key={`${e.t}${e.text}`} className="border-t border-separator">
                <button
                  type="button"
                  aria-label={t.jumpTo(e.value ? `${e.text} ${e.value}` : e.text, fromTakeoff(e.t, props.takeoff))}
                  className="flex w-full cursor-pointer items-baseline gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left text-sm text-foreground hover:bg-surface-tertiary"
                  onClick={() => props.onPick(e.t)}
                >
                  <span className="w-14 shrink-0 font-mono whitespace-nowrap tabular-nums text-muted">{fromTakeoff(e.t, props.takeoff)}</span>
                  <span className="min-w-0 flex-1">{e.text}</span>
                  {e.value && <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">{e.value}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}

// One value per line: its name in plain words, the sensor's name from the log small beside it, the value on the right.
// A click puts the value into the charts or takes it out; a dot in its strip's color marks those shown.
function ValueLines(props: {
  lines: { k: string; name: string; label: string; value: string }[];
  charts: Set<string>; // values that can be charted
  colors: Record<string, string>;
  chosen: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = usePrefs();
  return (
    <ul className="m-0 list-none p-0">
      {props.lines.map((v) => {
        const row = (
          <>
            <i className="inline-block size-2 shrink-0 self-center rounded-full" style={{ background: props.chosen.includes(v.k) ? props.colors[v.k] : 'transparent' }} />
            <span className="min-w-0 text-sm">
              {v.label} {v.label !== v.name && <span className="font-mono text-xs whitespace-nowrap text-muted">{v.name}</span>}
            </span>
            <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">{v.value}</span>
          </>
        );
        const cls = 'flex w-full items-baseline gap-2 py-1.5';
        if (!props.charts.has(v.k)) return <li key={v.k} className={`border-t border-separator ${cls}`}>{row}</li>;
        const shown = props.chosen.includes(v.k);
        return (
          <li key={v.k} className="border-t border-separator">
            <Tooltip delay={600}>
              <Tooltip.Trigger
                role="button"
                tabIndex={0}
                aria-pressed={shown}
                aria-label={`${v.label}: ${shown ? t.removeFromCharts : t.showInCharts}`}
                className={`${cls} cursor-pointer rounded-md hover:bg-surface-secondary`}
                onClick={() => props.onToggle(v.k)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  props.onToggle(v.k);
                }}
              >
                {row}
              </Tooltip.Trigger>
              <Tooltip.Content placement="left">{shown ? t.removeFromCharts : t.showInCharts}</Tooltip.Content>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
