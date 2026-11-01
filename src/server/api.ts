// Shapes the server sends to the browser interface, shared by both sides; imports only Node-free code,
// so the interface's type check doesn't pull in Node code.
import type { Airframe, EventKind, HintKind, StickMode, Track } from '../core/kinds.ts';

export interface RadioView {
  volume: string;
  board: string;
  name: string;
  newFlights: number; // copied from this card since it was connected
  cleanable: number; // logs on the card with the same copy in the app
}

// A newer release of the desktop app.
export interface AppUpdateView {
  version: string; // without "v"
  url: string; // its release page
  installable: boolean; // the app installs it itself (Windows, Linux); macOS only links to the download
  restarting?: boolean;
}

export interface StateView {
  radios: RadioView[];
  busy?: string;
  lastSync?: string; // ISO
  flightsVersion: number; // goes up when flights, notes or tags change, so the interface loads them again
  appUpdate?: AppUpdateView;
}

export interface ProgressEvent {
  op: string;
  text: string; // English, for the log
  done?: number;
  total?: number;
}

// The pack of a flight: its number from Lipo Nanny's sensor, the rest from Lipo Nanny's settings when they know it.
export interface PackView {
  n: number;
  battery?: string;
  label?: string; // number within the battery
  chemistry?: string;
  cells?: number;
  capacity?: number; // mAh
  cycles?: number;
  wear?: number; // %
  lastUsed?: string; // YYYY-MM-DD
  retired?: boolean;
}

// One flight in the list. Times are the radio's local time as "2026-10-30T17:45:44".
export interface FlightView {
  key: string;
  board: string;
  radio: string; // name of the radio type, or "imported"
  file: string;
  model: string;
  start: string;
  hasDate: boolean;
  duration: number; // ms, takeoff to landing
  maxDistance?: number; // m
  maxAlt?: number; // in altUnit
  altUnit?: string;
  hints: number;
  pack?: PackView;
  note?: string;
  tags: string[];
  deleted?: string; // ISO, when it was deleted
}

export interface FlightDetailView extends FlightView {
  events: { t: string; kind: EventKind }[];
  hintList: { t: string; kind: HintKind }[];
  skipped: number; // lines of the log the app couldn't read
  prev?: string; // keys of the neighbours in the list
  next?: string;
  sample?: boolean;
}

// The flight on the map and the timeline; times in seconds from the flight's first log line.
export interface TrackView extends Track {
  key: string;
  start: string; // time of the first log line
  duration: number; // s, to the last line
  takeoff: number;
  landing: number;
  events: { t: number; kind: EventKind }[];
  hints: { t: number; kind: HintKind }[];
  airframe?: Airframe; // kind of model for the attitude view, chosen per model and radio
}

// Where the map gets its tiles from; the street map's address can be changed, satellite needs the user's own key.
// The open source licenses of the bundled packages, as the build wrote them.
export interface LicensesView {
  text: string;
}

export interface MapSettingsView {
  tiles: string;
  defaultTiles: string;
  arcgisKey?: string;
}

export type ExportFormat = 'gpx' | 'kml' | 'csv';

export const TOKEN_HEADER = 'x-wingman-viewer-token';
export const TOKEN_HASH = 'token';
export const TOKEN_META = 'wingman-viewer-token';
export const FILE_NAME_HEADER = 'x-file-name';

// Language and theme, kept by the server: the port changes with every start, and the browser keeps
// what a page stores per port, so it would forget them.
export interface PrefsView {
  lang?: string;
  theme?: 'light' | 'dark';
  sticks?: StickMode; // stick mode for logs without the radio's settings
}
export const PREFS_META = 'wingman-viewer-prefs';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// The page gets the stored choices, so it starts with them, and under Vite the key.
export const withPageData = (html: string, prefs: PrefsView, token?: string) =>
  html.replace(
    '</head>',
    `${token ? `<meta name="${TOKEN_META}" content="${token}" />\n` : ''}<meta name="${PREFS_META}" content="${attr(JSON.stringify(prefs))}" />\n</head>`,
  );
