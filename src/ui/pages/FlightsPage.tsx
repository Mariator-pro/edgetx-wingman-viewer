import { Button, Card, Checkbox, Chip, Dropdown, Header, Label, SearchField, Spinner, Table, type SortDescriptor } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { LIST_COLUMNS, LIST_SORTS, type ListColumn, type ListSort } from '../../core/kinds.ts';
import type { FlightView } from '../../server/api.ts';
import { post } from '../api.ts';
import { Confirm } from '../components/Confirm.tsx';
import { ColumnsIcon, MoreIcon, SlidersIcon, SortIcon } from '../components/icons.tsx';
import { duration, flightLabel, radioLabel, shortDay, time } from '../format.ts';
import type { Texts } from '../texts.ts';
import { usePrefs } from '../usePrefs.ts';

type Run = (fn: () => Promise<unknown>) => void;
const DELETED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

// packs are numbered per radio's Lipo Nanny settings
const packKey = (f: FlightView) => (f.pack ? `${f.board}:${f.pack.n}` : '');

type SortColumn = ListSort;
type OptionalColumn = ListColumn;
const SORT_COLUMNS = LIST_SORTS;
const OPTIONAL_COLUMNS = LIST_COLUMNS;
const DEFAULT_SORT: SortDescriptor = { column: 'date', direction: 'descending' };

function columnName(t: Texts, c: SortColumn | OptionalColumn): string {
  const names = {
    date: t.colDate,
    time: t.colTime,
    model: t.colModel,
    radio: t.colRadio,
    duration: t.colDuration,
    pack: t.colPack,
    more: t.colMore,
  };
  return names[c];
}

// Order of the list for a sortable column; ties stay in the order of the log (newest first).
function compare(a: FlightView, b: FlightView, column: SortColumn, t: Texts): number {
  const text = (x: string, y: string) => x.localeCompare(y, t.locale, { numeric: true });
  if (column === 'model') return text(a.model, b.model);
  if (column === 'radio') return text(radioLabel(t, a), radioLabel(t, b));
  if (column === 'duration') return a.duration - b.duration;
  if (column === 'pack') return text(a.pack ? t.packName(a.pack) : '', b.pack ? t.packName(b.pack) : '');
  return 0;
}

function matches(f: FlightView, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return [f.model, f.note ?? '', ...f.tags, f.pack?.battery ?? ''].some((x) => x.toLowerCase().includes(s));
}

export function FlightsPage(props: { flights?: FlightView[]; run: Run; onOpen: (key: string) => void; onSample: () => void; notify: (title: string) => void }) {
  const { flights, run, onOpen, onSample, notify } = props;
  const { t, list: kept, setList } = usePrefs();
  const [query, setQuery] = useState('');
  const [model, setModel] = useState(kept.model ?? '');
  const [tag, setTag] = useState(kept.tag ?? '');
  const [pack, setPack] = useState(kept.pack ?? '');
  const [radio, setRadio] = useState(kept.radio ?? '');
  const [showDeleted, setShowDeleted] = useState(kept.deleted ?? false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState<string[]>();
  const [now] = useState(() => Date.now());
  const [sort, setSort] = useState<SortDescriptor>(kept.sort ? { column: kept.sort, direction: kept.order ?? 'ascending' } : DEFAULT_SORT);
  const [hidden, setHidden] = useState<Set<OptionalColumn>>(() => new Set(kept.hidden));
  const shows = (c: OptionalColumn) => !hidden.has(c);

  const all = useMemo(() => flights ?? [], [flights]);
  const current = all.filter((f) => !!f.deleted === showDeleted);
  const radios = [...new Set(all.filter((f) => !f.deleted).map((f) => radioLabel(t, f)))].sort((a, b) => a.localeCompare(b));
  const models = [...new Set(all.filter((f) => !f.deleted).map((f) => f.model))].sort((a, b) => a.localeCompare(b));
  const tags = [...new Set(all.filter((f) => !f.deleted).flatMap((f) => f.tags))].sort((a, b) => a.localeCompare(b));
  const packs = [...new Map(all.filter((f) => !f.deleted && f.pack).map((f) => [packKey(f), t.packName(f.pack!)])).entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, t.locale, { numeric: true }));
  const shown = current
    .filter((f) => matches(f, query) && (!model || f.model === model) && (!radio || radioLabel(t, f) === radio) && (!tag || f.tags.includes(tag)) && (!pack || packKey(f) === pack))
    .reverse();
  const sortColumn = SORT_COLUMNS.find((c) => c === sort.column) ?? 'date';
  // the log order is oldest first, so "descending" by date is the list as it comes
  if (sortColumn === 'date') {
    if (sort.direction === 'ascending') shown.reverse();
  } else {
    const sign = sort.direction === 'ascending' ? 1 : -1;
    shown.sort((a, b) => sign * compare(a, b, sortColumn, t));
  }
  const shownKeys = shown.map((f) => f.key);
  const anyPack = shows('pack') && shown.some((f) => f.pack);
  const activeFilters = [model, radio, pack, tag].filter(Boolean).length + (showDeleted ? 1 : 0);
  const sorted = sortColumn !== DEFAULT_SORT.column || sort.direction !== DEFAULT_SORT.direction;
  const changed = activeFilters > 0 || sorted || hidden.size > 0;
  const reset = () => {
    setModel('');
    setRadio('');
    setPack('');
    setTag('');
    setShowDeleted(false);
    setPicked(new Set());
    setSort(DEFAULT_SORT);
    setHidden(new Set());
  };

  // kept for the next visit and the next start, only what differs from the start
  useEffect(() => {
    setList({
      ...(model ? { model } : {}),
      ...(radio ? { radio } : {}),
      ...(pack ? { pack } : {}),
      ...(tag ? { tag } : {}),
      ...(showDeleted ? { deleted: true } : {}),
      ...(sorted ? { sort: sortColumn, order: sort.direction } : {}),
      ...(hidden.size > 0 ? { hidden: OPTIONAL_COLUMNS.filter((c) => hidden.has(c)) } : {}),
    });
  });
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
      const { count } = await post<{ count: number }>('/api/flights/delete', {
        keys,
      });
      toggle(keys, false);
      notify(t.deleted(count));
    });
  const restore = (keys: string[]) =>
    run(async () => {
      const { count } = await post<{ count: number }>('/api/flights/restore', {
        keys,
      });
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="m-0 text-3xl font-bold tracking-tight">{showDeleted ? t.recentlyDeleted : t.flights}</h1>
          <Chip size="sm" aria-label={t.flightCount(shown.length)}>
            {shown.length}
          </Chip>
        </div>
        <Button variant="outline" onPress={onSample}>
          {t.openSample}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Dropdown>
          <Button variant="tertiary">
            <SlidersIcon size={16} />
            {t.filter}
            {activeFilters > 0 && (
              <Chip size="sm" color="accent">
                {activeFilters}
              </Chip>
            )}
          </Button>
          <Dropdown.Popover className="field-list" placement="bottom start">
            <Dropdown.Menu aria-label={t.filter}>
              <FilterSubmenu label={t.modelFilter} all={t.allModels} value={model} options={models.map((m) => ({ id: m, label: m }))} onChange={setModel} />
              <FilterSubmenu label={t.radioFilter} all={t.allRadios} value={radio} options={radios.map((r) => ({ id: r, label: r }))} onChange={setRadio} />
              {packs.length > 0 ? <FilterSubmenu label={t.packFilter} all={t.allPacks} value={pack} options={packs} onChange={setPack} /> : null}
              {tags.length > 0 ? (
                <FilterSubmenu label={t.tagFilter} all={t.allTags} value={tag} options={tags.map((x) => ({ id: x, label: x }))} onChange={setTag} />
              ) : null}
              <Dropdown.Section
                selectionMode="multiple"
                selectedKeys={showDeleted ? ['deleted'] : []}
                onSelectionChange={(k) => {
                  setShowDeleted(k === 'all' || k.has('deleted'));
                  setPicked(new Set());
                }}
              >
                <Dropdown.Item id="deleted" textValue={t.recentlyDeleted}>
                  <Label>{t.recentlyDeleted}</Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Dropdown>
          <Button variant="tertiary">
            <SortIcon size={16} />
            {t.sort}
          </Button>
          <Dropdown.Popover className="field-list" placement="bottom start">
            <Dropdown.Menu aria-label={t.sort}>
              <Dropdown.Section
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[sortColumn]}
                onSelectionChange={(k) => {
                  const c = SORT_COLUMNS.find((x) => x === [...k][0]);
                  if (c)
                    setSort({
                      column: c,
                      direction: c === 'date' || c === 'duration' ? 'descending' : 'ascending',
                    });
                }}
              >
                <Header>{t.sortBy}</Header>
                {SORT_COLUMNS.filter((c) => c !== 'pack' || packs.length > 0).map((c) => (
                  <Dropdown.Item key={c} id={c} textValue={columnName(t, c)}>
                    {columnName(t, c)}
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Section>
              <Dropdown.Section
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[sort.direction]}
                onSelectionChange={(k) => {
                  const d = [...k][0];
                  if (d === 'ascending' || d === 'descending') setSort({ column: sortColumn, direction: d });
                }}
              >
                <Header>{t.order}</Header>
                <Dropdown.Item id="ascending" textValue={t.ascending}>
                  {t.ascending}
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
                <Dropdown.Item id="descending" textValue={t.descending}>
                  {t.descending}
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Dropdown>
          <Button variant="tertiary">
            <ColumnsIcon size={16} />
            {t.columns}
          </Button>
          <Dropdown.Popover className="field-list" placement="bottom start">
            <Dropdown.Menu
              aria-label={t.columns}
              selectionMode="multiple"
              selectedKeys={OPTIONAL_COLUMNS.filter((c) => !hidden.has(c))}
              onSelectionChange={(k) => setHidden(new Set(OPTIONAL_COLUMNS.filter((c) => k !== 'all' && !k.has(c))))}
            >
              {OPTIONAL_COLUMNS.filter((c) => c !== 'pack' || packs.length > 0).map((c) => (
                <Dropdown.Item key={c} id={c} textValue={columnName(t, c)}>
                  {columnName(t, c)}
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        {changed && (
          <Button variant="ghost" onPress={reset}>
            {t.resetFilters}
          </Button>
        )}
        <span className="flex-1" />
        <SearchField aria-label={t.search} className="w-72 max-w-full" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t.searchHint} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
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

      {shown.length > 0 && (
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label={t.flights}
              selectionMode="multiple"
              selectedKeys={new Set(shownKeys.filter((k) => picked.has(k)))}
              onSelectionChange={(s) => {
                const on = s === 'all' ? new Set(shownKeys) : s;
                setPicked((p) => {
                  const next = new Set(p);
                  for (const k of shownKeys) {
                    if (on.has(k)) next.add(k);
                    else next.delete(k);
                  }
                  return next;
                });
              }}
              onRowAction={(k) => onOpen(String(k))}
              sortDescriptor={sort}
              onSortChange={setSort}
              className="whitespace-nowrap"
            >
              <Table.Header>
                <Table.Column className="w-0 pr-0">
                  <SelectBox label={t.selectAll} />
                </Table.Column>
                <SortColumn id="date" label={t.colDate} />
                {shows('time') ? <Table.Column>{t.colTime}</Table.Column> : null}
                <SortColumn id="model" label={t.colModel} isRowHeader />
                {shows('radio') ? <SortColumn id="radio" label={t.colRadio} /> : null}
                {shows('duration') ? <SortColumn id="duration" label={t.colDuration} /> : null}
                {anyPack ? <SortColumn id="pack" label={t.colPack} /> : null}
                <Table.Column className="w-full">
                  <span className="sr-only">{t.colMore}</span>
                </Table.Column>
                <Table.Column className="w-0">
                  <span className="sr-only">{t.colActions}</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {shown.map((f) => {
                  const label = flightLabel(t, f);
                  return (
                    <Table.Row key={f.key} id={f.key} textValue={label} className="cursor-pointer">
                      <Table.Cell className="pr-0">
                        <SelectBox label={t.selectFlight(label)} />
                      </Table.Cell>
                      <Table.Cell>{f.hasDate ? shortDay(f.start, t.locale) : '–'}</Table.Cell>
                      {shows('time') ? <Table.Cell className="font-mono">{f.hasDate ? time(f.start, t.locale) : '–'}</Table.Cell> : null}
                      <Table.Cell className="font-medium">{f.model}</Table.Cell>
                      {shows('radio') ? <Table.Cell className="text-muted">{radioLabel(t, f)}</Table.Cell> : null}
                      {shows('duration') ? <Table.Cell className="text-right tabular-nums">{duration(f.duration)}</Table.Cell> : null}
                      {anyPack ? <Table.Cell className="text-muted">{f.pack ? t.packName(f.pack) : '–'}</Table.Cell> : null}
                      <Table.Cell>
                        {shows('more') && (
                          <span className="flex items-center gap-1.5">
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
                            {f.note && <span className="max-w-64 truncate text-muted">{f.note}</span>}
                            {f.deleted && <span className="text-muted">{t.goneFor(daysLeft(f))}</span>}
                          </span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
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
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}

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

// One filter as a submenu: "All …" or one value, the current one ticked and shown next to the name.
function FilterSubmenu(props: { label: string; all: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  const current = props.options.find((o) => o.id === props.value)?.label ?? props.all;
  return (
    <Dropdown.SubmenuTrigger>
      <Dropdown.Item textValue={props.label}>
        <Label>{props.label}</Label>
        <span className="ml-auto max-w-40 truncate pl-3 text-xs text-muted">{current}</span>
        <Dropdown.SubmenuIndicator />
      </Dropdown.Item>
      <Dropdown.Popover className="field-list">
        <Dropdown.Menu
          aria-label={props.label}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[props.value || '*']}
          onSelectionChange={(k) => {
            const v = k === 'all' ? '*' : String([...k][0] ?? '*');
            props.onChange(v === '*' ? '' : v);
          }}
        >
          {[{ id: '*', label: props.all }, ...props.options].map((o) => (
            <Dropdown.Item key={o.id} id={o.id} textValue={o.label}>
              <Label>{o.label}</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.SubmenuTrigger>
  );
}

// The table's own selection checkbox: react-aria fills in state and toggling.
function SelectBox(props: { label: string }) {
  return (
    <Checkbox slot="selection" variant="secondary" aria-label={props.label}>
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
}

// A column header that sorts the list on click; a second click turns the order around.
function SortColumn(props: { id: SortColumn; label: string; isRowHeader?: boolean }) {
  return (
    <Table.Column id={props.id} allowsSorting isRowHeader={props.isRowHeader}>
      {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>{props.label}</Table.SortableColumnHeader>}
    </Table.Column>
  );
}
