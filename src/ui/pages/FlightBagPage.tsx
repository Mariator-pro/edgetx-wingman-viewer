import { Alert, Button, Card, Chip, ListBox, NumberField, Select, Spinner, Switch, Tabs, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import type { AppDetailView, Edits, FieldView, FlightBagPage as PageId, FlightBagView, RowView } from '../../core/flightbag-view.ts';
import type { FlightView, RadioView } from '../../server/api.ts';
import { errorText, get, post, tokenUrl } from '../api.ts';
import { Batteries } from '../components/Batteries.tsx';
import { Confirm } from '../components/Confirm.tsx';
import { FlightBagApps } from '../components/FlightBagApps.tsx';
import { LastFlights } from '../components/LastFlights.tsx';
import { Models } from '../components/Models.tsx';
import { PlayIcon } from '../components/icons.tsx';
import { choiceText, manifestText, problemText } from '../flightbagTexts.ts';
import type { Texts } from '../texts.ts';
import { usePrefs } from '../usePrefs.ts';

type Run = (fn: () => Promise<unknown>) => void;
type Value = string | number | boolean;

// The settings of the Lua apps on a connected radio, page by page as on the radio. Every change goes to the
// apps' own page logic on the server, which answers with the page as it now looks (greyed rows, mixed values);
// "Save" writes the changes to the card.
export function FlightBagPage(props: {
  radios: RadioView[];
  flights?: FlightView[];
  run: Run;
  notify: (title: string) => void;
  onDirty: (dirty: boolean) => void;
  onOpenFlight: (key: string) => void;
}) {
  const { radios, flights, run, notify, onDirty, onOpenFlight } = props;
  const { t, lang } = usePrefs();
  const [volume, setVolume] = useState<string>();
  const [page, setPage] = useState<PageId>('warnings');
  const [edits, setEdits] = useState<Edits>({});
  const [view, setView] = useState<FlightBagView>();
  const [error, setError] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; then: () => void }>();
  const asked = useRef(0);

  const radio = radios.find((r) => r.volume === volume) ?? radios[0];
  const dirty = Object.keys(edits).length > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // the page again whenever the radio, the page or the edits change; only the newest answer counts
  const current = radio?.volume;
  useEffect(() => {
    if (!current) return;
    const n = ++asked.current;
    const timer = setTimeout(() => {
      post<FlightBagView>('/api/flightbag/view', { volume: current, page, edits }).then(
        (v) => {
          if (n !== asked.current) return;
          setView(v);
          setError(undefined);
          if (!v.pages.includes(page) && v.pages[0]) setPage(v.pages[0]);
        },
        (e: unknown) => n === asked.current && setError(errorText(t, e)),
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [current, page, edits, reloads, t]);

  // the apps with their details, again after anything was written
  const [apps, setApps] = useState<AppDetailView[]>([]);
  useEffect(() => {
    if (!current) return;
    let gone = false;
    get<AppDetailView[]>(`/api/flightbag/apps?volume=${encodeURIComponent(current)}`).then(
      (a) => !gone && setApps(a),
      () => !gone && setApps([]),
    );
    return () => {
      gone = true;
    };
  }, [current, reloads]);

  const unsaved = (then: () => void) =>
    dirty ? setAsk({ title: t.fbDiscardTitle, text: t.fbDiscardText, confirm: t.fbDiscardConfirm, then }) : then();
  const reset = () => {
    setEdits({});
    setProblems([]);
  };

  const save = () =>
    run(async () => {
      setSaving(true);
      try {
        const r = await post<{ problems: string[] }>('/api/flightbag/save', { volume: radio!.volume, page, edits });
        setProblems(r.problems);
        if (r.problems.length === 0) {
          setEdits({});
          setReloads((n) => n + 1);
          notify(t.fbSaved);
        }
      } finally {
        setSaving(false);
      }
    });

  const fix = (r: RowView, name: string) => {
    const go = () =>
      run(async () => {
        await post('/api/flightbag/fix', { volume: radio!.volume, page, app: r.app });
        setReloads((n) => n + 1);
      });
    if (r.fix === 'damaged') setAsk({ title: t.fbResetTitle(name), text: t.fbResetText, confirm: t.fbReset, then: go });
    else go();
  };

  // only for a moment: without a radio the app leaves this page
  if (!radio) return null;

  const appName = (folder?: string) => view?.apps.find((a) => a.folder === folder)?.name ?? folder ?? '';
  const sections = view ? group(view.rows) : [];

  return (
    <div className="flex flex-col gap-6 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-3xl font-bold tracking-tight">{t.flightBag}</h1>
          <p className="m-0 max-w-2xl text-sm text-muted">{t.fbIntro}</p>
        </div>
        {radios.length > 1 && (
          <Select aria-label={t.fbRadio} className="w-56" selectedKey={radio.volume} onSelectionChange={(k) => k !== null && unsaved(() => { reset(); setVolume(String(k)); })}>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {radios.map((r) => (
                  <ListBox.Item key={r.volume} id={r.volume} textValue={r.name}>
                    {r.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        )}
      </div>

      <FlightBagApps
        volume={radio.volume}
        apps={apps}
        run={run}
        notify={notify}
        guard={(then) =>
          unsaved(() => {
            reset();
            then();
          })
        }
        onDone={() => setReloads((n) => n + 1)}
      />

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{error}</Alert.Title>
          </Alert.Content>
        </Alert>
      )}

      {view?.apps
        .filter((a) => !a.ok)
        .map((a) => (
          <Alert key={a.folder} status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t.fbUpdateNeeded(a.name)}</Alert.Title>
            </Alert.Content>
          </Alert>
        ))}

      {view && view.pages.length > 0 && (
        <Tabs selectedKey={page} onSelectionChange={(k) => k !== page && unsaved(() => { reset(); setPage(String(k) as PageId); })}>
          <Tabs.ListContainer>
            <Tabs.List aria-label={t.flightBag}>
              {view.pages.map((id) => (
                <Tabs.Tab key={id} id={id}>
                  {t.fbPages[id] ?? id}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      )}

      {problems.length > 0 && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t.fbNotSaved}</Alert.Title>
            {problems.map((p) => (
              <Alert.Description key={p}>{problemText(lang, p)}</Alert.Description>
            ))}
          </Alert.Content>
        </Alert>
      )}

      {!view && !error && <Spinner />}
      {view?.batteries && view.page === 'batteries' && (
        <Batteries
          volume={radio.volume}
          view={view.batteries}
          run={run}
          notify={notify}
          reload={() => setReloads((n) => n + 1)}
        />
      )}
      {view?.models && view.page === 'models' && <Models volume={radio.volume} view={view.models} run={run} notify={notify} reload={() => setReloads((n) => n + 1)} />}
      {view?.flights && view.page === 'flights' && <LastFlights list={view.flights} board={radio.board} flights={flights} notify={notify} onOpenFlight={onOpenFlight} />}
      {view && !view.batteries && !view.models && !view.flights && sections.length === 0 && <p className="m-0 text-muted">{t.fbNothing}</p>}

      {sections.map((s) => (
        <Card key={s.key}>
          <Card.Header>
            <Card.Title>{s.head ?? t.fbAllApps}</Card.Title>
            {!s.head && <Card.Description>{t.fbAllAppsText}</Card.Description>}
          </Card.Header>
          <Card.Content className="flex flex-col divide-y divide-separator">
            {s.rows.map((r) =>
              r.kind === 'fix' ? (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-warning">{r.fix === 'noConfig' ? t.fbNoSettings : t.fbDamaged}</span>
                  <Button variant="outline" onPress={() => fix(r, appName(r.app))}>
                    {r.fix === 'noConfig' ? t.fbCreate : t.fbReset}
                  </Button>
                </div>
              ) : (
                <Row key={r.id} row={r} volume={radio.volume} onChange={(v) => setEdits((e) => ({ ...e, [r.id]: v }))} />
              ),
            )}
          </Card.Content>
        </Card>
      ))}

      {dirty && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background p-3 pl-5 shadow-2xl shadow-black">
          <span className="mr-auto font-medium">{t.fbUnsaved}</span>
          <Button variant="tertiary" isDisabled={saving} onPress={reset}>
            {t.fbDiscard}
          </Button>
          <Button isDisabled={saving} onPress={save}>
            {saving && <Spinner size="sm" color="current" />}
            {t.save}
          </Button>
        </div>
      )}

      {ask && <Confirm title={ask.title} text={ask.text} confirm={ask.confirm} onConfirm={ask.then} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

// The rows in cards: the shared ones first without an app's name, then one card per app.
function group(rows: RowView[]): { key: string; head?: string; rows: RowView[] }[] {
  const out: { key: string; head?: string; rows: RowView[] }[] = [];
  for (const r of rows) {
    if (r.kind === 'head') out.push({ key: r.id, head: r.text, rows: [] });
    else {
      if (out.length === 0) out.push({ key: 'shared', rows: [] });
      out[out.length - 1]!.rows.push(r);
    }
  }
  return out.filter((s) => s.rows.length > 0);
}

const places = (r: RowView, key: string) => (r.apps?.length ? r.apps : [r.app ?? '']).map((a) => `${a}.${key}`);

// A value as the radio shows it, in the interface's language; `choice` names the n-th choice.
function valueText(t: Texts, choice: (i: number) => string, f: FieldView, v: unknown): string {
  if (v === undefined || v === null) return t.fbMixed;
  if (f.type === 'bool') return v ? t.fbOn : t.fbOff;
  if (f.type === 'choice') {
    const i = (f.choices ?? []).findIndex((c) => c === v);
    return i < 0 ? String(v) : choice(i);
  }
  if (f.offValue !== undefined && v === f.offValue) return t.fbOff;
  return `${f.prefix ?? ''}${String(v)}${f.unit ? ` ${f.unit}` : ''}`;
}

function Row({ row: r, volume, onChange }: { row: RowView; volume: string; onChange: (v: Value) => void }) {
  const { t, lang } = usePrefs();
  if (r.kind === 'sound' && r.sound) return <SoundRow row={r} volume={volume} onChange={onChange} />;
  const f = r.field;
  if (!f) return null;
  const at = places(r, f.key);
  const label = manifestText(lang, at, 'label', f.label);
  const choices = f.choices ?? [];
  const labelOf = (i: number) => choiceText(lang, at, choices[i], f.labels?.[i] ?? String(choices[i]));
  const isOff = f.offValue !== undefined && r.value === f.offValue;
  // "higher than Off" reads oddly, so a switched-off value gets its own hint
  const hint = r.mixed ? t.fbMixedHint : isOff ? t.fbOffHint(label) : f.hint ? manifestText(lang, at, 'hint', f.hint).replaceAll('%v', valueText(t, labelOf, f, r.value)) : undefined;
  const disabled = r.disabled;
  let control: React.ReactNode;
  if (f.type === 'bool') {
    control = (
      <Switch aria-label={label} isSelected={r.value === true} isDisabled={disabled} onChange={onChange}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    );
  } else if (f.type === 'choice') {
    const selected = choices.findIndex((c) => c === r.value);
    control =
      choices.length <= 3 ? (
        <ToggleButtonGroup
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          isDisabled={disabled}
          selectedKeys={selected >= 0 ? [String(selected)] : []}
          onSelectionChange={(k) => {
            const i = Number([...k][0]);
            if (choices[i] !== undefined) onChange(choices[i]!);
          }}
        >
          {choices.map((_, i) => (
            <ToggleButton key={i} id={String(i)}>
              {labelOf(i)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : (
        <Select aria-label={label} variant="secondary" className="w-48" isDisabled={disabled} selectedKey={selected >= 0 ? String(selected) : null} onSelectionChange={(k) => k !== null && onChange(choices[Number(k)]!)}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="field-list">
            <ListBox>
              {choices.map((_, i) => (
                <ListBox.Item key={i} id={String(i)} textValue={labelOf(i)}>
                  {labelOf(i)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      );
  } else {
    control = (
      <div className="flex items-center gap-2">
        {isOff && <Chip size="sm">{t.fbOff}</Chip>}
        <NumberField
          aria-label={label}
          variant="secondary"
          className="w-36"
          isDisabled={disabled}
          minValue={f.min}
          maxValue={f.max}
          step={f.step ?? 1}
          value={typeof r.value === 'number' ? r.value : Number.NaN}
          onChange={(v) => Number.isFinite(v) && onChange(v)}
        >
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
        <span className="w-8 text-sm text-muted">{f.unit}</span>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex min-w-60 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 font-medium">
          {label}
          {r.mixed && (
            <Chip size="sm" color="warning">
              {t.fbMixed}
            </Chip>
          )}
        </span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </div>
      {control}
    </div>
  );
}

function SoundRow({ row: r, volume, onChange }: { row: RowView; volume: string; onChange: (v: Value) => void }) {
  const { t, lang } = usePrefs();
  const s = r.sound!;
  const at = [`${r.app}.sound.${s.key}`];
  const label = manifestText(lang, at, 'label', s.label);
  const optionLabel = (id: string, l: string) => (id === 'off' ? t.fbOff : id === 'default' ? t.fbDefaultSound : l);
  const play = () => {
    if (!s.play) return;
    void new Audio(tokenUrl(`/api/flightbag/sound?volume=${encodeURIComponent(volume)}&path=${encodeURIComponent(s.play)}`)).play().catch(() => {});
  };
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 ${r.disabled ? 'opacity-50' : ''}`}>
      <div className="flex min-w-60 flex-1 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {s.hint && <span className="text-sm text-muted">{manifestText(lang, at, 'hint', s.hint)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Select aria-label={t.fbSound(label)} variant="secondary" className="w-48" isDisabled={r.disabled} selectedKey={s.value} onSelectionChange={(k) => k !== null && onChange(String(k))}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="field-list">
            <ListBox>
              {s.options.map((o) => (
                <ListBox.Item key={o.id} id={o.id} textValue={optionLabel(o.id, o.label)}>
                  {optionLabel(o.id, o.label)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Button isIconOnly variant="outline" aria-label={t.fbPlay(label)} isDisabled={r.disabled || !s.play} onPress={play}>
          <PlayIcon size={16} />
        </Button>
      </div>
    </div>
  );
}
