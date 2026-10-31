import type { FlightView } from '../server/api.ts';
import type { Texts } from './texts.ts';

// Times from the server are the radio's local time without zone ("2026-10-30T17:45:44"); the browser
// reads them as local time, which is what the pilot saw.
export const localDate = (stamp: string) => new Date(stamp);

export function dateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function day(stamp: string, locale: string): string {
  return localDate(stamp).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function time(stamp: string, locale: string, seconds = false): string {
  return localDate(stamp).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}

// 1:16 or 1:02:05
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function distance(m: number | undefined, locale: string): string {
  if (m === undefined) return '–';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

export function altitude(v: number | undefined, unit: string | undefined): string {
  if (v === undefined) return '–';
  return `${Math.round(v)} ${unit ?? ''}`.trim();
}

// Seconds since takeoff, for events: "+1:23"
export function since(stamp: string, start: string): string {
  const ms = localDate(stamp).getTime() - localDate(start).getTime();
  return `${ms < 0 ? '−' : '+'}${duration(Math.abs(ms))}`;
}

export const radioLabel = (t: Texts, f: FlightView) => (f.board === 'imported' ? t.imported : f.radio);

export const flightLabel = (t: Texts, f: FlightView) =>
  f.hasDate ? `${f.model}, ${day(f.start, t.locale)} ${time(f.start, t.locale)}` : `${f.model}, ${f.file}`;

// Seconds as "04:46"
export const clockText = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
