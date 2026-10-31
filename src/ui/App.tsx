import { Alert, CloseButton, Spinner } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { FlightView, RadioView } from '../server/api.ts';
import { errorText, get, post, postFile, useServer } from './api.ts';
import { Confirm } from './components/Confirm.tsx';
import { Sidebar, type Page } from './components/Sidebar.tsx';
import { FlightsPage } from './pages/FlightsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { ViewerPage } from './pages/ViewerPage.tsx';
import { usePrefs } from './usePrefs.ts';

type Notice = { status: 'success' | 'danger' | 'default'; title: string; text?: string };

export function App() {
  const { state, progress, connected } = useServer();
  const { t } = usePrefs();
  const [page, setPage] = useState<Page>('flights');
  const [flights, setFlights] = useState<FlightView[]>();
  const [flightKey, setFlightKey] = useState<string>();
  const [viewerLabel, setViewerLabel] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [cleaning, setCleaning] = useState<RadioView>();

  // The list again whenever flights, notes or tags change on the server.
  const version = state?.flightsVersion;
  useEffect(() => {
    if (version === undefined) return;
    get<FlightView[]>('/api/flights').then(setFlights, () => {});
  }, [version]);

  const run = (fn: () => Promise<unknown>) => {
    fn().catch((e: unknown) => setNotice({ status: 'danger', title: t.failed, text: errorText(t, e) }));
  };
  const open = (key: string) => {
    setFlightKey(key);
    setPage('viewer');
  };

  return (
    <div className="flex min-h-screen flex-wrap">
      <Sidebar
        state={state}
        progress={progress}
        page={page}
        viewerLabel={flightKey ? viewerLabel : undefined}
        onNavigate={setPage}
        onCleanUp={(r) => {
          if (r.cleanable === 0) setNotice({ status: 'default', title: t.nothingToClean });
          else setCleaning(r);
        }}
        onImport={(file) =>
          run(async () => {
            const { count } = await postFile<{ count: number }>('/api/import', file);
            setNotice(count > 0 ? { status: 'success', title: t.importDone(file.name, count) } : { status: 'default', title: t.importNone(file.name) });
          })
        }
        onAppUpdate={() => run(() => post('/api/app-update'))}
      />
      <main className="box-border flex min-w-0 flex-[999_1_640px] flex-col gap-6 p-7 md:ml-60">
        {!connected && state && (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t.noServer}</Alert.Title>
              <Alert.Description>{t.startServer}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
        {notice && (
          <Alert status={notice.status}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{notice.title}</Alert.Title>
              {notice.text && <Alert.Description>{notice.text}</Alert.Description>}
            </Alert.Content>
            <CloseButton aria-label={t.close} onPress={() => setNotice(undefined)} />
          </Alert>
        )}
        {!state ? (
          <Spinner />
        ) : page === 'viewer' ? (
          <ViewerPage
            flightKey={flightKey}
            refreshKey={version}
            run={run}
            onOpen={setFlightKey}
            onLabel={setViewerLabel}
            notify={(title) => setNotice({ status: 'success', title })}
          />
        ) : page === 'settings' ? (
          <SettingsPage run={run} />
        ) : (
          <FlightsPage flights={flights} run={run} onOpen={open} onSample={() => open('sample')} notify={(title) => setNotice({ status: 'success', title })} />
        )}
      </main>
      {cleaning && (
        <Confirm
          title={t.cleanUpTitle}
          text={t.cleanUpText(cleaning.cleanable)}
          confirm={t.cleanUpConfirm(cleaning.cleanable)}
          onConfirm={() =>
            run(async () => {
              const { count } = await post<{ count: number }>('/api/cleanup', { volume: cleaning.volume });
              setNotice({ status: 'success', title: t.cleanedUp(count) });
            })
          }
          onClose={() => setCleaning(undefined)}
        />
      )}
    </div>
  );
}
