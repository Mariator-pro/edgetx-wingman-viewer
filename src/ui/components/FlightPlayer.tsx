import { Alert, Button, ButtonGroup, Card, Chip, Dropdown, ListBox, Select, Slider, Tabs, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import type { Map as MapLibre } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Airframe, EventKind, TrackValue } from '../../core/kinds.ts';
import { ROLES } from '../../core/roles.ts';
import type { MapSettingsView, TrackView } from '../../server/api.ts';
import { get, post } from '../api.ts';
import { clockText, distance, duration } from '../format.ts';
import { formatValue, PAIRS, PRESET, seriesOf } from '../series.ts';
import { byLevel, colorChoices, coloring, rgbCss, rowAt, type ColorBy } from '../track.ts';
import { usePrefs } from '../usePrefs.ts';
import { AntennaRose } from './AntennaRose.tsx';
import { Attitude } from './Attitude.tsx';
import { Charts, ChartTools, type Marks, type Range } from './Charts.tsx';
import { FlightMap, type Base, type View } from './FlightMap.tsx';
import { Scatter } from './Scatter.tsx';
import { Sticks } from './Sticks.tsx';
import { FitIcon, LayersIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon } from './icons.tsx';

// Warning levels and pack number of the cores: shown as colors, hints and the pack, not as bare numbers.
const CORE_SENSORS = new Set<string>([...ROLES.lnst, ...ROLES.lnpk, ...ROLES.lsst, ...ROLES.ghst]);

const SPEEDS = [1, 2, 5, 10, 30];
// square buttons; the group's rounded corners come from clipping
const BAD: EventKind[] = ['link-lost', 'failsafe'];
const GOOD: EventKind[] = ['link-back', 'gps-back'];
const NOTICE: EventKind[] = ['rth', 'land', 'gps-lost'];
const SHOWN: (TrackValue | 'fm')[] = ['alt', 'gspd', 'vspd', 'volt', 'curr', 'capa', 'fuel', 'lq', 'rssi1', 'rssi2', 'sats', 'hdg', 'fm', 'dist'];
const UNIT_SHOWN: Record<string, string> = { kmh: 'km/h', mps: 'm/s', fps: 'ft/s' };
const DIGITS: Partial<Record<TrackValue, number>> = { volt: 2, curr: 1, vspd: 1, gspd: 1 };
const HINT_ZOOM_S = 30; // a hint picked in the list: the charts show this much before and after it

// Seconds as "+1:23" from takeoff
const fromTakeoff = (s: number, takeoff: number) => `${s < takeoff ? '−' : '+'}${duration(Math.abs(s - takeoff) * 1000)}`;


// Typing in a field, or a control that takes the space bar itself: the space bar isn't play and pause there.
function ownsSpace(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-flight-slider]')) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || !!el.closest('[role="menu"],[role="listbox"],[role="dialog"]');
}

export function FlightPlayer({ flightKey }: { flightKey: string }) {
  const { t, sticks, attitudeShown } = usePrefs();
  const [loaded, setTrack] = useState<TrackView>();
  const [hover, setHover] = useState<number>();
  const [range, setRange] = useState<Range>();
  const [chosen, setChosen] = useState<string[]>(PRESET);
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
  const [airframe, setAirframe] = useState<Airframe>();
  const clockRef = useRef({ time: 0, last: 0 });
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
        setTime(tr.duration);
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
    if (!playing && time >= track.duration) seek(0);
    else clockRef.current.time = time;
    setPlaying((p) => !p);
  };
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || ownsSpace(e.target)) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  if (!track || !colors) return <div className="h-[480px] animate-pulse rounded-3xl bg-surface-secondary" />;

  const hasPath = track.path.length > 0;
  // over a chart, map and values follow the mouse
  const shownTime = hover ?? time;
  const row = rowAt(track, shownTime);
  const series = seriesOf(track, t);
  const extra = series.filter((s) => s.id.startsWith('log:') && !CORE_SENSORS.has(s.name));
  const up = SHOWN.some((k) => (k === 'fm' ? track.rows.fm?.[row] != null : track.rows.values[k]?.[row] != null));
  const values = SHOWN.flatMap((k): { k: string; name: string; label: string; value: string }[] => {
    if (k === 'fm') {
      if (!track.rows.fm) return [];
      const m = track.rows.fm[row];
      return [{ k, name: track.names.fm ?? 'FM', label: t.valueNames.fm, value: m != null ? track.modes[m]! : '–' }];
    }
    const col = track.rows.values[k];
    if (!col) return [];
    const v = col[row];
    return [{ k, name: track.names[k] ?? k, label: t.valueNames[k], value: v != null ? format(v, k) : '–' }];
  });
  const choices = colorChoices(track);
  const pct = (s: number) => `${(s / (track.duration || 1)) * 100}%`;
  const markColor = (k: EventKind) => (BAD.includes(k) ? 'bg-danger' : GOOD.includes(k) ? 'bg-success' : NOTICE.includes(k) ? 'bg-warning' : 'bg-foreground');
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
          <Alert.Content className="flex-row flex-wrap items-center gap-2">
            <Alert.Title className="mr-1">{t.hintCount(track.hints.length)}</Alert.Title>
            {track.hints.map((h) => (
              <Button
                key={`${h.t}${h.kind}`}
                size="sm"
                variant="tertiary"
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
        <Card className="relative h-[620px] min-w-0 flex-[999_1_520px] overflow-hidden p-0">
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
                roomRight={!!track.attitude && attitudeShown}
                wholeFlight={wholeFlight}
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
                  <Button isIconOnly aria-label={t.wholeFlight} onPress={() => setWholeFlight((n) => n + 1)}>
                    <FitIcon size={16} />
                  </Button>
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
                <Button isIconOnly size="lg" className="rounded-full" aria-label={playing ? t.pause : t.play} onPress={toggle}>
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </Button>
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
                <span className="font-semibold">{clockText(time)}</span>
                <span className="text-muted"> / {clockText(track.duration)}</span>
              </span>
              <div className="relative min-w-0 flex-1 pt-4" data-flight-slider>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-4">
                  {track.events.map((e) => (
                    <TimelineMark
                      key={`${e.t}${e.kind}`}
                      name={t.eventNames[e.kind]}
                      when={fromTakeoff(e.t, track.takeoff)}
                      label={t.jumpTo(t.eventNames[e.kind], fromTakeoff(e.t, track.takeoff))}
                      className={`top-0.5 h-3 w-0.5 rounded-full ${markColor(e.kind)}`}
                      left={pct(e.t)}
                      onPick={() => seek(e.t)}
                    />
                  ))}
                  {track.hints.map((h) => (
                    <TimelineMark
                      key={`${h.t}${h.kind}`}
                      name={t.hintNames[h.kind]}
                      when={fromTakeoff(h.t, track.takeoff)}
                      label={t.jumpTo(t.hintNames[h.kind], fromTakeoff(h.t, track.takeoff))}
                      className="top-1 size-2.5 rotate-45 rounded-[2px] bg-warning"
                      left={pct(h.t)}
                      onPick={() => seek(h.t)}
                    />
                  ))}
                </div>
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
        <Card className="h-[620px] flex-[1_1_260px] gap-3 p-4" aria-label={t.values}>
          <Card.Header className="flex-row items-baseline justify-between">
            <Card.Title>{t.values}</Card.Title>
            <span className="text-xs tabular-nums text-muted">{t.atTime(clockText(shownTime))}</span>
          </Card.Header>
          <Card.Content className="min-h-0 flex-1 overflow-y-auto">
            <dl className="m-0 grid grid-cols-2 gap-x-4">
              {values.map((v) => (
                <div key={v.k} className="flex items-baseline justify-between border-t border-separator py-1.5" title={v.label}>
                  <dt className="font-mono text-xs text-muted">{v.name}</dt>
                  <dd className="m-0 text-sm font-semibold tabular-nums">{v.value}</dd>
                </div>
              ))}
              {extra.map((s) => {
                const v = s.values[row];
                return (
                  <div key={s.id} className="flex items-baseline justify-between border-t border-separator py-1.5" title={s.label}>
                    <dt className="font-mono text-xs text-muted">{s.name}</dt>
                    <dd className="m-0 text-sm font-semibold tabular-nums">{v != null ? formatValue(s, v, t.locale) : '–'}</dd>
                  </div>
                );
              })}
            </dl>
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
            <div className={`grid gap-6 md:grid-cols-2 ${track.antennas ? 'xl:grid-cols-3' : ''}`}>
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

function EventList(props: { title: string; empty: string; items: { t: number; text: string }[]; takeoff: number; onPick: (t: number) => void }) {
  const { t } = usePrefs();
  return (
    <Card variant="secondary">
      <Card.Header>
        <Card.Title>{props.title}</Card.Title>
      </Card.Header>
      <Card.Content className="p-0">
        {props.items.length === 0 ? (
          <p className="m-0 px-5 pb-4 text-sm text-muted">{props.empty}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {props.items.map((e) => (
              <li key={`${e.t}${e.text}`} className="border-t border-separator">
                <button
                  type="button"
                  aria-label={t.jumpTo(e.text, fromTakeoff(e.t, props.takeoff))}
                  className="flex w-full cursor-pointer gap-4 border-0 bg-transparent px-5 py-2 text-left text-sm text-foreground hover:bg-surface-tertiary"
                  onClick={() => props.onPick(e.t)}
                >
                  <span className="w-16 font-mono tabular-nums text-muted">{fromTakeoff(e.t, props.takeoff)}</span>
                  <span>{e.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}

// An event or hint above the timeline: its name and time at once on pointing, a click jumps there.
function TimelineMark(props: { name: string; when: string; label: string; className: string; left: string; onPick: () => void }) {
  return (
    <Tooltip delay={0} closeDelay={0}>
      <Tooltip.Trigger
        aria-label={props.label}
        className={`pointer-events-auto absolute -translate-x-1/2 cursor-pointer ${props.className}`}
        style={{ left: props.left }}
        onClick={props.onPick}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          props.onPick();
        }}
      />
      <Tooltip.Content showArrow placement="top">
        <Tooltip.Arrow />
        <span className="font-medium">{props.name}</span> <span className="tabular-nums text-muted">{props.when}</span>
      </Tooltip.Content>
    </Tooltip>
  );
}
