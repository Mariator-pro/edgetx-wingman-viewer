import { Alert, Button, Modal } from '@heroui/react';
import { useState } from 'react';
import type { AppDetailView } from '../../core/flightbag-view.ts';
import { post, tokenUrl } from '../api.ts';
import { resetText } from '../flightbagTexts.ts';
import { usePrefs } from '../usePrefs.ts';
import { Confirm } from './Confirm.tsx';

type Run = (fn: () => Promise<unknown>) => void;

// The Lua apps on the card as chips with icon, name and version (a warning sign when one needs attention);
// a chip opens the app's details: about, problems, its files and its resets.
export function FlightBagApps(props: {
  volume: string;
  apps: AppDetailView[];
  run: Run;
  notify: (title: string) => void;
  guard: (then: () => void) => void; // asks before unsaved changes on the page are lost
  onDone: () => void;
}) {
  const { volume, apps, run, notify, guard, onDone } = props;
  const { t } = usePrefs();
  const [open, setOpen] = useState<string>();
  const app = apps.find((a) => a.folder === open);
  if (apps.length === 0) return null;
  return (
    <>
      <div role="list" aria-label={t.fbApps} className="flex flex-wrap gap-2">
        {apps.map((a) => (
          <div role="listitem" key={a.folder}>
            <Button variant="tertiary" className="h-auto rounded-2xl py-1.5 pr-3.5 pl-1.5" onPress={() => setOpen(a.folder)}>
              <AppIcon volume={volume} app={a} size={32} />
              <span className="flex flex-col items-start text-left leading-tight">
                <span className="font-semibold">{a.name}</span>
                {a.version && <span className="text-xs font-normal text-muted">v{a.version}</span>}
                {a.sign && <span className="sr-only">{t.fbNeedsAttention}</span>}
              </span>
            </Button>
          </div>
        ))}
      </div>
      {app && (
        <AppDialog
          volume={volume}
          app={app}
          onClose={() => setOpen(undefined)}
          onAction={(reset, label) =>
            guard(() =>
              run(async () => {
                await post('/api/flightbag/action', { volume, app: app.folder, reset });
                notify(t.fbDone(label));
                onDone();
              }),
            )
          }
        />
      )}
    </>
  );
}

function AppIcon({ volume, app, size }: { volume: string; app: AppDetailView; size: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {app.icon ? (
        <img
          src={tokenUrl(`/api/flightbag/icon?volume=${encodeURIComponent(volume)}&app=${encodeURIComponent(app.folder)}`)}
          alt=""
          width={size}
          height={size}
          className="block size-full rounded-lg"
        />
      ) : (
        <span className="flex size-full items-center justify-center rounded-lg bg-zinc-800 font-semibold text-white">{app.name.slice(0, 1)}</span>
      )}
      {app.sign && (
        <svg className="absolute -right-1.5 -bottom-1" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 15 14H1z" fill="#f59e0b" stroke="#18181b" strokeWidth={1} strokeLinejoin="round" />
          <rect x={7.2} y={5.5} width={1.6} height={4.6} rx={0.8} fill="#18181b" />
          <circle cx={8} cy={12} r={0.9} fill="#18181b" />
        </svg>
      )}
    </span>
  );
}

// Flight Bag's line for the small radio screen ("(c) Mariator-pro   GPL-2.0") as a line of text
const about = (s: string) => s.replace(/^\(c\)\s*/i, '© ').replace(/\s{2,}/g, ', ');

// onAction runs the reset with this id, or without one the fix of a missing or damaged settings file
function AppDialog(props: { volume: string; app: AppDetailView; onClose: () => void; onAction: (reset: string | undefined, label: string) => void }) {
  const { volume, app, onClose, onAction } = props;
  const { t } = usePrefs();
  const [ask, setAsk] = useState<{ reset?: string; label: string; title: string; text: string }>();
  const resets = app.resets.map((r) => ({ reset: r.id, ...resetText(r) }));
  const fix = () => {
    const label = app.fixLabel ?? '';
    if (app.fixAsk) setAsk(resetText({ label, ask: app.fixAsk }));
    else onAction(undefined, label);
  };
  return (
    <>
      <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
        <Modal.Container scroll="inside">
          <Modal.Dialog className="sm:max-w-[36rem]">
            <Modal.CloseTrigger />
            <Modal.Header className="flex-row items-center gap-3.5">
              <AppIcon volume={volume} app={{ ...app, sign: false }} size={48} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <Modal.Heading>{app.name}</Modal.Heading>
                <span className="text-sm text-muted">{[app.version ? t.fbVersion(app.version) : '', ...app.about.map(about)].filter(Boolean).join(' · ')}</span>
                {app.url && (
                  <a href={`https://${app.url}`} target="_blank" rel="noreferrer" className="text-sm text-accent no-underline hover:underline">
                    {app.url}
                  </a>
                )}
              </span>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-5">
              {app.problem && (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{app.problem === 'update' ? t.fbUpdateNeeded(app.name) : app.problem === 'noConfig' ? t.fbNoSettings : t.fbDamaged}</Alert.Title>
                    {app.problem !== 'update' && <Alert.Description>{app.problem === 'noConfig' ? t.fbNoSettingsText : t.fbDamagedText}</Alert.Description>}
                  </Alert.Content>
                  {app.fix && app.fixLabel && <Button onPress={fix}>{app.fixLabel}</Button>}
                </Alert>
              )}
              {app.setupErrors.length > 0 && (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t.fbSetupTitle}</Alert.Title>
                    <Alert.Description>
                      <ul className="m-0 pl-4">
                        {app.setupErrors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {app.files.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h3 className="m-0 text-sm font-semibold text-muted">{t.fbFiles}</h3>
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {app.files.map((f) => (
                      <div key={f.label + f.path} className="contents">
                        <dt>{f.label}</dt>
                        <dd className="m-0 font-mono text-[13px] break-all text-muted">{f.path}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {resets.length > 0 && (
                <section className="flex flex-col">
                  <h3 className="m-0 mb-1 text-sm font-semibold text-muted">{t.fbResets}</h3>
                  {resets.map((r) => (
                    <div key={r.reset} className="flex items-center gap-3 border-t border-separator py-2.5 first-of-type:border-t-0">
                      <span className="flex-1 text-sm text-muted">{r.text || r.title}</span>
                      <Button variant="danger-soft" onPress={() => setAsk(r)}>
                        {r.label}
                      </Button>
                    </div>
                  ))}
                </section>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {ask && <Confirm title={ask.title} text={ask.text} confirm={ask.label} onConfirm={() => onAction(ask.reset, ask.label)} onClose={() => setAsk(undefined)} />}
    </>
  );
}
