import { Button, Card, Checkbox, Chip, Dropdown, ListBox, SearchField, Select, Spinner, Switch } from '@heroui/react';
import { useMemo, useState } from 'react';
import type { FlightView } from '../../server/api.ts';
import { post } from '../api.ts';
import { Confirm } from '../components/Confirm.tsx';
import { MoreIcon } from '../components/icons.tsx';
import { altitude, day, distance, duration, flightLabel, radioLabel, time } from '../format.ts';
import { usePrefs } from '../usePrefs.ts';

type Run = (fn: () => Promise<unknown>) => void;
const DELETED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

const dayOf = (f: FlightView) => (f.hasDate ? f.start.slice(0, 10) : f.file);

function matches(f: FlightView, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return [f.model, f.note ?? '', ...f.tags].some((x) => x.toLowerCase().includes(s));
}

export function FlightsPage(props: {
  flights?: FlightView[];
  run: Run;
  onOpen: (key: string) => void;
  onSample: () => void;
  notify: (title: string) => void;
}) {
  const { flights, run, onOpen, onSample, notify } = props;
  const { t } = usePrefs();
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('');
  const [tag, setTag] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState<string[]>();
  const [now] = useState(() => Date.now());

  const all = useMemo(() => flights ?? [], [flights]);
  const current = all.filter((f) => !!f.deleted === showDeleted);
  const models = [...new Set(all.filter((f) => !f.deleted).map((f) => f.model))].sort((a, b) => a.localeCompare(b));
  const tags = [...new Set(all.filter((f) => !f.deleted).flatMap((f) => f.tags))].sort((a, b) => a.localeCompare(b));
  const shown = current.filter((f) => matches(f, query) && (!model || f.model === model) && (!tag || f.tags.includes(tag))).reverse();
  const groups = new Map<string, FlightView[]>();
  for (const f of shown) groups.set(dayOf(f), [...(groups.get(dayOf(f)) ?? []), f]);
  const selected = shown.filter((f) => picked.has(f.key)).map((f) => f.key);

  const toggle = (keys: string[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  const remove = (keys: string[]) =>
    run(async () => {
      const { count } = await post<{ count: number }>('/api/flights/delete', { keys });
      toggle(keys, false);
      notify(t.deleted(count));
    });
  const restore = (keys: string[]) =>
    run(async () => {
      const { count } = await post<{ count: number }>('/api/flights/restore', { keys });
      toggle(keys, false);
      notify(t.restored(count));
    });
  const purge = (keys: string[]) =>
    run(async () => {
      await post('/api/flights/purge', { keys });
      toggle(keys, false);
    });

  if (!flights) return <Spinner />;

  if (all.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="m-0 text-3xl font-bold tracking-tight">{t.flights}</h1>
        <Card>
          <Card.Header>
            <Card.Title>{t.noFlights}</Card.Title>
            <Card.Description>{t.noFlightsText}</Card.Description>
          </Card.Header>
          <Card.Footer>
            <Button onPress={onSample}>{t.openSample}</Button>
          </Card.Footer>
        </Card>
      </div>
    );
  }

  const daysLeft = (f: FlightView) => Math.min(DELETED_DAYS, Math.max(1, Math.ceil((Date.parse(f.deleted!) + DELETED_DAYS * DAY_MS - now) / DAY_MS)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-3xl font-bold tracking-tight">{showDeleted ? t.recentlyDeleted : t.flights}</h1>
          <p className="m-0 text-muted">{t.flightCount(shown.length)}</p>
        </div>
        <Button variant="ghost" onPress={onSample}>
          {t.openSample}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SearchField aria-label={t.search} className="min-w-56 flex-1" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t.searchHint} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <FilterSelect label={t.modelFilter} all={t.allModels} value={model} options={models} onChange={setModel} />
        {tags.length > 0 && <FilterSelect label={t.tagFilter} all={t.allTags} value={tag} options={tags} onChange={setTag} />}
        <Switch
          isSelected={showDeleted}
          onChange={(on) => {
            setShowDeleted(on);
            setPicked(new Set());
          }}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="text-sm">{t.recentlyDeleted}</span>
          </Switch.Content>
        </Switch>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-4 py-2.5">
          <span className="text-sm font-medium">{t.selected(selected.length)}</span>
          <span className="flex-1" />
          {showDeleted ? (
            <>
              <Button size="sm" variant="outline" onPress={() => restore(selected)}>
                {t.restore}
              </Button>
              <Button size="sm" variant="danger-soft" onPress={() => setPurging(selected)}>
                {t.deleteNow}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger-soft" onPress={() => remove(selected)}>
              {t.deleteFlights(selected.length)}
            </Button>
          )}
          <Button size="sm" variant="ghost" onPress={() => setPicked(new Set())}>
            {t.clearSelection}
          </Button>
        </div>
      )}

      {shown.length === 0 && <p className="m-0 text-muted">{showDeleted && current.length === 0 ? t.noDeleted : t.noMatch}</p>}

      {[...groups].map(([key, list]) => {
        const keys = list.map((f) => f.key);
        const allPicked = keys.every((k) => picked.has(k));
        const title = list[0]!.hasDate ? day(list[0]!.start, t.locale) : key;
        return (
          <Card key={key}>
            <Card.Header className="flex flex-row items-center gap-3">
              <Checkbox
                variant="secondary"
                aria-label={t.selectAll(title)}
                isSelected={allPicked}
                isIndeterminate={!allPicked && keys.some((k) => picked.has(k))}
                onChange={(on) => toggle(keys, on)}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Content>
              </Checkbox>
              <Card.Title>{title}</Card.Title>
              <Card.Description>{t.flightCount(list.length)}</Card.Description>
            </Card.Header>
            <Card.Content className="p-0">
              <div className="flex items-center gap-x-4 border-t border-separator px-5 py-1.5 text-xs text-muted" aria-hidden="true">
                <span className="w-5" />
                <span className="w-20">{t.colTime}</span>
                <span className="w-40">{t.colModel}</span>
                <span className="w-40">{t.colRadio}</span>
                <span className="w-14 text-right">{t.colDuration}</span>
                <span className="w-16 text-right">{t.colDistance}</span>
                <span className="w-14 text-right">{t.colAltitude}</span>
              </div>
              <ul className="m-0 list-none p-0">
                {list.map((f) => {
                  const label = flightLabel(t, f);
                  return (
                    <li key={f.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-separator px-5 py-2.5">
                      <Checkbox variant="secondary" aria-label={t.selectFlight(label)} isSelected={picked.has(f.key)} onChange={(on) => toggle([f.key], on)}>
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                      <button type="button" onClick={() => onOpen(f.key)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
                        <span className="w-20 whitespace-nowrap font-mono text-sm">{f.hasDate ? time(f.start, t.locale) : '–'}</span>
                        <span className="w-40 truncate font-medium">{f.model}</span>
                        <span className="w-40 truncate text-sm text-muted">{radioLabel(t, f)}</span>
                        <span className="w-14 text-right text-sm tabular-nums" title={t.colDuration}>
                          {duration(f.duration)}
                        </span>
                        <span className="w-16 text-right text-sm tabular-nums" title={t.colDistance}>
                          {distance(f.maxDistance, t.locale)}
                        </span>
                        <span className="w-14 text-right text-sm tabular-nums" title={t.colAltitude}>
                          {altitude(f.maxAlt, f.altUnit)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          {f.hints > 0 && (
                            <Chip size="sm" variant="soft" color="warning">
                              {t.hintCount(f.hints)}
                            </Chip>
                          )}
                          {f.tags.map((x) => (
                            <Chip key={x} size="sm" variant="soft">
                              {x}
                            </Chip>
                          ))}
                          {f.note && <span className="truncate text-sm text-muted">{f.note}</span>}
                          {f.deleted && <span className="text-sm text-muted">{t.goneFor(daysLeft(f))}</span>}
                        </span>
                      </button>
                      <Dropdown>
                        <Button isIconOnly size="sm" variant="ghost" aria-label={t.moreFor(label)}>
                          <MoreIcon size={16} />
                        </Button>
                        <Dropdown.Popover placement="bottom end">
                          <Dropdown.Menu
                            onAction={(action) => {
                              if (action === 'delete') remove([f.key]);
                              else if (action === 'restore') restore([f.key]);
                              else if (action === 'purge') setPurging([f.key]);
                            }}
                          >
                            {f.deleted ? (
                              <>
                                <Dropdown.Item id="restore" textValue={t.restore}>
                                  {t.restore}
                                </Dropdown.Item>
                                <Dropdown.Item id="purge" textValue={t.deleteNow} variant="danger">
                                  {t.deleteNow}
                                </Dropdown.Item>
                              </>
                            ) : (
                              <Dropdown.Item id="delete" textValue={t.deleteFlight} variant="danger">
                                {t.deleteFlight}
                              </Dropdown.Item>
                            )}
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </li>
                  );
                })}
              </ul>
            </Card.Content>
          </Card>
        );
      })}

      {purging && (
        <Confirm
          title={t.deleteNowTitle(purging.length)}
          text={t.deleteNowText}
          confirm={t.deleteNow}
          onConfirm={() => purge(purging)}
          onClose={() => setPurging(undefined)}
        />
      )}
    </div>
  );
}

function FilterSelect(props: { label: string; all: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Select aria-label={props.label} className="w-48" selectedKey={props.value || '*'} onSelectionChange={(k) => props.onChange(k === '*' || k === null ? '' : String(k))}>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {['*', ...props.options].map((o) => (
            <ListBox.Item key={o} id={o} textValue={o === '*' ? props.all : o}>
              {o === '*' ? props.all : o}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
