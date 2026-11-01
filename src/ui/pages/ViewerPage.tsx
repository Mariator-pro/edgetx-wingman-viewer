import { Alert, Button, Chip, CloseButton, Dropdown, Input, Popover, Spinner, TextArea, TextField } from '@heroui/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ExportFormat, FlightDetailView, PackView } from '../../server/api.ts';
import { get, post, tokenUrl } from '../api.ts';
import { BatteryIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, MoreIcon, NoteIcon, PlusIcon } from '../components/icons.tsx';
import { altitude, day, distance, duration, radioLabel, time } from '../format.ts';
import { usePrefs } from '../usePrefs.ts';

type Run = (fn: () => Promise<unknown>) => void;
const MAX_NOTE = 500; // the server's limit, MAX_NOTE in library.ts
const MAX_TAG = 40;
const FORMATS: ExportFormat[] = ['gpx', 'kml', 'csv'];
// the map libraries are large, so they load only with the first flight shown
const FlightPlayer = lazy(() => import('../components/FlightPlayer.tsx').then((m) => ({ default: m.FlightPlayer })));

// The browser saves the file itself; the key goes into the address.
function download(key: string, format: ExportFormat): void {
  const a = document.createElement('a');
  a.href = tokenUrl(`/api/export?key=${encodeURIComponent(key)}&format=${format}`);
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

export function ViewerPage(props: {
  flightKey?: string;
  refreshKey: unknown;
  run: Run;
  onOpen: (key: string) => void;
  onLabel: (label: string | undefined) => void;
  notify: (title: string) => void;
}) {
  const { flightKey, refreshKey, run, onOpen, onLabel, notify } = props;
  const { t } = usePrefs();
  const [flight, setFlight] = useState<FlightDetailView>();
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState<string>();
  const [tag, setTag] = useState('');
  const [tagOpen, setTagOpen] = useState(false);

  useEffect(() => {
    if (!flightKey) return;
    let gone = false;
    get<FlightDetailView>(`/api/flight?key=${encodeURIComponent(flightKey)}`).then(
      (f) => {
        if (gone) return;
        setFlight(f);
        setMissing(false);
        onLabel(f.hasDate ? `${f.model}, ${time(f.start, t.locale)}` : f.model);
      },
      () => !gone && setMissing(true),
    );
    return () => {
      gone = true;
    };
    // onLabel is new on every render of the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightKey, refreshKey, t.locale]);
  useEffect(() => {
    setNote(undefined);
    setTag('');
    setTagOpen(false);
  }, [flightKey]);

  if (!flightKey || missing) return <p className="m-0 text-muted">{t.chooseFlight}</p>;
  if (!flight || flight.key !== flightKey) return <Spinner />;

  const f = flight;
  const saveNote = () =>
    run(async () => {
      await post('/api/flight/note', { key: f.key, note: note ?? '' });
      setNote(undefined);
    });
  const setTags = (tags: string[]) => run(() => post('/api/flight/tags', { key: f.key, tags }));
  const addTag = () => {
    const x = tag.trim();
    if (x && !f.tags.includes(x)) setTags([...f.tags, x]);
    setTag('');
    setTagOpen(false);
  };
  const subtitle = f.sample ? t.sampleText : [f.hasDate ? `${day(f.start, t.locale)}, ${time(f.start, t.locale)}` : f.file, radioLabel(t, f)].join(' · ');
  const facts = [duration(f.duration), t.maxDistance(distance(f.maxDistance, t.locale)), t.maxAltitude(altitude(f.maxAlt, f.altUnit))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="m-0 text-2xl font-bold tracking-tight">{f.model}</h1>
            <span className="text-sm text-muted">{subtitle}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {f.sample && (
              <Chip size="sm" variant="soft" color="accent">
                {t.sampleFlight}
              </Chip>
            )}
            {facts.map((x) => (
              <Chip key={x} size="sm" variant="secondary" className="tabular-nums">
                {x}
              </Chip>
            ))}
            {f.pack && <PackChip pack={f.pack} />}
            {f.tags.map((x) => (
              <Chip key={x} size="sm" variant="soft" color="accent" className="pr-1">
                {x}
                <CloseButton aria-label={t.removeTag(x)} className="size-4" onPress={() => setTags(f.tags.filter((y) => y !== x))} />
              </Chip>
            ))}
            {!f.sample && (
              <Popover isOpen={tagOpen} onOpenChange={setTagOpen}>
                <Button size="sm" variant="ghost" className="h-7 border border-dashed border-border px-2.5 text-xs">
                  <PlusIcon size={12} />
                  {t.tag}
                </Button>
                <Popover.Content placement="bottom start">
                  <Popover.Dialog aria-label={t.addTag}>
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addTag();
                      }}
                    >
                      <TextField variant="secondary" aria-label={t.addTag} value={tag} onChange={setTag} autoFocus>
                        <Input placeholder={t.tagPlaceholder} maxLength={MAX_TAG} className="w-40" />
                      </TextField>
                      <Button type="submit" size="sm" isDisabled={!tag.trim()}>
                        {t.addTag}
                      </Button>
                    </form>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
            )}
          </div>
          {f.note && <p className="m-0 max-w-prose whitespace-pre-wrap text-sm text-muted">{f.note}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!f.sample && (
            <>
              <Button isIconOnly variant="outline" aria-label={t.prevFlight} isDisabled={!f.prev} onPress={() => f.prev && onOpen(f.prev)}>
                <ChevronLeftIcon />
              </Button>
              <Button isIconOnly variant="outline" aria-label={t.nextFlight} isDisabled={!f.next} onPress={() => f.next && onOpen(f.next)}>
                <ChevronRightIcon />
              </Button>
              <Popover
                isOpen={note !== undefined}
                onOpenChange={(open) => setNote(open ? (f.note ?? '') : undefined)}
              >
                <Button variant="outline">
                  <NoteIcon size={16} />
                  {t.note}
                </Button>
                <Popover.Content placement="bottom end">
                  <Popover.Dialog aria-label={t.note}>
                    <form
                      className="flex w-80 flex-col gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveNote();
                      }}
                    >
                      <TextField variant="secondary" aria-label={t.note} value={note ?? ''} onChange={setNote} autoFocus>
                        <TextArea placeholder={t.notePlaceholder} maxLength={MAX_NOTE} rows={4} />
                      </TextField>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onPress={() => setNote(undefined)}>
                          {t.cancel}
                        </Button>
                        <Button type="submit" size="sm" isDisabled={note === (f.note ?? '')}>
                          {t.save}
                        </Button>
                      </div>
                    </form>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
            </>
          )}
          <Dropdown>
            <Button variant="outline">
              <DownloadIcon size={16} />
              {t.export}
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={(k) => download(f.key, k as ExportFormat)}>
                {FORMATS.map((x) => (
                  <Dropdown.Item key={x} id={x} textValue={t.exportAs(x.toUpperCase())}>
                    <div className="flex flex-col">
                      <span>{t.exportAs(x.toUpperCase())}</span>
                      <span className="text-xs text-muted">{t.exportHint[x]}</span>
                    </div>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          {!f.sample && (
            <Dropdown>
              <Button isIconOnly variant="ghost" aria-label={t.moreFor(f.model)}>
                <MoreIcon />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  onAction={(k) =>
                    run(async () => {
                      if (k === 'restore') {
                        await post('/api/flights/restore', { keys: [f.key] });
                        notify(t.restored(1));
                      } else {
                        await post('/api/flights/delete', { keys: [f.key] });
                        notify(t.deleted(1));
                      }
                    })
                  }
                >
                  {f.deleted ? (
                    <Dropdown.Item id="restore" textValue={t.restore}>
                      {t.restore}
                    </Dropdown.Item>
                  ) : (
                    <Dropdown.Item id="delete" textValue={t.deleteFlight} variant="danger">
                      {t.deleteFlight}
                    </Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          )}
        </div>
      </div>

      {f.deleted && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t.recentlyDeleted}</Alert.Title>
          </Alert.Content>
        </Alert>
      )}

      <Suspense fallback={<div className="h-[480px] animate-pulse rounded-3xl bg-surface-secondary" />}>
        <FlightPlayer flightKey={f.key} />
      </Suspense>

      {f.skipped > 0 && <p className="m-0 text-sm text-muted">{t.skipped(f.skipped)}</p>}
    </div>
  );
}

// The flight's pack; its details as Lipo Nanny keeps them now, not as they were at the flight.
function PackChip({ pack }: { pack: PackView }) {
  const { t } = usePrefs();
  const name = t.packName(pack);
  const rows: [string, string][] = [];
  if (pack.capacity !== undefined) rows.push([t.packCapacity, `${pack.cells ? `${pack.cells}S ` : ''}${pack.capacity.toLocaleString(t.locale)} mAh`]);
  if (pack.cycles !== undefined) rows.push([t.packCycles, pack.cycles.toLocaleString(t.locale)]);
  if (pack.wear !== undefined) rows.push([t.packWear, `${pack.wear} %`]);
  if (pack.lastUsed) rows.push([t.packLastUsed, new Date(`${pack.lastUsed}T12:00:00`).toLocaleDateString(t.locale, { dateStyle: 'medium' })]);
  return (
    <Popover>
      <Button size="sm" variant="secondary" className="h-7 gap-1.5 px-2.5 text-xs font-normal" aria-label={`${t.packDetails}: ${name}`}>
        <BatteryIcon size={14} />
        {name}
        {pack.cycles !== undefined && <span className="text-muted">· {t.cycles(pack.cycles)}</span>}
      </Button>
      <Popover.Content placement="bottom start">
        <Popover.Dialog aria-label={t.packDetails} className="flex w-64 flex-col gap-2">
          <p className="m-0 font-semibold">{name}</p>
          {rows.length > 0 && (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="m-0 tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {pack.retired && <p className="m-0 text-sm text-muted">{t.packRetired}</p>}
          <p className="m-0 text-xs text-muted">{pack.battery ? t.packNow : t.packUnknown}</p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
