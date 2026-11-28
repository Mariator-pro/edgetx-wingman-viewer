import { createContext, use } from 'react';
import type { StickMode } from '../core/kinds.ts';
import type { ListPrefs } from '../core/settings.ts';
import type { Lang, Texts } from './texts.ts';
import type { Theme } from './appearance.ts';

export type { Theme };

export interface Prefs {
  t: Texts;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  look: 'light' | 'dark'; // what the page shows; with "system" it follows the computer
  sticks: StickMode; // for logs without the radio's settings
  setSticks: (m: StickMode) => void;
  attitudeShown: boolean; // the attitude view on the map, or only its button
  setAttitudeShown: (shown: boolean) => void;
  moreShown: boolean; // the other values of the log in the values bar, open or folded
  setMoreShown: (shown: boolean) => void;
  list: ListPrefs; // filters, order and columns of the list of flights
  setList: (l: ListPrefs) => void;
  sidebarCollapsed: boolean; // the sidebar shows only its icons
  toggleSidebar: () => void;
}

export const PrefsContext = createContext<Prefs | null>(null);

export function usePrefs(): Prefs {
  const p = use(PrefsContext);
  if (!p) throw new Error('PrefsProvider missing');
  return p;
}
