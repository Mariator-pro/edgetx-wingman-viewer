// What the interface shows of a flight (events, hints, the path); kept free of Node code, so the interface can use it.
export type EventKind = 'takeoff' | 'landing' | 'link-lost' | 'link-back' | 'failsafe' | 'rth' | 'land' | 'gps-lost' | 'gps-back';

export type HintKind = 'battery-warning' | 'battery-critical' | 'link-warning' | 'link-critical' | 'max-altitude' | 'max-distance' | 'gps-lost';

// Values per log line the map and the timeline show; without telemetry (link down) null.
export const TRACK_VALUES = ['alt', 'gspd', 'vspd', 'hdg', 'dist', 'lq', 'rssi1', 'rssi2', 'volt', 'curr', 'capa', 'fuel', 'sats'] as const;
export type TrackValue = (typeof TRACK_VALUES)[number];

// One point of the drawn path: seconds from the first line, position, height above home in m,
// course in degrees and the log line it belongs to (for its values).
export type PathPoint = [t: number, lon: number, lat: number, h: number, course: number, row: number];

// Stick inputs EdgeTX writes in every log, -1024 to 1024.
export const STICKS = ['rud', 'ele', 'thr', 'ail'] as const;
export type Stick = (typeof STICKS)[number];
// EdgeTX's stick modes: 2 has throttle on the left, 1 on the right; 3 and 4 swap rudder and aileron
export type StickMode = 1 | 2 | 3 | 4;
export const isStickMode = (v: unknown): v is StickMode => v === 1 || v === 2 || v === 3 || v === 4;

// Another sensor column of the log, with its name and unit as there.
export interface ExtraValue {
  name: string;
  unit?: string;
  values: (number | null)[];
}

export interface Track {
  rows: { t: number[]; values: Partial<Record<TrackValue, (number | null)[]>>; fm?: (number | null)[] };
  modes: string[]; // flight mode texts, fm holds their index
  units: Partial<Record<TrackValue, string>>;
  names: Partial<Record<TrackValue | 'fm', string>>; // column names in the log, e.g. GSpd
  sticks?: Partial<Record<Stick, (number | null)[]>>;
  stickMode?: StickMode; // as set on the radio, if its settings are known
  extra?: ExtraValue[]; // the log's other sensors, so every value can be shown
  path: PathPoint[][]; // segments; a fix missing for 3 s or more starts a new one
  home?: [number, number]; // lon, lat
  end?: [number, number];
}
