import { Button, Card, Chip, Input, Label, Modal, NumberField, Spinner, Table, TextField, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { BatteriesView, BatteryDraft, BatteryEditView, BatteryView, Limit, PackDraft } from '../../core/flightbag-view.ts';
import { errorText, post } from '../api.ts';
import type { Lang } from '../texts.ts';
import { usePrefs } from '../usePrefs.ts';
import { Confirm } from './Confirm.tsx';
import { PlusIcon, TrashIcon } from './icons.tsx';

type Run = (fn: () => Promise<unknown>) => void;

// Lipo Nanny's batteries with their packs, and the dialog to add or change one.
export function Batteries(props: { volume: string; view: BatteriesView; run: Run; notify: (title: string) => void; reload: () => void }) {
  const { volume, view, run, notify, reload } = props;
  const { t, lang } = usePrefs();
  const [editing, setEditing] = useState<{ id?: string }>();

  if (view.broken) return <p className="m-0 text-warning">{t.fbBroken}</p>;

  const levels = (b: BatteryView) => t.fbLimits(b.warnPct ?? view.warnPct, b.critPct ?? view.critPct) + (b.warnPct === undefined ? ` (${t.fbGeneral})` : '');
  const day = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(t.locale) : '–');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 max-w-2xl text-sm text-muted">{t.fbBatteriesIntro}</p>
        <Button onPress={() => setEditing({})}>
          <PlusIcon size={16} />
          {t.fbAddBattery}
        </Button>
      </div>
      {view.list.length === 0 && <p className="m-0 text-muted">{t.fbNoBatteries}</p>}
      {view.list.map((b) => (
        <Card key={b.id}>
          <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Card.Title>{b.name}</Card.Title>
              <Card.Description>
                {[b.chemistry, `${b.cells}S`, `${b.capacityMah} mAh`, levels(b)].join(' · ')}
              </Card.Description>
              <Card.Description>
                {t.fbUsedBy}: {b.models.length ? b.models.join(', ') : t.fbNoModel}
              </Card.Description>
            </div>
            <Button variant="outline" aria-label={t.fbEdit(b.name)} onPress={() => setEditing({ id: b.id })}>
              {t.fbEditBattery}
            </Button>
          </Card.Header>
          <Card.Content>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={`${t.fbPacks}: ${b.name}`} className="whitespace-nowrap">
                  <Table.Header>
                    <Table.Column isRowHeader>{t.fbPacks}</Table.Column>
                    <Table.Column>{t.fbCycles}</Table.Column>
                    <Table.Column>{t.fbWear}</Table.Column>
                    <Table.Column>{t.fbUsed}</Table.Column>
                    <Table.Column>{t.fbMinCell}</Table.Column>
                    <Table.Column>{t.fbLastUsed}</Table.Column>
                    <Table.Column className="w-full">{t.fbBought}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {b.packs.map((p) => (
                      <Table.Row key={p.id ?? p.label} id={p.id ?? String(p.label)} textValue={t.fbPackNo(p.label)}>
                        <Table.Cell className="font-medium">{t.fbPackNo(p.label)}</Table.Cell>
                        <Table.Cell className="tabular-nums">{p.cycles}</Table.Cell>
                        <Table.Cell className="tabular-nums">{p.wear} %</Table.Cell>
                        <Table.Cell className="tabular-nums">{p.totalMah !== undefined ? `${p.totalMah} mAh` : '–'}</Table.Cell>
                        <Table.Cell className="tabular-nums">{p.minVCell !== undefined ? `${p.minVCell.toLocaleString(t.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} V` : '–'}</Table.Cell>
                        <Table.Cell>{day(p.lastUsed)}</Table.Cell>
                        <Table.Cell>{p.buyDate ?? '–'}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
      ))}
      {editing && (
        <BatteryDialog
          volume={volume}
          id={editing.id}
          view={view}
          onClose={() => setEditing(undefined)}
          onDone={(title) => {
            setEditing(undefined);
            notify(title);
            reload();
          }}
          run={run}
          lang={lang}
        />
      )}
    </div>
  );
}

// A number field that steps from 0, so 1300 with steps of 100 stays 1300 although the lowest value is 10.
// Without `shown`, the label is only for screen readers (a column header shows it).
function Num(props: { label: string; shown?: boolean; wide?: boolean; value?: number; limit: Limit; step?: number; unit?: string; chip?: string; onChange: (v: number) => void }) {
  const { label, value, limit, unit, chip, onChange } = props;
  const step = props.step ?? limit.step ?? 1;
  return (
    <div className="flex flex-col gap-1">
      {props.shown !== false && (
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {chip && <Chip size="sm">{chip}</Chip>}
        </span>
      )}
      <div className="flex items-center gap-2">
        <NumberField
          aria-label={label}
          variant="secondary"
          className={props.wide ? 'w-40' : 'w-32'}
          formatOptions={{ useGrouping: false }}
          minValue={step > 1 ? Math.max(limit.min, step) : limit.min}
          maxValue={limit.max}
          step={step}
          value={value ?? Number.NaN}
          onChange={(v) => Number.isFinite(v) && onChange(v)}
        >
          <NumberField.Group>
            <NumberField.DecrementButton />
            <NumberField.Input />
            <NumberField.IncrementButton />
          </NumberField.Group>
        </NumberField>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
    </div>
  );
}

// A month as Lipo Nanny stores it (2026-03); 03/2026 and 3.2026 work too. Typed text stays until it is a whole
// month from 2010 to 2099; leaving the field shows the stored month again (a month can't be cleared, as on the radio).
function MonthField(props: { label: string; value?: string; onChange: (v: string) => void }) {
  const { t } = usePrefs();
  const [text, setText] = useState(props.value ?? '');
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(props.value ?? '');
  }, [props.value]);
  const month = (v: string) => {
    const iso = /^(\d{4})-(\d{1,2})$/.exec(v.trim());
    const other = /^(\d{1,2})[./](\d{4})$/.exec(v.trim());
    if (!iso && !other) return undefined;
    const y = Number(iso ? iso[1] : other![2]);
    const m = Number(iso ? iso[2] : other![1]);
    return y >= 2010 && y <= 2099 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : undefined;
  };
  return (
    <TextField
      aria-label={props.label}
      variant="secondary"
      className="min-w-36"
      value={text}
      isInvalid={text.trim() !== '' && month(text) === undefined}
      onChange={(v) => {
        typing.current = true;
        setText(v);
        const m = month(v);
        if (m) props.onChange(m);
      }}
      onBlur={() => {
        typing.current = false;
        setText(props.value ?? '');
      }}
    >
      <Input placeholder={t.fbMonthExample} />
    </TextField>
  );
}

// The battery as typed: the page logic on the server answers with the generated name, the packs' numbers and
// what keeps it from being saved. Typed text stays as typed while the answer comes.
function BatteryDialog(props: {
  volume: string;
  id?: string;
  view: BatteriesView;
  run: Run;
  lang: Lang;
  onClose: () => void;
  onDone: (title: string) => void;
}) {
  const { volume, id, view, run, lang, onClose, onDone } = props;
  const { t } = usePrefs();
  const [draft, setDraft] = useState<BatteryDraft>();
  const [edit, setEdit] = useState<BatteryEditView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'delete' | 'discard'>();
  const asked = useRef(0);
  const takePacks = useRef(true); // the next answer brings the packs (opened, added, retired)

  useEffect(() => {
    const n = ++asked.current;
    const timer = setTimeout(
      () => {
        post<BatteryEditView>('/api/flightbag/battery', { volume, id, draft, lang }).then(
          (e) => {
            if (n !== asked.current) return;
            setEdit(e);
            setError(undefined);
            if (!draft || takePacks.current) {
              takePacks.current = false;
              setDraft((d) => (d ? { ...d, packs: e.draft.packs } : e.draft));
            }
          },
          (e: unknown) => n === asked.current && setError(errorText(t, e)),
        );
      },
      draft ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [volume, id, draft, t, lang]);

  if (!draft || !edit) {
    return null;
  }
  const L = view.limits;
  const set = (p: Partial<BatteryDraft>) => setDraft({ ...draft, ...p });
  const setPack = (i: number, p: Partial<PackDraft>) => set({ packs: draft.packs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const own = edit.draft.warnPct !== undefined;
  const setLevel = (key: 'warnPct' | 'critPct', v: number) =>
    set({ warnPct: draft.warnPct ?? view.warnPct, critPct: draft.critPct ?? view.critPct, [key]: v });

  const change = (action: 'save' | 'delete') =>
    run(async () => {
      setBusy(true);
      try {
        const r = await post<{ problem?: string }>('/api/flightbag/battery', { volume, id, draft, action, lang });
        if (r.problem) setError(r.problem);
        else onDone(action === 'save' ? t.fbBatterySaved : t.fbBatteryDeleted);
      } finally {
        setBusy(false);
      }
    });
  const close = () => (edit.dirty ? setAsk('discard') : onClose());

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && close()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[46rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{edit.isNew ? t.fbAddBattery : t.fbEditBattery}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-5">
            <div className="flex items-end gap-2">
              <TextField
                variant="secondary"
                className="flex-1"
                value={draft.nameAuto ? edit.draft.name : draft.name}
                maxLength={view.textMax.name}
                onChange={(v) => set(v.trim() === '' ? { name: '', nameAuto: true } : { name: v, nameAuto: false })}
              >
                <Label>{t.fbName}</Label>
                <Input />
              </TextField>
              <Button variant="outline" aria-label={t.fbResetName} isDisabled={draft.nameAuto} onPress={() => set({ name: '', nameAuto: true })}>
                {t.fbResetShort}
              </Button>
            </div>
            <div className="flex flex-wrap items-start gap-5">
              <TextField
                variant="secondary"
                className="w-48"
                value={draft.manufacturer}
                maxLength={view.textMax.manufacturer}
                isInvalid={edit.invalid === 'Manufacturer required' && edit.dirty}
                onChange={(v) => set({ manufacturer: v })}
              >
                <Label>{t.fbManufacturer}</Label>
                <Input />
              </TextField>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t.fbChemistry}</span>
                <ToggleButtonGroup
                  aria-label={t.fbChemistry}
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[draft.chemistry]}
                  onSelectionChange={(k) => {
                    const c = [...k][0];
                    if (c !== undefined) set({ chemistry: String(c) });
                  }}
                >
                  {view.chemistries.map((c) => (
                    <ToggleButton key={c} id={c}>
                      {c}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
            </div>
            <div className="flex flex-wrap gap-5">
              <Num label={t.fbCapacity} wide value={draft.capacityMah} limit={L.capacityMah} unit="mAh" onChange={(v) => set({ capacityMah: v })} />
              <Num label={t.fbCells} value={draft.cells} limit={L.cells} unit="S" onChange={(v) => set({ cells: v })} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium">{t.fbLevels}</span>
              <span className="text-sm text-muted">{t.fbLevelsText}</span>
              <div className="flex flex-wrap gap-5">
                <Num label={t.fbLow} value={edit.draft.warnPct ?? view.warnPct} limit={L.warnPct} unit="%" chip={own ? undefined : t.fbGeneral} onChange={(v) => setLevel('warnPct', v)} />
                <Num label={t.fbCrit} value={edit.draft.critPct ?? view.critPct} limit={L.critPct} unit="%" chip={own ? undefined : t.fbGeneral} onChange={(v) => setLevel('critPct', v)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium">{t.fbPacks}</span>
              <span className="text-sm text-muted">{t.fbPacksText}</span>
              <div className="overflow-x-auto">
                <div className="grid min-w-[560px] grid-cols-[4.5rem_auto_auto_1fr_auto] items-center gap-x-4 gap-y-2">
                  {['', t.fbCycles, t.fbWear, t.fbBought, ''].map((h, i) => (
                    <span key={i} className="text-sm font-medium text-muted">
                      {h}
                    </span>
                  ))}
                  {draft.packs.map((p, i) => (
                    <Fragment key={p.id ?? `new-${i}`}>
                      <span className="flex items-center gap-1.5 font-medium">
                        {t.fbPackNo(p.label)}
                        {!p.id && <Chip size="sm">{t.fbNewPack}</Chip>}
                      </span>
                      <Num label={`${t.fbCycles} ${t.fbPackNo(p.label)}`} shown={false} value={p.cycles} limit={{ min: 0, max: 9999 }} onChange={(v) => setPack(i, { cycles: v })} />
                      <Num label={`${t.fbWear} ${t.fbPackNo(p.label)}`} shown={false} value={p.wear} limit={L.wear} unit="%" onChange={(v) => setPack(i, { wear: v })} />
                      <MonthField label={`${t.fbBought} ${t.fbPackNo(p.label)}`} value={p.buyDate} onChange={(v) => setPack(i, { buyDate: v })} />
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={t.fbRetirePack(p.label)}
                        isDisabled={!!edit.archiveLocked}
                        onPress={() => {
                          takePacks.current = true;
                          set({ packs: draft.packs.filter((_, j) => j !== i) });
                        }}
                      >
                        <TrashIcon size={16} />
                      </Button>
                    </Fragment>
                  ))}
                </div>
              </div>
              {edit.archiveLocked && <span className="text-sm text-muted">{edit.archiveLocked}</span>}
              <div>
                <Button
                  variant="outline"
                  isDisabled={edit.full}
                  onPress={() => {
                    takePacks.current = true;
                    set({ packs: [...draft.packs, { label: 0, cycles: 0, wear: 0 }] });
                  }}
                >
                  <PlusIcon size={16} />
                  {t.fbAddPack}
                </Button>
              </div>
            </div>
            {(error || (edit.invalid && edit.dirty)) && <p className="m-0 text-sm text-danger">{error ?? edit.invalid!}</p>}
          </Modal.Body>
          <Modal.Footer className="flex flex-wrap justify-between gap-2">
            <span>
              {!edit.isNew && (
                <Button variant="danger-soft" isDisabled={busy || !!edit.deleteBlocked} onPress={() => setAsk('delete')}>
                  {t.fbDeleteBattery}
                </Button>
              )}
            </span>
            <span className="flex gap-2">
              <Button variant="tertiary" isDisabled={busy} onPress={close}>
                {t.cancel}
              </Button>
              <Button isDisabled={busy || !edit.dirty || !!edit.invalid} onPress={() => change('save')}>
                {busy && <Spinner size="sm" color="current" />}
                {t.save}
              </Button>
            </span>
          </Modal.Footer>
          {edit.deleteBlocked && <p className="m-0 px-6 pb-4 text-sm text-muted">{edit.deleteBlocked}</p>}
        </Modal.Dialog>
      </Modal.Container>
      {ask === 'delete' && (
        <Confirm title={t.fbDeleteTitle(edit.draft.name)} text={t.fbDeleteText(edit.draft.packs.filter((p) => p.id).length)} confirm={t.fbDelete} onConfirm={() => change('delete')} onClose={() => setAsk(undefined)} />
      )}
      {ask === 'discard' && <Confirm title={t.fbDiscardTitle} text={t.fbDiscardText} confirm={t.fbDiscardConfirm} onConfirm={onClose} onClose={() => setAsk(undefined)} />}
    </Modal.Backdrop>
  );
}
