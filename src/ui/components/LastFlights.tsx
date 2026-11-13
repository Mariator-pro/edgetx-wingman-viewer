import { Button, buttonVariants, Card } from '@heroui/react';
import type { LastFlightView } from '../../core/flightbag-view.ts';
import type { FlightView } from '../../server/api.ts';
import { usePrefs } from '../usePrefs.ts';

const MINUTE = 60_000;

// The flight in the app a stored position belongs to: same radio, the radio's clock between its start and a few
// minutes after its landing (GPS Homer stores the position when the telemetry ends).
function matchFlight(e: LastFlightView, board: string, flights: FlightView[]): FlightView | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}$/.test(e.time)) return undefined;
  const at = Date.parse(`${e.date}T${e.time}:00Z`);
  let best: FlightView | undefined;
  for (const f of flights) {
    if (f.deleted || f.board !== board || !f.hasDate) continue;
    const start = Date.parse(`${f.start}Z`);
    if (at >= start - MINUTE && at <= start + f.duration + 10 * MINUTE && (!best || f.start > best.start)) best = f;
  }
  return best;
}

// The last positions GPS Homer stored, newest first, with a link to a map and to the flight in the app.
export function LastFlights(props: { list: LastFlightView[]; board: string; flights?: FlightView[]; notify: (title: string) => void; onOpenFlight: (key: string) => void }) {
  const { list, board, flights, notify, onOpenFlight } = props;
  const { t } = usePrefs();

  const when = (e: LastFlightView) => {
    if (!e.date) return e.time || t.fbNoClock;
    return e.time ? `${e.date} ${e.time}` : e.date;
  };
  const copy = (e: LastFlightView) =>
    void navigator.clipboard.writeText(`${e.latText}, ${e.lonText}`).then(
      () => notify(t.fbCopied),
      () => {},
    );

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-2xl text-sm text-muted">{t.fbFlightsIntro}</p>
      {list.length === 0 && <p className="m-0 text-muted">{t.fbNoLastFlights}</p>}
      {list.map((e, i) => {
        const flight = flights ? matchFlight(e, board, flights) : undefined;
        return (
          <Card key={i}>
            <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <Card.Title>{when(e)}</Card.Title>
                {e.model && <Card.Description>{e.model}</Card.Description>}
              </div>
              <div className="flex flex-wrap gap-2">
                {flight && (
                  <Button variant="outline" onPress={() => onOpenFlight(flight.key)}>
                    {t.fbOpenFlight}
                  </Button>
                )}
                <Button variant="outline" onPress={() => copy(e)}>
                  {t.fbCopyPosition}
                </Button>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer" className={`${buttonVariants({ variant: 'primary' })} no-underline`}>
                    {t.fbOpenMap}
                  </a>
                )}
              </div>
            </Card.Header>
            <Card.Content>
              <span className="text-sm text-muted">{t.fbLastPosition}</span>
              <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted">{t.fbLat}</dt>
                <dd className="m-0 font-mono">{e.latText}</dd>
                <dt className="text-muted">{t.fbLon}</dt>
                <dd className="m-0 font-mono">{e.lonText}</dd>
              </dl>
            </Card.Content>
          </Card>
        );
      })}
    </div>
  );
}
