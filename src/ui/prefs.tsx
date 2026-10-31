import { useEffect, useState } from 'react';
import { isStickMode, type StickMode } from '../core/kinds.ts';
import { PREFS_META, type PrefsView } from '../server/api.ts';
import { post } from './api.ts';
import { LANGUAGES, TEXTS, type Lang } from './texts.ts';
import { PrefsContext, type Theme } from './usePrefs.ts';

// The choices the server keeps and puts into the page. The port changes with every start, and the browser
// keeps what a page stores per port, so its own storage would forget them.
function served(): PrefsView {
  try {
    return JSON.parse(document.querySelector<HTMLMetaElement>(`meta[name="${PREFS_META}"]`)?.content ?? '{}') as PrefsView;
  } catch {
    return {};
  }
}

const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

// Kept for the next start; if that fails, the choice holds until the page is loaded again.
const save = (prefs: PrefsView) => void post('/api/prefs', prefs).catch(() => {});

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(served);
  const [lang, setLang] = useState<Lang>(() => pick(initial.lang, LANGUAGES.map((l) => l.id), 'en'));
  const [theme, setTheme] = useState<Theme>(() =>
    pick(initial.theme, ['light', 'dark'] as const, window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [sticks, setSticks] = useState<StickMode>(isStickMode(initial.sticks) ? initial.sticks : 2);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const chooseLang = (l: Lang) => {
    setLang(l);
    save({ lang: l });
  };
  const chooseTheme = (t: Theme) => {
    setTheme(t);
    save({ theme: t });
  };
  const chooseSticks = (m: StickMode) => {
    setSticks(m);
    save({ sticks: m });
  };
  return (
    <PrefsContext value={{ t: TEXTS[lang], lang, setLang: chooseLang, theme, setTheme: chooseTheme, sticks, setSticks: chooseSticks }}>{children}</PrefsContext>
  );
}
