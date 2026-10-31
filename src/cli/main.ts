#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { AnalysedLog, FlightInfo } from '../core/analysis.ts';
import { exportFlight, exportName, FORMATS, localStamp, type ExportFormat } from '../core/export.ts';
import { paths } from '../core/paths.ts';
import { analyseLogs, findCards, logsAt, storedLogs, syncCard } from '../core/store.ts';
import { listVolumes } from '../platform/volumes.ts';
import { noteServer, runningServer } from '../server/running.ts';
import { startServer } from '../server/server.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

const HELP = `Usage: wingman-viewer <command> [path] [options]

Commands:
  ui        open the app in the browser
  flights   list the flights
  export    save flights as GPX, KML or CSV, every flight unless you pick one with --flight

  path      a log file, a folder of logs or an SD card. Without a path, the commands use
            the logs the app keeps, after copying new ones from a connected SD card.

Options:
  --flight <n>     only this flight (the number from "flights")
  --format <f>     gpx, kml or csv (default gpx)
  --out <folder>   where to save the files (default: the current folder)
`;

class UsageError extends Error {}

interface Listed {
  n: number;
  log: AnalysedLog;
  flight: FlightInfo;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dist(m: number | undefined): string {
  if (m === undefined) return '';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// Copies new logs from connected SD cards, then reads the logs the app keeps; or the logs at a given path.
// notices: also say per file how many lines can't be read (only in the list, not on every export).
async function load(path: string | undefined, notices = false): Promise<Listed[]> {
  let logs: AnalysedLog[];
  if (path !== undefined) {
    const refs = await logsAt(resolve(path));
    if (refs.length === 0) throw new UsageError(`Can't find any logs at ${path}.`);
    logs = await analyseLogs(refs);
  } else {
    const p = paths();
    for (const card of await findCards(await listVolumes())) {
      const r = await syncCard(card, p);
      if (r.newFlights > 0) console.log(`${plural(r.newFlights, 'new flight', 'new flights')} from ${r.board}`);
    }
    logs = await analyseLogs(await storedLogs(p));
  }
  for (const l of notices ? logs : []) {
    if (l.log.skipped > 0) console.log(`${l.file}: ${plural(l.log.skipped, 'line', 'lines')} skipped (cut off, or sensors changed while logging)`);
  }
  const flights = logs.flatMap((log) => log.flights.map((flight) => ({ log, flight })));
  flights.sort((a, b) => a.flight.start - b.flight.start || a.log.file.localeCompare(b.log.file));
  return flights.map((f, i) => ({ n: i + 1, ...f }));
}

function table(rows: string[][], right: Set<number>): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => r.map((cell, c) => (right.has(c) ? cell.padStart(widths[c]!) : cell.padEnd(widths[c]!))).join('  ').trimEnd()).join('\n');
}

async function flights(path: string | undefined): Promise<void> {
  const list = await load(path, true);
  if (list.length === 0) {
    console.log(path === undefined ? 'No flights yet. Connect your radio, or name a log file or folder.' : 'No flights in these logs.');
    return;
  }
  const rows = [['#', 'Model', 'Radio', 'Start', 'Duration', 'Distance', 'Altitude', 'Hints']];
  for (const { n, log, flight: f } of list) {
    rows.push([
      String(n),
      log.model,
      log.board,
      log.log.hasDate ? localStamp(f.start).slice(0, 16) : `${log.file} #${f.n}`,
      duration(f.end - f.start),
      dist(f.maxDistance),
      f.maxAlt === undefined ? '' : `${Math.round(f.maxAlt)} ${log.altUnit ?? ''}`.trim(),
      f.hints.length > 0 ? String(f.hints.length) : '',
    ]);
  }
  console.log(table(rows, new Set([0, 4, 5, 6, 7])));
}

async function exportFlights(path: string | undefined, opts: { flight?: string; format?: string; out?: string }): Promise<void> {
  const format = (opts.format ?? 'gpx').toLowerCase() as ExportFormat;
  if (!FORMATS.includes(format)) throw new UsageError('Use gpx, kml or csv for --format.');
  const list = await load(path);
  let chosen = list;
  if (opts.flight !== undefined) {
    const n = Number(opts.flight);
    chosen = list.filter((f) => f.n === n);
    if (chosen.length === 0) throw new UsageError(`There is no flight ${opts.flight}. Run "wingman-viewer flights" to see the numbers.`);
  }
  if (chosen.length === 0) {
    console.log('No flights to save.');
    return;
  }
  const out = resolve(opts.out ?? '.');
  await mkdir(out, { recursive: true });
  for (const { log, flight } of chosen) {
    const file = join(out, exportName(log, flight, format));
    await writeFile(file, exportFlight(log, flight, format));
    console.log(`Saved ${file}`);
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

async function ui(): Promise<void> {
  const p = paths();
  const staticDir = join(REPO_ROOT, 'dist', 'ui');
  if (!existsSync(join(staticDir, 'index.html'))) throw new UsageError('Build the app first: npm run build');
  const running = await runningServer(p.server);
  if (running) {
    console.log(`EdgeTX Wingman Viewer is already running at ${running}`);
    openBrowser(running);
    return;
  }
  // a free port; a second start finds this one through the note
  const server = await startServer({ paths: p, port: 0, staticDir, sampleDir: join(REPO_ROOT, 'assets', 'sample'), licensesFile: join(REPO_ROOT, 'dist', 'THIRD_PARTY_LICENSES.txt') });
  const forget = await noteServer(p.server, server.open);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void forget().finally(() => process.exit(0)));
  console.log(`EdgeTX Wingman Viewer is running at ${server.open} (Ctrl+C to stop)`);
  openBrowser(server.open);
  await new Promise(() => {});
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { flight: { type: 'string' }, format: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const [command, path, ...rest] = positionals;
  if (values.help || command === undefined || command === 'help') {
    console.log(HELP);
    return;
  }
  if (rest.length > 0) throw new UsageError('Name only one log file, folder or SD card.');
  if (command === 'ui') return ui();
  if (command === 'flights') return flights(path);
  if (command === 'export') return exportFlights(path, values);
  throw new UsageError(`Unknown command "${command}". Run "wingman-viewer help" to see the commands.`);
}

main().catch((e: unknown) => {
  if (e instanceof UsageError || (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'))) {
    console.error(e.message);
  } else console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
