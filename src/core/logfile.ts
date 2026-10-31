import { printable } from './paths.ts';
import type { ModelInfo } from './projects.ts';

export interface Column {
  name: string; // without unit, e.g. RQly
  unit?: string; // from the brackets, e.g. %
}

// A header: the file's own, or one rebuilt from the model file for lines it doesn't fit.
export interface Schema {
  columns: Column[];
  header: string; // as a CSV line, for exporting a single flight
  fromModel: boolean;
}

export interface LogLine {
  t: number; // ms; with Date and Time the radio's local time as if it were UTC, else 10 ms ticks since start
  schema: number;
  cells: string[];
  text: string; // unchanged line, for exporting a single flight
}

export interface LogFile {
  schemas: Schema[];
  lines: LogLine[];
  skipped: number; // lines that fit neither header, cut off or broken
  hasDate: boolean;
}

// EdgeTX's telemetry units (TelemetryUnit 1..29) as it writes them into the header; others get none.
const UNITS = ['', 'V', 'A', 'mA', 'kts', 'm/s', 'f/s', 'kmh', 'mph', 'm', 'ft', '°C', '°F', '%', 'mAh', 'W', 'mW', 'dB', 'rpm', 'g', '°', 'rad', 'ml', 'fOz', 'mlm', 'Hz', 'ms', 'us', 'km', 'dBm'];
const UNIT_CELLS = 38;
// First analog input EdgeTX writes after the sensors (stick names in its canonical form).
const STICKS = new Set(['Rud', 'Ele', 'Thr', 'Ail', 'ST', 'TH']);

export function parseColumn(raw: string): Column {
  const name = printable(raw.trim());
  const m = /^(.*?)\(([^()]*)\)$/.exec(name);
  return m && m[1] !== '' ? { name: m[1]!, unit: m[2] } : { name };
}

// One CSV line as EdgeTX writes it: comma separated, text values in quotes (without escaping).
export function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

function sensorColumn(s: { label: string; unit: number }): string {
  const unit = s.unit === UNIT_CELLS ? 'V' : s.unit > 0 && s.unit < UNITS.length ? UNITS[s.unit] : '';
  return unit ? `${s.label}(${unit.slice(0, 3)})` : s.label;
}

// Header for lines with a different number of columns: the model's logged sensors in their order, around
// them the parts that never change (Date,Time before; sticks, switches, channels, TxBat after).
export function headerFromModel(header: string[], model: ModelInfo): string[] | undefined {
  const prefix = header[0] === 'Date' && header[1] === 'Time' ? 2 : header[0] === 'Time' ? 1 : -1;
  const tail = header.findIndex((h, i) => i >= prefix && STICKS.has(h));
  if (prefix < 0 || tail < 0) return undefined;
  return [...header.slice(0, prefix), ...model.sensors.filter((s) => s.logs).map(sensorColumn), ...header.slice(tail)];
}

function parseTime(cells: string[], hasDate: boolean): number | undefined {
  if (!hasDate) {
    const ticks = Number(cells[0]);
    return Number.isFinite(ticks) && cells[0] !== '' ? ticks * 10 : undefined;
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cells[0] ?? '');
  const t = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(cells[1] ?? '');
  if (!d || !t) return undefined;
  const ms = Number((t[4] ?? '0').padEnd(3, '0'));
  const v = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3]), ms);
  return Number.isFinite(v) ? v : undefined;
}

export function parseLog(text: string, model?: ModelInfo): LogFile {
  const raw = text.split(/\r?\n/);
  const headerCells = splitLine(raw[0] ?? '').map((h) => h.trim());
  const hasDate = headerCells[0] === 'Date' && headerCells[1] === 'Time';
  const schemas: Schema[] = [{ columns: headerCells.map(parseColumn), header: raw[0] ?? '', fromModel: false }];
  const rebuilt = model ? headerFromModel(headerCells, model) : undefined;
  let rebuiltIndex = -1;
  const lines: LogLine[] = [];
  let skipped = 0;
  // Every line ends with a line break; a last one without may be cut off (radio switched off while writing)
  for (let n = 1; n < raw.length; n++) {
    const line = raw[n]!;
    if (n === raw.length - 1) {
      if (line !== '') skipped++;
      break;
    }
    const cells = splitLine(line);
    let schema = -1;
    if (cells.length === headerCells.length) schema = 0;
    else if (rebuilt && cells.length === rebuilt.length) {
      if (rebuiltIndex < 0) {
        rebuiltIndex = schemas.length;
        schemas.push({ columns: rebuilt.map(parseColumn), header: rebuilt.join(','), fromModel: true });
      }
      schema = rebuiltIndex;
    }
    const t = schema >= 0 ? parseTime(cells, hasDate) : undefined;
    if (t === undefined) {
      skipped++;
      continue;
    }
    lines.push({ t, schema, cells, text: line });
  }
  return { schemas, lines, skipped, hasDate };
}
