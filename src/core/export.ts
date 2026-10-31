import { realTime, type AnalysedLog, type FlightInfo } from './analysis.ts';
import { FIX_LOSS_MS, linkUp, validFix } from './flights.ts';
import type { Sample } from './roles.ts';

export type ExportFormat = 'gpx' | 'kml' | 'csv';
export const FORMATS: ExportFormat[] = ['gpx', 'kml', 'csv'];
const CREATOR = 'EdgeTX Wingman Viewer';
const FT = 0.3048;

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// "2026-10-30 17:15:52" in the radio's time.
export function localStamp(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function exportName(a: AnalysedLog, f: FlightInfo, format: ExportFormat): string {
  const base = (a.model || 'flight').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '') || 'flight';
  const when = a.log.hasDate ? localStamp(f.start).replace(' ', '-').replace(/:/g, '') : `${a.file.replace(/\.csv$/i, '')}-${f.n}`;
  return `${base}-${when}.${format}`;
}

interface Point {
  lat: number;
  lon: number;
  alt?: number; // m
  t: number;
}

// The flight path in segments: a fix missing for 3 s or more breaks the line.
export function track(a: AnalysedLog, f: FlightInfo): Point[][] {
  const segments: Point[][] = [];
  let seg: Point[] = [];
  let lastFix: number | undefined;
  const toM = a.altUnit === 'ft' ? FT : 1;
  for (let i = f.first; i <= f.last; i++) {
    const s: Sample = a.samples[i]!;
    if (!linkUp(s) || !validFix(s, a.minSats)) continue;
    if (lastFix !== undefined && s.t - lastFix >= FIX_LOSS_MS && seg.length > 0) {
      segments.push(seg);
      seg = [];
    }
    lastFix = s.t;
    seg.push({ lat: s.lat!, lon: s.lon!, alt: s.values.alt !== undefined ? s.values.alt * toM : undefined, t: s.t });
  }
  if (seg.length > 0) segments.push(seg);
  return segments;
}

function title(a: AnalysedLog, f: FlightInfo): string {
  return a.log.hasDate ? `${a.model} ${localStamp(f.start)}` : `${a.model} ${a.file} #${f.n}`;
}

export function toGpx(a: AnalysedLog, f: FlightInfo): string {
  const time = (t: number) => (a.log.hasDate ? `<time>${realTime(t).toISOString()}</time>` : '');
  const segs = track(a, f)
    .map((seg) => {
      const pts = seg.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}">${p.alt !== undefined ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}${time(p.t)}</trkpt>`);
      return `    <trkseg>\n${pts.join('\n')}\n    </trkseg>`;
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${CREATOR}" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata><name>${xml(title(a, f))}</name>${time(f.start)}</metadata>`,
    `  <trk>`,
    `    <name>${xml(title(a, f))}</name>`,
    segs,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

// KML with a time track (gx:Track), so programs with a time slider can play the flight; without a date
// in the log a plain line.
export function toKml(a: AnalysedLog, f: FlightInfo): string {
  const segs = track(a, f);
  const hasAlt = segs.some((s) => s.some((p) => p.alt !== undefined));
  const mode = hasAlt ? 'relativeToGround' : 'clampToGround';
  const coord = (p: Point) => `${p.lon} ${p.lat} ${(p.alt ?? 0).toFixed(1)}`;
  const parts = segs.map((seg) =>
    a.log.hasDate
      ? [
          '      <gx:Track>',
          `        <altitudeMode>${mode}</altitudeMode>`,
          ...seg.map((p) => `        <when>${realTime(p.t).toISOString()}</when>`),
          ...seg.map((p) => `        <gx:coord>${coord(p)}</gx:coord>`),
          '      </gx:Track>',
        ].join('\n')
      : `      <LineString><altitudeMode>${mode}</altitudeMode><coordinates>${seg.map((p) => coord(p).replace(/ /g, ',')).join(' ')}</coordinates></LineString>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    '  <Document>',
    `    <name>${xml(title(a, f))}</name>`,
    '    <Placemark>',
    `      <name>${xml(title(a, f))}</name>`,
    a.log.hasDate ? '      <gx:MultiTrack>' : '      <MultiGeometry>',
    ...parts,
    a.log.hasDate ? '      </gx:MultiTrack>' : '      </MultiGeometry>',
    '    </Placemark>',
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

// The header and exactly the lines of the flight, unchanged; where the lines change to another header
// (sensor added while logging), that header is written before them.
export function toCsv(a: AnalysedLog, f: FlightInfo): string {
  const out: string[] = [];
  let schema = -1;
  for (let i = f.first; i <= f.last; i++) {
    const line = a.log.lines[a.samples[i]!.i]!;
    if (line.schema !== schema) {
      schema = line.schema;
      out.push(a.log.schemas[schema]!.header);
    }
    out.push(line.text);
  }
  return out.join('\n') + '\n';
}

export function exportFlight(a: AnalysedLog, f: FlightInfo, format: ExportFormat): string {
  return format === 'gpx' ? toGpx(a, f) : format === 'kml' ? toKml(a, f) : toCsv(a, f);
}
