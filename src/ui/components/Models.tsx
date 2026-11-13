import { Button, Checkbox, Chip, Label, ListBox, Modal, NumberField, Select, Spinner, Switch, Table, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import type { ModelDraft, ModelEditView, ModelSummary, ModelsView } from '../../core/flightbag-view.ts';
import { errorText, post } from '../api.ts';
import { usePrefs } from '../usePrefs.ts';
import { Confirm } from './Confirm.tsx';
import { PlusIcon } from './icons.tsx';

type Run = (fn: () => Promise<unknown>) => void;

// The models set up in Lipo Nanny and Wingman, and the dialog to add or change one.
export function Models(props: { volume: string; view: ModelsView; run: Run; notify: (title: string) => void; reload: () => void }) {
  const { volume, view, run, notify, reload } = props;
  const { t } = usePrefs();
  const [editing, setEditing] = useState<{ file?: string }>();

  if (view.broken) return <p className="m-0 text-warning">{t.fbBroken}</p>;

  const configured = view.list.filter((m) => m.configured);
  const free = view.list.filter((m) => !m.configured);
  const mods = (m: ModelSummary) => {
    const on = view.modules.filter((x) => m.mods?.[x.key] !== false).map((x) => x.label);
    return on.length ? on.join(', ') : t.fbNone;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 max-w-2xl text-sm text-muted">{t.fbModelsIntro}</p>
        <Button isDisabled={free.length === 0} onPress={() => setEditing({})}>
          <PlusIcon size={16} />
          {t.fbAddModel}
        </Button>
      </div>
      {view.wingmanBroken && <p className="m-0 text-warning">{t.fbWingmanBroken}</p>}
      {configured.length === 0 && <p className="m-0 text-muted">{t.fbNoModels}</p>}
      {configured.length > 0 && (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label={t.fbPages.models} onRowAction={(k) => setEditing({ file: String(k) })} className="whitespace-nowrap">
              <Table.Header>
                <Table.Column isRowHeader>{t.fbModel}</Table.Column>
                {view.lipo ? <Table.Column>{t.fbBattery}</Table.Column> : null}
                {view.lipo ? <Table.Column>{t.fbModelBatteries}</Table.Column> : null}
                {view.lipo ? <Table.Column>{t.fbSensors}</Table.Column> : null}
                {view.wingman ? <Table.Column className="w-full">{t.fbInWingman}</Table.Column> : <Table.Column className="w-full">{''}</Table.Column>}
                <Table.Column className="w-0">
                  <span className="sr-only">{t.colActions}</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {configured.map((m) => (
                  <Table.Row key={m.file} id={m.file} textValue={m.name} className="cursor-pointer">
                    <Table.Cell>
                      <span className="flex items-center gap-2 font-medium">
                        {m.name}
                        {m.active && (
                          <Chip size="sm" variant="soft" color="success">
                            {t.fbActiveModel}
                          </Chip>
                        )}
                        {!m.onCard && (
                          <Chip size="sm" variant="soft" color="warning">
                            {t.fbNotOnCard}
                          </Chip>
                        )}
                      </span>
                    </Table.Cell>
                    {view.lipo ? <Table.Cell>{m.cells !== undefined ? `${m.cells}S${m.parallel ? `, ${t.fbParallelShort}` : ''}` : '–'}</Table.Cell> : null}
                    {view.lipo ? <Table.Cell className="text-muted">{m.batteries?.length ? m.batteries.join(', ') : '–'}</Table.Cell> : null}
                    {view.lipo ? <Table.Cell className="text-muted">{m.customSensors ? t.fbCustom : t.fbGeneral}</Table.Cell> : null}
                    <Table.Cell className="text-muted">{view.wingman ? mods(m) : ''}</Table.Cell>
                    <Table.Cell>
                      <Button size="sm" variant="ghost" aria-label={`${t.fbEditModel}: ${m.name}`} onPress={() => setEditing({ file: m.file })}>
                        {t.fbEditModel}
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
      {editing && (
        <ModelDialog
          volume={volume}
          file={editing.file}
          free={free}
          run={run}
          onClose={() => setEditing(undefined)}
          onDone={(title) => {
            setEditing(undefined);
            notify(title);
            reload();
          }}
        />
      )}
    </div>
  );
}

// The model as changed in the dialog: the page logic on the server answers with the batteries that fit, the
// model's sensors and what saving would take out of it.
function ModelDialog(props: { volume: string; file?: string; free: ModelSummary[]; run: Run; onClose: () => void; onDone: (title: string) => void }) {
  const { volume, free, run, onClose, onDone } = props;
  const { t, lang } = usePrefs();
  const [file, setFile] = useState(props.file ?? free.find((m) => m.active)?.file ?? free[0]?.file);
  const [draft, setDraft] = useState<ModelDraft>();
  const [edit, setEdit] = useState<ModelEditView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'delete' | 'discard' | 'drop'>();
  const asked = useRef(0);

  useEffect(() => {
    if (!file) return;
    const n = ++asked.current;
    const timer = setTimeout(
      () => {
        post<ModelEditView>('/api/flightbag/model', { volume, file, draft, lang }).then(
          (e) => {
            if (n !== asked.current) return;
            setEdit(e);
            setError(undefined);
            if (!draft) setDraft(e.draft);
          },
          (e: unknown) => n === asked.current && setError(errorText(t, e)),
        );
      },
      draft ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [volume, file, draft, t, lang]);

  const change = (action: 'save' | 'delete') =>
    run(async () => {
      setBusy(true);
      try {
        const r = await post<{ problem?: string }>('/api/flightbag/model', { volume, file, draft, action, lang });
        if (r.problem) setError(r.problem);
        else onDone(action === 'save' ? t.fbModelSaved : t.fbModelDeleted);
      } finally {
        setBusy(false);
      }
    });

  if (!draft || !edit) return null;
  const set = (p: Partial<ModelDraft>) => setDraft({ ...draft, ...p });
  const dirty = edit.dirty || edit.isNew;
  const close = () => (edit.dirty ? setAsk('discard') : onClose());
  const drops = [
    edit.otherCells ? t.fbOtherCells(t.fbDropped(edit.otherCells)) : '',
    edit.smallProfiles ? t.fbSmallProfiles(t.fbDropped(edit.smallProfiles)) : '',
  ].filter((x) => x !== '');
  const save = () => (drops.length > 0 ? setAsk('drop') : change('save'));
  const checked = new Set(draft.batteryIds ?? []);
  const sensors = draft.sensors ?? {};

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && close()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="sm:max-w-[46rem]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{edit.isNew ? t.fbAddModel : `${t.fbEditModel}: ${edit.name}`}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-6">
            {!props.file && (
              <Select
                variant="secondary"
                className="w-64"
                selectedKey={file ?? null}
                onSelectionChange={(k) => {
                  if (k === null) return;
                  setFile(String(k));
                  setDraft(undefined);
                  setEdit(undefined);
                }}
              >
                <Label>{t.fbModel}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className="field-list">
                  <ListBox>
                    {free.map((m) => (
                      <ListBox.Item key={m.file} id={m.file} textValue={m.name}>
                        {m.name}
                        {m.active ? ` (${t.fbActiveModel})` : ''}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}

            {edit.cellLimit && (
              <section className="flex flex-col gap-4">
                <h3 className="m-0 text-base font-semibold">{t.fbBattery}</h3>
                <div className="flex flex-wrap items-start gap-8">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">{t.fbCells}</span>
                    <div className="flex items-center gap-2">
                      <NumberField
                        aria-label={t.fbCells}
                        variant="secondary"
                        className="w-32"
                        minValue={edit.cellLimit.min}
                        maxValue={edit.cellLimit.max}
                        step={1}
                        value={draft.cells ?? Number.NaN}
                        onChange={(v) => Number.isFinite(v) && set({ cells: v })}
                      >
                        <NumberField.Group>
                          <NumberField.DecrementButton />
                          <NumberField.Input />
                          <NumberField.IncrementButton />
                        </NumberField.Group>
                      </NumberField>
                      <span className="text-sm text-muted">S</span>
                    </div>
                  </div>
                  <div className="flex max-w-sm flex-col gap-1">
                    <Switch isSelected={draft.parallel === true} onChange={(v) => set({ parallel: v })}>
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Label>{t.fbParallel}</Label>
                      </Switch.Content>
                    </Switch>
                    <span className="text-sm text-muted">{t.fbParallelHint}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t.fbModelBatteries}</span>
                  <span className="text-sm text-muted">{t.fbModelBatteriesText(draft.cells ?? 0)}</span>
                  {(edit.assign ?? []).length === 0 && <span className="text-sm">{t.fbNoMatching(draft.cells ?? 0)}</span>}
                  {(edit.assign ?? []).map((b) => (
                    <Checkbox
                      variant="secondary"
                      key={b.id}
                      isSelected={checked.has(b.id)}
                      isDisabled={!b.selectable && !checked.has(b.id)}
                      onChange={(on) => set({ batteryIds: on ? [...(draft.batteryIds ?? []), b.id] : (draft.batteryIds ?? []).filter((x) => x !== b.id) })}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <Label>
                          {b.name} <span className="text-muted">· {t.fbPackCount(b.packs)}</span>
                        </Label>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                  {drops.map((d) => (
                    <span key={d} className="text-sm text-warning">
                      {d}
                    </span>
                  ))}
                  {edit.parallelInvalid && <span className="text-sm text-danger">{edit.parallelProblem}</span>}
                </div>
              </section>
            )}

            {edit.sensors && (
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold">{t.fbSensors}</h3>
                  {edit.customSensors && (
                    <Button size="sm" variant="outline" onPress={() => set({ sensors: {} })}>
                      {t.fbUseDefaultSensors}
                    </Button>
                  )}
                </div>
                <span className="text-sm text-muted">{t.fbSensorsText}</span>
                <div className="flex flex-col divide-y divide-separator">
                  {edit.sensors.map((f) => {
                    const label = f.label;
                    const value = sensors[f.key] ?? '';
                    const setValue = (v: string) => {
                      const next = { ...sensors };
                      if (v === '') delete next[f.key];
                      else next[f.key] = v;
                      set({ sensors: next });
                    };
                    // a stored name the model's file no longer has stays choosable
                    const options = value && !f.unit && !f.options.includes(value) ? [value, ...f.options] : f.options;
                    return (
                      <div key={f.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
                        <div className="flex min-w-60 flex-1 flex-col gap-0.5">
                          <span className="font-medium">{label}</span>
                          {f.desc && <span className="text-sm text-muted">{f.desc}</span>}
                        </div>
                        {f.unit ? (
                          <ToggleButtonGroup
                            aria-label={label}
                            selectionMode="single"
                            disallowEmptySelection
                            selectedKeys={[value === 'pct' ? 'pct' : 'mah']}
                            onSelectionChange={(k) => setValue([...k][0] === 'pct' ? 'pct' : '')}
                          >
                            <ToggleButton id="mah">{t.fbMahUsed}</ToggleButton>
                            <ToggleButton id="pct">{t.fbPctLeft}</ToggleButton>
                          </ToggleButtonGroup>
                        ) : (
                          <Select aria-label={label} variant="secondary" className="w-48" selectedKey={value === '' ? '' : `s:${value}`} onSelectionChange={(k) => k !== null && setValue(String(k).replace(/^s:/, ''))}>
                            <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover className="field-list">
                              <ListBox>
                                <ListBox.Item id="" textValue={t.fbSensorDefault(f.default ?? '')}>
                                  {t.fbSensorDefault(f.default ?? '')}
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                                {options.map((o) => (
                                  <ListBox.Item key={o} id={`s:${o}`} textValue={o}>
                                    {o}
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {edit.modules && (
              <section className="flex flex-col gap-3">
                <h3 className="m-0 text-base font-semibold">{t.fbShowInWingman}</h3>
                <span className="text-sm text-muted">{t.fbShowInWingmanText}</span>
                <div className="flex flex-col divide-y divide-separator">
                  {edit.modules.map((m) => {
                    const label = m.label;
                    return (
                      <div key={m.key} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
                        <div className="flex min-w-60 flex-1 flex-col gap-0.5">
                          <span className="font-medium">{label}</span>
                          {m.desc && <span className="text-sm text-muted">{m.desc}</span>}
                        </div>
                        <Switch aria-label={label} isSelected={draft.mods?.[m.key] !== false} onChange={(v) => set({ mods: { ...draft.mods, [m.key]: v } })}>
                          <Switch.Content>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                          </Switch.Content>
                        </Switch>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {error && <p className="m-0 text-sm text-danger">{error}</p>}
          </Modal.Body>
          <Modal.Footer className="flex flex-wrap justify-between gap-2">
            <span>
              {!edit.isNew && (
                <Button variant="danger-soft" isDisabled={busy} onPress={() => setAsk('delete')}>
                  {t.fbDeleteModel}
                </Button>
              )}
            </span>
            <span className="flex gap-2">
              <Button variant="tertiary" isDisabled={busy} onPress={close}>
                {t.cancel}
              </Button>
              <Button isDisabled={busy || !dirty || edit.parallelInvalid === true} onPress={save}>
                {busy && <Spinner size="sm" color="current" />}
                {t.save}
              </Button>
            </span>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
      {ask === 'delete' && <Confirm title={t.fbDeleteModelTitle(edit.name)} text={t.fbDeleteModelText} confirm={t.fbDelete} onConfirm={() => change('delete')} onClose={() => setAsk(undefined)} />}
      {ask === 'drop' && <Confirm title={t.fbDropTitle} text={drops.join(' ')} confirm={t.save} onConfirm={() => change('save')} onClose={() => setAsk(undefined)} />}
      {ask === 'discard' && <Confirm title={t.fbDiscardTitle} text={t.fbDiscardText} confirm={t.fbDiscardConfirm} onConfirm={onClose} onClose={() => setAsk(undefined)} />}
    </Modal.Backdrop>
  );
}
