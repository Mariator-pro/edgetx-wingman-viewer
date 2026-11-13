import { Button, ListBox, Select, Spinner, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useRef } from 'react';
import type { ProgressEvent, RadioView, StateView } from '../../server/api.ts';
import { dateTime } from '../format.ts';
import { LANGUAGES, type Lang } from '../texts.ts';
import { usePrefs, type Theme } from '../usePrefs.ts';
import { BagIcon, ListIcon, MapIcon, MoonIcon, PathIcon, SettingsIcon, SunIcon, UploadIcon } from './icons.tsx';
import { ConnectedRadios } from './ConnectedRadios.tsx';

export type Page = 'flights' | 'viewer' | 'flightbag' | 'settings';

export function Sidebar(props: {
  state?: StateView;
  progress?: ProgressEvent;
  page: Page;
  viewerLabel?: string; // the flight shown in the viewer
  canView: boolean; // a flight is chosen for the viewer
  onNavigate: (page: Page) => void;
  onCleanUp: (radio: RadioView) => void;
  onImport: (file: File) => void;
  onAppUpdate: () => void;
}) {
  const { state, progress, page, viewerLabel, canView, onNavigate, onCleanUp, onImport, onAppUpdate } = props;
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const file = useRef<HTMLInputElement>(null);
  const appUpdate = state?.appUpdate;
  const updatingApp = state?.busy === 'appUpdate';
  const overview = [
    { page: 'flights' as const, label: t.flights, Icon: ListIcon },
    { page: 'viewer' as const, label: t.viewer, Icon: MapIcon, sub: viewerLabel, off: !canView },
    { page: 'flightbag' as const, label: t.flightBag, Icon: BagIcon, off: !state?.radios.length },
    { page: 'settings' as const, label: t.settings, Icon: SettingsIcon },
  ];
  // Always dark: the "dark" class gives its HeroUI controls dark colours in the light theme too.
  // The language list opens outside the sidebar, so it carries the class and its text colour itself.
  // On wide screens it stays in place while long pages scroll, so its bottom row stays visible.
  const item = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left no-underline transition-colors';
  return (
    // fixed on wide windows: always as high as the window, however long the page or a menu below it
    <nav
      aria-label={t.nav}
      className="dark flex flex-[1_1_240px] flex-col gap-6 bg-zinc-900 px-3.5 py-5 text-zinc-200 md:fixed md:inset-y-0 md:left-0 md:z-20 md:w-60 md:overflow-y-auto"
    >
      <div className="flex items-center gap-2.5 px-2">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <PathIcon size={16} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold whitespace-nowrap text-white">{t.appName}</span>
          <span className="text-xs text-zinc-400">v{__APP_VERSION__}</span>
        </span>
      </div>

      {appUpdate && (
        <div className="flex flex-col gap-2 rounded-xl bg-zinc-800 p-3">
          <span className="text-xs text-zinc-300">
            {appUpdate.restarting
              ? t.appRestarting
              : updatingApp
                ? t.appDownloading(progress?.op === 'appUpdate' ? (progress.done ?? 0) : 0)
                : t.appUpdateAvailable(appUpdate.version)}
          </span>
          {appUpdate.installable ? (
            <Button variant="primary" isDisabled={!!state?.busy || appUpdate.restarting} onPress={onAppUpdate}>
              {(updatingApp || appUpdate.restarting) && <Spinner size="sm" color="current" />}
              {t.appUpdateInstall}
            </Button>
          ) : (
            <a href={appUpdate.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent no-underline hover:underline">
              {t.appUpdateDownload}
            </a>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="px-2 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">{t.radioHeading}</span>
        <ConnectedRadios radios={state?.radios} text={t.noRadio}>
          {(radios) =>
            radios.map((r) => (
              <div key={r.volume} className="flex flex-col gap-2 rounded-xl px-2.5 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="size-2 shrink-0 rounded-full bg-green-400" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{r.name}</span>
                    <span className="truncate text-xs text-zinc-400">
                      {state?.busy === 'sync' ? t.copying : r.newFlights > 0 ? t.newFlights(r.newFlights) : t.noNewFlights}
                    </span>
                  </span>
                </div>
                <Button size="sm" variant="outline" className="text-white" isDisabled={!!state?.busy} onPress={() => onCleanUp(r)}>
                  {state?.busy === 'cleanup' && <Spinner size="sm" color="current" />}
                  {t.cleanUp}
                </Button>
              </div>
            ))
          }
        </ConnectedRadios>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="px-2 pb-1.5 text-[11px] font-medium tracking-wider text-zinc-400 uppercase">{t.overview}</span>
        {overview.map(({ page: target, label, Icon, sub, off }) => (
          <button
            key={target}
            type="button"
            disabled={off}
            onClick={() => onNavigate(target)}
            aria-current={page === target ? 'page' : undefined}
            className={`${item} ${page === target ? 'bg-zinc-800 text-white' : off ? 'cursor-default text-zinc-600' : 'hover:bg-zinc-800/60'}`}
          >
            <Icon />
            <span className="flex min-w-0 flex-col">
              {label}
              {sub && <span className="truncate text-xs text-zinc-400">{sub}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <ToggleButtonGroup
            aria-label={t.theme}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([theme])}
            onSelectionChange={(keys) => {
              const v = [...keys][0];
              if (v) setTheme(String(v) as Theme);
            }}
          >
            <ToggleButton id="light" isIconOnly aria-label={t.light}>
              <SunIcon size={16} />
            </ToggleButton>
            <ToggleButton id="dark" isIconOnly aria-label={t.dark}>
              <MoonIcon size={16} />
            </ToggleButton>
          </ToggleButtonGroup>
          <Select aria-label={t.language} className="min-w-0 flex-1" selectedKey={lang} onSelectionChange={(k) => k !== null && setLang(String(k) as Lang)}>
            <Select.Trigger className="rounded-3xl border-0 bg-default shadow-none hover:bg-default-hover data-[hovered=true]:bg-default-hover">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="field-list dark text-foreground">
              <ListBox>
                {LANGUAGES.map((l) => (
                  <ListBox.Item key={l.id} id={l.id} textValue={l.name}>
                    {l.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-zinc-800 p-3">
          <span className="text-xs text-balance text-zinc-400">{state?.lastSync ? t.lastCopied(dateTime(state.lastSync).replaceAll(' ', '\u00a0')) : t.notCopied}</span>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onImport(f);
            }}
          />
          <Button variant="outline" className="text-white" isDisabled={!!state?.busy} onPress={() => file.current?.click()}>
            <UploadIcon size={16} />
            {t.importLog}
          </Button>
        </div>
      </div>
    </nav>
  );
}
