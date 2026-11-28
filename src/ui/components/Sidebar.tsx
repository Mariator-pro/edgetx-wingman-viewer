import { Button, Spinner, Tooltip } from '@heroui/react';
import { useRef, type ReactNode } from 'react';
import type { ProgressEvent, RadioView, StateView } from '../../server/api.ts';
import { ago, dateTime, useNow } from '../dates.ts';
import { sidebarClass } from '../sidebarLayout.ts';
import { usePrefs } from '../usePrefs.ts';
import { AppUpdateIcon, BagIcon, ListIcon, MapIcon, RadiosIcon, SettingsIcon, TrashIcon, UploadIcon } from './icons.tsx';
import { ConnectedRadios } from './ConnectedRadios.tsx';
import { NavGroup, NavItem, SidebarHeader, ThemeSwitch } from './SidebarParts.tsx';

// "RadioMaster TX16S MK3" below the radio's icon in the collapsed sidebar: "TX16S", the word after the maker.
const shortName = (name: string) => {
  const words = name.split(' ');
  return (words[1] ?? words[0]!).slice(0, 7);
};

export type Page = 'flights' | 'viewer' | 'flightbag' | 'settings';

// An icon button of the collapsed sidebar with its text in a tooltip on the right.
function IconAction(props: { label: string; note?: ReactNode; children: ReactNode; variant: 'primary' | 'outline' | 'ghost'; size?: 'sm'; isDisabled?: boolean; className?: string; onPress: () => void }) {
  const { label, note, children, ...button } = props;
  return (
    <div className="flex justify-center">
      <Tooltip delay={300} closeDelay={0}>
        <Button isIconOnly aria-label={label} {...button}>
          {children}
        </Button>
        <Tooltip.Content placement="right" offset={14}>
          <span className="flex max-w-60 flex-col">
            <span>{label}</span>
            {note && <span className="text-xs text-muted">{note}</span>}
          </span>
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}

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
  const { t, theme, setTheme, sidebarCollapsed: collapsed, toggleSidebar } = usePrefs();
  const now = useNow();
  const file = useRef<HTMLInputElement>(null);
  const appUpdate = state?.appUpdate;
  const updatingApp = state?.busy === 'appUpdate';
  const appUpdateText = appUpdate
    ? appUpdate.restarting
      ? t.appRestarting
      : updatingApp
        ? t.appDownloading(progress?.op === 'appUpdate' ? (progress.done ?? 0) : 0)
        : t.appUpdateAvailable(appUpdate.version)
    : '';
  const copiedText = state?.lastSync ? t.lastCopied(ago(state.lastSync, t.locale, now)) : t.notCopied;
  const overview = [
    { page: 'flights' as const, label: t.flights, Icon: ListIcon },
    { page: 'viewer' as const, label: t.viewer, Icon: MapIcon, sub: viewerLabel, off: !canView },
    { page: 'flightbag' as const, label: t.flightBag, Icon: BagIcon, off: !state?.radios.length },
  ];
  const radioText = (r: RadioView) => (state?.busy === 'sync' ? t.copying : r.newFlights > 0 ? t.newFlights(r.newFlights) : t.noNewFlights);
  return (
    <nav aria-label={t.nav} className={sidebarClass(collapsed)}>
      <SidebarHeader
        collapsed={collapsed}
        onToggle={toggleSidebar}
        name={t.appName}
        version={__APP_VERSION__}
        texts={{ collapse: t.collapseSidebar, expand: t.expandSidebar, ctrl: t.ctrlKey }}
      />

      {appUpdate &&
        (collapsed ? (
          appUpdate.installable ? (
            <IconAction
              variant="primary"
              label={appUpdateText}
              note={!updatingApp && !appUpdate.restarting && t.appUpdateClick}
              isDisabled={!!state?.busy || appUpdate.restarting}
              onPress={onAppUpdate}
            >
              {updatingApp || appUpdate.restarting ? <Spinner size="sm" color="current" /> : <AppUpdateIcon />}
            </IconAction>
          ) : (
            <IconAction variant="ghost" className="text-accent" label={appUpdateText} note={t.appUpdateLink} onPress={() => window.open(appUpdate.url, '_blank', 'noreferrer')}>
              <AppUpdateIcon />
            </IconAction>
          )
        ) : (
          <div className="flex flex-col gap-2 rounded-xl bg-zinc-800 p-3">
            <span className="text-xs text-zinc-300">{appUpdateText}</span>
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
        ))}

      <NavGroup collapsed={collapsed} label={t.radioHeading}>
        {collapsed ? (
          state?.radios.length === 0 ? (
            <NavItem
              collapsed
              active={false}
              icon={
                <span className="text-zinc-500">
                  <RadiosIcon />
                </span>
              }
              label={t.noRadioConnected}
              short={t.sidebarShort.noRadio}
              note={t.noRadio}
              onPress={() => {}}
            />
          ) : (
            state?.radios.map((r) => (
              <div key={r.volume} className="flex flex-col gap-1.5">
                <NavItem
                  collapsed
                  active={false}
                  icon={<RadiosIcon className="text-green-400" />}
                  label={r.name}
                  short={shortName(r.name)}
                  note={radioText(r)}
                  mark={(className) =>
                    r.newFlights > 0 && (
                      // beside the icon, not on it (the shared position is for small dots)
                      <span className={`${className} -top-2! -right-3! grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10.5px] font-bold text-zinc-900`} aria-hidden="true">
                        {r.newFlights}
                      </span>
                    )
                  }
                  onPress={() => onNavigate('flights')}
                />
                <IconAction variant="outline" size="sm" className="text-white" label={t.cleanUp} isDisabled={!!state?.busy} onPress={() => onCleanUp(r)}>
                  {state?.busy === 'cleanup' ? <Spinner size="sm" color="current" /> : <TrashIcon size={14} />}
                </IconAction>
              </div>
            ))
          )
        ) : (
          <ConnectedRadios radios={state?.radios} text={t.noRadio}>
            {(radios) =>
              radios.map((r) => (
                <div key={r.volume} className="flex flex-col gap-2 rounded-xl px-2.5 py-2">
                  <div className="flex items-center gap-2.5">
                    <RadiosIcon className="shrink-0 text-green-400" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{r.name}</span>
                      <span className="truncate text-xs text-zinc-400">{radioText(r)}</span>
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
        )}
      </NavGroup>

      <NavGroup collapsed={collapsed} label={t.overview}>
        {overview.map(({ page: target, label, Icon, sub, off }) => (
          <NavItem
            key={target}
            collapsed={collapsed}
            active={page === target}
            // an entry without a flight or radio stays pale and does nothing
            icon={
              <span className={off ? 'text-zinc-600' : ''}>
                <Icon />
              </span>
            }
            name={label}
            label={
              <span className={`flex min-w-0 flex-col ${off ? 'text-zinc-600' : ''}`}>
                <span className="truncate">{label}</span>
                {sub && <span className="truncate text-xs text-zinc-400">{sub}</span>}
              </span>
            }
            short={t.sidebarShort[target]}
            note={sub}
            onPress={() => {
              if (!off) onNavigate(target);
            }}
          />
        ))}
      </NavGroup>

      <div className="mt-auto flex flex-col gap-3">
        <NavItem collapsed={collapsed} active={page === 'settings'} icon={<SettingsIcon />} label={t.settings} short={t.sidebarShort.settings} onPress={() => onNavigate('settings')} />
        <ThemeSwitch
          collapsed={collapsed}
          theme={theme}
          onChange={setTheme}
          texts={{ theme: t.theme, light: t.light, dark: t.dark, system: t.systemTheme, switchTo: t.switchTheme }}
        />

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
        {collapsed ? (
          <IconAction variant="outline" className="text-white" label={t.importLog} note={copiedText} isDisabled={!!state?.busy} onPress={() => file.current?.click()}>
            <UploadIcon size={16} />
          </IconAction>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl bg-zinc-800 p-3">
            <span className="text-xs text-balance text-zinc-400" title={state?.lastSync && dateTime(state.lastSync, t.locale)}>
              {copiedText}
            </span>
            <Button variant="outline" className="text-white" isDisabled={!!state?.busy} onPress={() => file.current?.click()}>
              <UploadIcon size={16} />
              {t.importLog}
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
