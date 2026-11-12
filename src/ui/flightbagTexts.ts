import type { Lang } from './texts.ts';

// German for the texts of the Lua apps' manifests, which are English only. Found only by where a text belongs:
// "<app>.<field>", "<app>.sound.<key>", "MODELS.<field>" or "MODELS.module.<key>", then label, hint or the
// value of a choice. A place or part without German shows the manifest's English.
type Texts = { label?: string; hint?: string; choices?: Record<string, string> };

const flightTime: Texts = {
  label: 'Flugzeit',
  hint: 'Zeit neben dem Akku-% im Flug',
  choices: { timer: 'EdgeTX-Timer 1', timeleft: 'Restzeit-Timer' },
};
const sounds: Texts = { label: 'Töne', hint: 'Aus schaltet alle Ansagen stumm, die Vibration bleibt.' };
const haptic: Texts = { label: 'Vibration' };
const strength: Texts = { label: 'Stärke', choices: { 1: 'Schwach', 2: 'Normal', 3: 'Stark' } };

const DE: Record<string, Texts> = {
  'LIPONY.warnPct': { label: 'Akku niedrig', hint: 'Warnt unter %v Rest (ein Akku kann einen eigenen Wert haben).' },
  'LIPONY.critPct': { label: 'Akku kritisch', hint: 'Kritische Warnung unter %v Rest.' },
  'LIPONY.audio': sounds,
  'LIPONY.haptic': haptic,
  'LIPONY.hapticStrength': strength,
  'LIPONY.flightTime': flightTime,
  'LIPONY.sound.warn': { label: 'Akku niedrig', hint: 'Bei der Schwelle „Akku niedrig“' },
  'LIPONY.sound.crit': { label: 'Akku kritisch', hint: 'Bei der Schwelle „Akku kritisch“' },
  'LIPONY.sound.charge': { label: 'Akku nicht geladen', hint: 'Pack beim Anstecken schon unter „Akku niedrig“' },

  'SNTNL.warnOffsetDb': { label: 'Verbindung schwach', hint: 'Frühe Warnung %v vor der RSSI-Grenze (1RSS/2RSS).' },
  'SNTNL.rqlyThreshold': { label: 'Verbindung kritisch', hint: 'Kritische Warnung, wenn RQly unter %v fällt.' },
  'SNTNL.audio': sounds,
  'SNTNL.haptic': haptic,
  'SNTNL.hapticStrength': strength,
  'SNTNL.sound.stage1': { label: 'Verbindung schwach', hint: 'Signal nah an der Grenze' },
  'SNTNL.sound.stage2': { label: 'Verbindung kritisch', hint: 'Signal an der Grenze und Verbindungsqualität niedrig' },
  'SNTNL.sound.lost': { label: 'Verbindung verloren', hint: 'Verbindung im Flug weg (ab Werk aus)' },
  'SNTNL.sound.conn': { label: 'Verbindung steht', hint: 'Verbindung für einen neuen Flug da (ab Werk aus)' },
  'SNTNL.sound.rec': { label: 'Verbindung wieder da', hint: 'Verbindung nach einem Verlust im Flug zurück (ab Werk aus)' },

  'GPSHOMER.homeMinSats': { label: 'Mindestzahl Satelliten', hint: 'Home wird gesetzt, sobald %v Satelliten stabil sind.' },
  'GPSHOMER.maxAlt': { label: 'Maximale Höhe', hint: 'Einmal ansagen, wenn das Modell mehr als %v über Home ist.' },
  'GPSHOMER.maxDist': { label: 'Maximale Entfernung', hint: 'Einmal ansagen, wenn das Modell weiter als %v von Home weg ist.' },
  'GPSHOMER.audio': sounds,
  'GPSHOMER.haptic': haptic,
  'GPSHOMER.hapticStrength': strength,
  'GPSHOMER.sound.ready': { label: 'Bereit zum Fliegen', hint: 'GPS-Fix ist stabil, du kannst scharf schalten' },
  'GPSHOMER.sound.fix': { label: 'Home gesetzt', hint: 'Home beim Scharfschalten gespeichert (oder beim ersten stabilen Fix)' },
  'GPSHOMER.sound.lost': { label: 'GPS verloren', hint: 'GPS-Fix für einige Sekunden weg' },
  'GPSHOMER.sound.rec': { label: 'GPS wieder da', hint: 'GPS-Fix ist nach einem Verlust zurück' },
  'GPSHOMER.sound.alt': { label: 'Maximale Höhe', hint: 'Höher als „Maximale Höhe“ über Home' },
  'GPSHOMER.sound.dist': { label: 'Maximale Entfernung', hint: 'Weiter als „Maximale Entfernung“ von Home' },

  'WINGMAN.mascot': { label: 'Maskottchen', hint: 'Figur auf der Warteseite' },
  'WINGMAN.flightTime': flightTime,
  'WINGMAN.gpsView': { label: 'GPS-Ansicht', hint: 'Horizont: Stelle „Telem Ratio“ auf 1:4 oder schneller.', choices: { compass: 'Kompass', horizon: 'Horizont' } },
  'WINGMAN.barStyle': {
    label: 'Balkenstil',
    hint: 'Balken für Akku und Verbindung: durchgehend, in Blöcken oder in Zonen',
    choices: { solid: 'Durchgehend', segments: 'Segmente', zones: 'Zonen' },
  },
  'WINGMAN.switchPage': { label: 'Schalterseite', hint: 'Schalter und FC-Modi auf der Warteseite (Querruder rechts)' },

  // the Models page: its own rows, not from a manifest
  'MODELS.voltage': { label: 'Spannung', hint: 'Spannung des ganzen Packs (V). Daraus kommen Ladestand in % und Warnungen. 4S voll etwa 16,8 V, leer etwa 14,0 V.' },
  'MODELS.current': { label: 'Strom', hint: 'Aktueller Strom (A). Daraus schätzt Lipo Nanny die Restzeit, z. B. 0 bis 120 A.' },
  'MODELS.capacity': { label: 'Verbrauch', hint: 'Verbrauchte mAh, zählt ab 0 aufwärts (oder %, siehe „Einheit des Verbrauchs“). Löst die Warnungen vor allem aus.' },
  'MODELS.capacityUnit': {
    label: 'Einheit des Verbrauchs',
    hint: 'Nur, wenn der Flight Controller den Rest in % sendet. Seine Kapazität muss den mAh des Packs entsprechen.',
  },
  'MODELS.module.lipo': { label: 'Akku', hint: 'Spalte „Akku“, Wahl des Packs und Ansagen von Lipo Nanny. Aus: nichts davon.' },
  'MODELS.module.link': { label: 'Verbindung', hint: 'Spalte „Verbindung“ und Ansagen von Link Sentinel. Aus: keine Werte und Ansagen zur Verbindung.' },
  'MODELS.module.gps': { label: 'GPS', hint: 'Spalte „GPS“, Suchseite und Ansagen von GPS Homer. Aus: keine GPS-Werte und keine Ansagen dazu.' },
};

const german = (places: string[], pick: (t: Texts) => string | undefined): string | undefined => {
  for (const p of places) {
    const de = Object.hasOwn(DE, p) ? pick(DE[p]!) : undefined;
    if (de) return de;
  }
  return undefined;
};

// A label or hint of a manifest in the interface's language; `text` is the manifest's English.
export function manifestText(lang: Lang, places: string[], part: 'label' | 'hint', text: string): string {
  return (lang === 'de' && german(places, (t) => t[part])) || text;
}

// The label of a choice by its value, in the interface's language; `text` is the manifest's English.
export function choiceText(lang: Lang, places: string[], value: unknown, text: string): string {
  const key = String(value);
  return (lang === 'de' && german(places, (t) => (t.choices && Object.hasOwn(t.choices, key) ? t.choices[key] : undefined))) || text;
}

// Messages of the apps' own rules, by their English text: plain English and German for both languages.
const RULES: { re: RegExp; en: (m: string[]) => string; de: (m: string[]) => string }[] = [
  { re: /^Battery low must be above Battery critical$/, en: () => 'Battery low must be above Battery critical.', de: () => '„Akku niedrig“ muss über „Akku kritisch“ liegen.' },
  { re: /^save failed, check SD card$/, en: () => 'Couldn’t save. Check the SD card.', de: () => 'Speichern ging nicht. Prüfe die SD-Karte.' },
  { re: /^Manufacturer required$/, en: () => 'Enter a manufacturer.', de: () => 'Gib einen Hersteller an.' },
  { re: /^Last pack - delete the profile instead$/, en: () => 'This is the last pack. Delete the battery instead.', de: () => 'Das ist der letzte Pack. Lösche stattdessen den Akku.' },
  {
    re: /^Used by parallel model\(s\) (.*) - keep 2\+ packs$/,
    en: (m) => `${m[1]} use two packs in parallel, so the battery keeps at least 2.`,
    de: (m) => `${m[1]} nutzen zwei Packs parallel, deshalb behält der Akku mindestens 2.`,
  },
  {
    re: /^Used by parallel model\(s\) (.*)\. Unassign first$/,
    en: (m) => `${m[1]} use this battery in parallel. Remove it there first.`,
    de: (m) => `${m[1]} nutzen diesen Akku parallel. Nimm ihn dort zuerst heraus.`,
  },
  { re: /^Parallel mode needs a profile with 2\+ packs$/, en: () => 'Parallel packs need a battery with at least 2 packs.', de: () => '„Packs parallel“ braucht einen Akku mit mindestens 2 Packs.' },
  { re: /^Max (\d+) packs$/, en: (m) => `A battery has at most ${m[1]} packs.`, de: (m) => `Ein Akku hat höchstens ${m[1]} Packs.` },
];

// A message of an app's rules in the interface's language; unknown ones stay as they are.
export function ruleText(lang: Lang, msg: string): string {
  for (const r of RULES) {
    const m = r.re.exec(msg);
    if (m) return lang === 'de' ? r.de(m) : r.en(m);
  }
  return msg;
}

// A problem from saving ("<app name>: <message>") in the interface's language.
export function problemText(lang: Lang, problem: string): string {
  const i = problem.indexOf(': ');
  return i < 0 ? ruleText(lang, problem) : `${problem.slice(0, i)}: ${ruleText(lang, problem.slice(i + 2))}`;
}

// The resets of the apps' manifests by their id ("<app>.<id>"), which stays when the label changes: what each
// does in words that stand on their own (in the row and in the question), and the German label and question.
// English label and question come from the manifest; an unknown reset shows the manifest's question and the
// rest of its text.
type ResetTexts = { en: string; de: { label: string; title: string; text: string } };
const RESETS: Record<string, ResetTexts> = {
  'GPSHOMER.settings': {
    en: 'GPS Homer goes back to its factory settings. The Last flights list stays.',
    de: { label: 'Einstellungen zurücksetzen', title: 'Einstellungen von GPS Homer zurücksetzen?', text: 'GPS Homer bekommt wieder seine Werkseinstellungen. Die Liste „Letzte Flüge“ bleibt.' },
  },
  'GPSHOMER.flights': {
    en: 'The Last flights list is emptied. The settings stay.',
    de: { label: 'Letzte Flüge leeren', title: '„Letzte Flüge“ leeren?', text: 'Die Liste „Letzte Flüge“ wird geleert. Die Einstellungen bleiben.' },
  },
  'GPSHOMER.factory': {
    en: 'GPS Homer goes back to its factory settings, and the Last flights list is emptied.',
    de: { label: 'Alles zurücksetzen', title: 'GPS Homer ganz zurücksetzen?', text: 'GPS Homer bekommt wieder seine Werkseinstellungen, und die Liste „Letzte Flüge“ wird geleert.' },
  },
  'LIPONY.settings': {
    en: 'Warnings and sounds go back to factory settings. Batteries, models and statistics stay.',
    de: { label: 'Einstellungen zurücksetzen', title: 'Warnungen und Töne zurücksetzen?', text: 'Warnungen und Töne bekommen wieder die Werkseinstellungen. Akkus, Modelle und Statistiken bleiben.' },
  },
  'LIPONY.stats': {
    en: 'Cycle counts, total mAh used, lowest cell voltage, last used and the archive are erased. Batteries and models stay.',
    de: { label: 'Statistiken zurücksetzen', title: 'Alle Statistiken zurücksetzen?', text: 'Zyklen, verbrauchte mAh gesamt, niedrigste Zellspannung, „zuletzt genutzt“ und das Archiv werden gelöscht. Akkus und Modelle bleiben.' },
  },
  'LIPONY.factory': {
    en: 'All batteries, models, statistics and settings are erased.',
    de: { label: 'Alles zurücksetzen', title: 'Lipo Nanny ganz zurücksetzen?', text: 'Alle Akkus, Modelle, Statistiken und Einstellungen werden gelöscht.' },
  },
  'SNTNL.settings': {
    en: 'Link Sentinel goes back to its factory settings.',
    de: { label: 'Einstellungen zurücksetzen', title: 'Einstellungen von Link Sentinel zurücksetzen?', text: 'Link Sentinel bekommt wieder seine Werkseinstellungen.' },
  },
  'WINGMAN.settings': {
    en: 'Mascot, GPS view, bar style and switch page go back to factory settings. Models and FC modes stay.',
    de: { label: 'Einstellungen zurücksetzen', title: 'Einstellungen von Wingman zurücksetzen?', text: 'Maskottchen, GPS-Ansicht, Balkenstil und Schalterseite bekommen wieder die Werkseinstellungen. Modelle und FC-Modi bleiben.' },
  },
  'WINGMAN.factory': {
    en: 'All models, FC modes and settings are erased. Every model shows battery, link and GPS again.',
    de: { label: 'Alles zurücksetzen', title: 'Wingman ganz zurücksetzen?', text: 'Alle Modelle, FC-Modi und Einstellungen werden gelöscht. Jedes Modell zeigt wieder Akku, Verbindung und GPS.' },
  },
};

export function resetText(lang: Lang, app: string, r: { id: string; label: string; ask?: string }): { label: string; title: string; text: string } {
  const known = Object.hasOwn(RESETS, `${app}.${r.id}`) ? RESETS[`${app}.${r.id}`] : undefined;
  if (known && lang === 'de') return known.de;
  const ask = r.ask ?? '';
  const i = ask.indexOf('?');
  const title = i < 0 ? ask || `${r.label}?` : ask.slice(0, i + 1);
  return { label: r.label, title, text: known?.en ?? (i < 0 ? '' : ask.slice(i + 1).trim()) };
}
