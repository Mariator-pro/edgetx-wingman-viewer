import { createContext, use } from 'react';
import type { StickMode } from '../core/kinds.ts';
import type { ListPrefs } from '../core/settings.ts';
import type { Lang, Texts } from './texts.ts';

export type Theme = 'light' | 'dark';

export interface Prefs {
  t: Texts;
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  sticks: StickMode; // for logs without the radio's settings
  setSticks: (m: StickMode) => void;
  attitudeShown: boolean; // the attitude view on the map, or only its button
  setAttitudeShown: (shown: boolean) => void;
  list: ListPrefs; // filters, order and columns of the list of flights
  setList: (l: ListPrefs) => void;
}

export const PrefsContext = createContext<Prefs | null>(null);

export function usePrefs(): Prefs {
  const p = use(PrefsContext);
  if (!p) throw new Error('PrefsProvider missing');
  return p;
}
