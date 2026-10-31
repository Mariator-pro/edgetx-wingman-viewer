import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything the app stores on the computer lives under one fixed folder.
export interface Paths {
  root: string;
  logs: string; // Logs/<board>/<file>.csv, copies of the SD card's /LOGS/; Logs/imported/ for files added by hand
  projects: string; // Projects/<board>/..., the SD card files read with the logs (models, settings of the cores)
  trash: string; // Trash/<board>/<file>.csv, copies whose flights are all deleted
  flights: string; // notes, tags and deleted flights
  settings: string;
  server: string; // where the browser interface's server runs, so a second start opens it
}

export const IMPORTED = 'imported';

// Where apps keep their data on each system: macOS Application Support (the same folder Electron uses for
// the app), Windows LocalAppData, elsewhere XDG data.
function dataRoot(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'EdgeTX Wingman Viewer');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'EdgeTX Wingman Viewer');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'edgetx-wingman-viewer');
}

export function paths(root = dataRoot()): Paths {
  return {
    root,
    logs: join(root, 'Logs'),
    projects: join(root, 'Projects'),
    trash: join(root, 'Trash'),
    flights: join(root, 'flights.json'),
    settings: join(root, 'settings.json'),
    server: join(root, 'server.json'),
  };
}

// A single folder name coming from outside (UI, command line, SD card), never a path.
export function isSafeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);
}

// A name used as a folder and as a key (a radio's board): a safe folder name that is not also a property
// every object has (__proto__, constructor ...), through which it would change all objects at once.
export function isSafeKey(name: string): boolean {
  return isSafeName(name) && !(name in Object.prototype);
}

// Text from a radio's files as it is shown and printed: without control characters, which in a terminal
// could move the cursor, change colours or the window title, nor those that turn the direction of text.
export const printable = (s: string) => s.replace(/[\p{Cc}‪-‮⁦-⁩]/gu, '');
