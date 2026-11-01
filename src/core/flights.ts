import type { EventKind } from './kinds.ts';
import type { Sample } from './roles.ts';

export type { EventKind } from './kinds.ts';

// The rules Wingman and GPS Homer use on the radio, so the viewer reports the same.
export const LINK_LOSS_MS = 1500; // telemetry gap before the link counts as lost
export const ENDED_HOLD_MS = 30000; // link back within this after a loss while armed: the same flight goes on
export const TIME_JUMP_MS = 30000; // gap between two log lines that starts a new flight
export const MIN_FLIGHT_MS = 30000; // logs without arming state: shorter sections are no flight
export const FIX_LOSS_MS = 3000; // a fix missing this long counts as lost
export const DEFAULT_MIN_SATS = 6;

export interface FlightEvent {
  t: number;
  kind: EventKind;
}

export interface Flight {
  first: number; // index of the first sample (start of the preflight)
  last: number; // index of the last sample with telemetry
  events: FlightEvent[]; // sorted by time
}

// Link up: link quality and signal strength not both 0 (a signal in dBm is never 0); without either column,
// any line counts as up.
export function linkUp(s: Sample): boolean {
  const { lq, rssi1 } = s.values;
  if (lq === undefined && rssi1 === undefined) return true;
  return (lq ?? 0) !== 0 || (rssi1 ?? 0) !== 0;
}

// Disarmed marker in the flight mode text: Betaflight appends * ! ?, ArduPilot *, INAV sends OK / WAIT / !ERR.
// "!FS!" (failsafe) is armed despite its "!".
const INAV_DISARMED = new Set(['OK', 'WAIT', '!ERR']);
// The flight controller's firmware from a disarmed flight mode text, as GPS Homer tells it: Betaflight appends
// "!" or "?" (only it does), INAV sends OK / WAIT / !ERR, ArduPilot appends "*" to its own mode names; names both
// Betaflight and ArduPilot use don't tell.
const BF_NAMES_NOT_AP = new Set(['ANGL', 'HOR', 'AIR', 'RTH', 'PASS', 'PHFL', 'CHIR']);
const BF_NAMES_ALSO_AP = new Set(['ACRO', 'ALTH', 'POSH', 'STAB', 'MANU']);
export function fcFromFM(fm: string | undefined): 'BF' | 'INAV' | 'AP' | undefined {
  if (fm === undefined || fm.length < 2) return undefined;
  if (INAV_DISARMED.has(fm)) return 'INAV';
  const last = fm.slice(-1);
  const name = fm.slice(0, -1);
  if ((last === '!' || last === '?') && fm !== '!FS!') return 'BF';
  if (last !== '*') return undefined;
  if (BF_NAMES_NOT_AP.has(name)) return 'BF';
  if (BF_NAMES_ALSO_AP.has(name)) return undefined;
  return 'AP';
}

export function fmDisarmed(fm: string): boolean {
  if (fm === '!FS!') return false;
  if (INAV_DISARMED.has(fm)) return true;
  return /[*!?]$/.test(fm);
}

// Failsafe, return to home and landing modes from the flight mode text.
const ALERTS: Record<string, 'failsafe' | 'rth' | 'land'> = {
  '!FS!': 'failsafe',
  RTH: 'rth',
  WRTH: 'rth',
  'RTL ': 'rth',
  SRTL: 'rth',
  ARTL: 'rth',
  QRTL: 'rth',
  LAND: 'land',
  ALND: 'land',
  QLND: 'land',
  L2QL: 'land',
};
export const alertOf = (fm: string | undefined) => (fm !== undefined && Object.hasOwn(ALERTS, fm) ? ALERTS[fm] : undefined);

// The arming state is only known from a flight mode text that once showed a disarmed marker; without one
// (no FM column, or a setup that never sends the marker) each section with telemetry counts as the flight.
export function knowsArming(samples: Sample[]): boolean {
  return samples.some((s) => s.fm !== undefined && fmDisarmed(s.fm));
}

// Lines in a row without a jump in time of more than 30 s (or backwards).
function blocks(samples: Sample[]): Sample[][] {
  const out: Sample[][] = [];
  for (const s of samples) {
    const block = out[out.length - 1];
    const prev = block?.[block.length - 1];
    if (!block || !prev || s.t - prev.t > TIME_JUMP_MS || s.t < prev.t) out.push([s]);
    else block.push(s);
  }
  return out;
}

// Wingman's phases per block: waiting (no link), preflight (link up), flight (armed), ended (link lost).
// A loss while armed is a link failure: back within 30 s, the same flight goes on.
function flightsOfBlock(block: Sample[], samples: Sample[], arming: boolean): Flight[] {
  const flights: Flight[] = [];
  let phase: 'waiting' | 'pre' | 'flight' | 'ended' = 'waiting';
  let lostSince: number | undefined;
  let lossStart = 0;
  let endedAt = 0;
  let linkFailure = false;
  let preStart = 0;
  let lastUp = -1;
  let armed = false;
  let wasArmed = false;
  let disarmSeen = false;
  let current: Flight | undefined;

  const close = (failure: boolean) => {
    wasArmed = false;
    if (!current) return;
    current.last = lastUp;
    if (failure && arming) current.events.push({ t: lossStart, kind: 'link-lost' });
    if (!arming) current.events.push({ t: samples[lastUp]!.t, kind: 'landing' });
    const span = samples[current.last]!.t - samples[current.first]!.t;
    if (arming || span >= MIN_FLIGHT_MS) flights.push(current);
    current = undefined;
  };

  for (const s of block) {
    const up = linkUp(s);
    if (up) {
      lostSince = undefined;
      if (!arming) armed = true;
      else if (s.fm === undefined) armed = false;
      else if (fmDisarmed(s.fm)) {
        disarmSeen = true;
        armed = false;
      } else armed = disarmSeen;
    } else lostSince ??= s.t;
    const lost = !up && s.t - lostSince! >= LINK_LOSS_MS;

    if (phase === 'waiting' && up) {
      phase = 'pre';
      preStart = s.i;
    }
    if (phase === 'waiting') {
      // nothing until the link is up
    } else if (phase === 'pre') {
      if (lost) {
        phase = 'waiting';
        disarmSeen = false;
        wasArmed = false;
      } else if (up && armed) {
        phase = 'flight';
        current = { first: preStart, last: s.i, events: [] };
      }
    } else if (phase === 'flight') {
      if (lost) {
        phase = 'ended';
        endedAt = s.t;
        lossStart = lostSince!;
        linkFailure = wasArmed;
        if (!linkFailure) disarmSeen = false;
      }
    } else if (up && linkFailure) {
      phase = 'flight';
      current!.events.push({ t: lossStart, kind: 'link-lost' }, { t: s.t, kind: 'link-back' });
    } else if (up) {
      close(false);
      phase = armed ? 'flight' : 'pre';
      preStart = s.i;
      if (armed) current = { first: s.i, last: s.i, events: [] };
    } else if (s.t - endedAt >= ENDED_HOLD_MS) {
      close(linkFailure);
      phase = 'waiting';
      disarmSeen = false;
    }

    if (up && phase === 'flight' && current) {
      if (armed && !wasArmed) current.events.push({ t: s.t, kind: 'takeoff' });
      if (!armed && wasArmed && arming) current.events.push({ t: s.t, kind: 'landing' });
    }
    if (up) {
      wasArmed = armed;
      lastUp = s.i;
    }
  }
  close(phase === 'ended' && linkFailure);
  return flights;
}

// GPS Homer's valid fix: a position, not 0/0, in range, and enough satellites when the log has them.
export function validFix(s: Sample, minSats: number): boolean {
  const { lat, lon } = s;
  if (lat === undefined || lon === undefined) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) return false;
  return s.values.sats === undefined || s.values.sats >= minSats;
}

// Failsafe, RTH and landing mode on entering them; GPS lost after 3 s without a fix (only after a first fix,
// and only while the link is up: without telemetry the position is missing for another reason).
function modeAndGpsEvents(f: Flight, samples: Sample[], minSats: number): FlightEvent[] {
  const events: FlightEvent[] = [];
  let alert: string | undefined;
  let hadFix = false;
  let fixLostSince: number | undefined;
  let fixLost = false;
  for (let i = f.first; i <= f.last; i++) {
    const s = samples[i]!;
    if (!linkUp(s)) continue;
    const a = alertOf(s.fm);
    if (a !== undefined && a !== alert) events.push({ t: s.t, kind: a });
    alert = a;
    if (validFix(s, minSats)) {
      if (fixLost) events.push({ t: s.t, kind: 'gps-back' });
      hadFix = true;
      fixLostSince = undefined;
      fixLost = false;
    } else if (hadFix && !fixLost) {
      fixLostSince ??= s.t;
      if (s.t - fixLostSince >= FIX_LOSS_MS) {
        fixLost = true;
        events.push({ t: fixLostSince, kind: 'gps-lost' });
      }
    }
  }
  return events;
}

export function splitFlights(samples: Sample[], minSats = DEFAULT_MIN_SATS): Flight[] {
  const arming = knowsArming(samples);
  const flights = blocks(samples).flatMap((b) => flightsOfBlock(b, samples, arming));
  for (const f of flights) {
    f.events.push(...modeAndGpsEvents(f, samples, minSats));
    f.events.sort((a, b) => a.t - b.t);
  }
  return flights;
}
