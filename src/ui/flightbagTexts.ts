import type { Lang } from './texts.ts';

// German for the texts of the Lua apps' manifests, which are English only. Per app and field (or sound), each
// English text with its German one: a text the manifest has changed since has no match and shows in English.
type Pairs = Record<string, string>;

const flightTime: Pairs = {
  'Flight time': 'Flugzeit',
  'EdgeTX Timer 1': 'EdgeTX-Timer 1',
  'Remaining Timer': 'Restzeit-Timer',
  'Time shown beside the battery % in flight': 'Zeit neben dem Akku-% im Flug',
};
const sounds: Pairs = { Sounds: 'Töne', 'Off silences every announcement, vibration stays': 'Aus schaltet alle Ansagen stumm, die Vibration bleibt.' };
const haptic: Pairs = { Vibration: 'Vibration' };
const strength: Pairs = { Strength: 'Stärke', Soft: 'Schwach', Normal: 'Normal', Strong: 'Stark' };

const DE: Record<string, Pairs> = {
  'LIPONY.warnPct': {
    'Battery low': 'Akku niedrig',
    'Warn below %v left (battery profiles can override)': 'Warnt unter %v Rest (ein Akku kann einen eigenen Wert haben).',
  },
  'LIPONY.critPct': { 'Battery critical': 'Akku kritisch', 'Critical alert below %v left': 'Kritische Warnung unter %v Rest.' },
  'LIPONY.audio': sounds,
  'LIPONY.haptic': haptic,
  'LIPONY.hapticStrength': strength,
  'LIPONY.flightTime': flightTime,
  'LIPONY.sound.warn': { 'Battery low': 'Akku niedrig', 'At the Battery low threshold': 'Bei der Schwelle „Akku niedrig“' },
  'LIPONY.sound.crit': { 'Battery critical': 'Akku kritisch', 'At the Battery critical threshold': 'Bei der Schwelle „Akku kritisch“' },
  'LIPONY.sound.charge': { 'Battery not charged': 'Akku nicht geladen', 'Pack already below Battery low when plugged in': 'Pack beim Anstecken schon unter „Akku niedrig“' },

  'SNTNL.warnOffsetDb': {
    'Link quality low': 'Verbindung schwach',
    'Early warning %v before the RSSI limit (1RSS/2RSS)': 'Frühe Warnung %v vor der RSSI-Grenze (1RSS/2RSS).',
  },
  'SNTNL.rqlyThreshold': { 'Link quality critical': 'Verbindung kritisch', 'Critical alert when RQly drops below %v': 'Kritische Warnung, wenn RQly unter %v fällt.' },
  'SNTNL.audio': sounds,
  'SNTNL.haptic': haptic,
  'SNTNL.hapticStrength': strength,
  'SNTNL.sound.stage1': { 'Link quality low': 'Verbindung schwach', 'Signal close to the limit': 'Signal nah an der Grenze' },
  'SNTNL.sound.stage2': { 'Link quality critical': 'Verbindung kritisch', 'Signal at the limit and link quality low': 'Signal an der Grenze und Verbindungsqualität niedrig' },
  'SNTNL.sound.lost': { 'Link lost': 'Verbindung verloren', 'Link gone in flight (off by default)': 'Verbindung im Flug weg (ab Werk aus)' },
  'SNTNL.sound.conn': { 'Link connected': 'Verbindung steht', 'Link up for a new flight (off by default)': 'Verbindung für einen neuen Flug da (ab Werk aus)' },
  'SNTNL.sound.rec': { 'Link recovered': 'Verbindung wieder da', 'Link back after a loss in flight (off by default)': 'Verbindung nach einem Verlust im Flug zurück (ab Werk aus)' },

  'GPSHOMER.homeMinSats': { 'Minimum satellites': 'Mindestzahl Satelliten', 'Home is set once %v satellites are stable': 'Home wird gesetzt, sobald %v Satelliten stabil sind.' },
  'GPSHOMER.maxAlt': { 'Max altitude': 'Maximale Höhe', 'Announce once when higher than %v above home': 'Einmal ansagen, wenn das Modell mehr als %v über Home ist.' },
  'GPSHOMER.maxDist': { 'Max distance': 'Maximale Entfernung', 'Announce once when farther than %v from home': 'Einmal ansagen, wenn das Modell weiter als %v von Home weg ist.' },
  'GPSHOMER.audio': sounds,
  'GPSHOMER.haptic': haptic,
  'GPSHOMER.hapticStrength': strength,
  'GPSHOMER.sound.ready': { 'Ready to fly': 'Bereit zum Fliegen', 'GPS fix is stable, safe to arm': 'GPS-Fix ist stabil, du kannst scharf schalten' },
  'GPSHOMER.sound.fix': { 'Home set': 'Home gesetzt', 'Home stored when arming (or at first stable fix)': 'Home beim Scharfschalten gespeichert (oder beim ersten stabilen Fix)' },
  'GPSHOMER.sound.lost': { 'GPS lost': 'GPS verloren', 'GPS fix lost for a few seconds': 'GPS-Fix für einige Sekunden weg' },
  'GPSHOMER.sound.rec': { 'GPS recovered': 'GPS wieder da', 'GPS fix is back after a loss': 'GPS-Fix ist nach einem Verlust zurück' },
  'GPSHOMER.sound.alt': { 'Max altitude': 'Maximale Höhe', 'Higher than Max altitude above home': 'Höher als „Maximale Höhe“ über Home' },
  'GPSHOMER.sound.dist': { 'Max distance': 'Maximale Entfernung', 'Farther than Max distance from home': 'Weiter als „Maximale Entfernung“ von Home' },

  'WINGMAN.mascot': { Mascot: 'Maskottchen', 'Character on the wait page': 'Figur auf der Warteseite' },
  'WINGMAN.flightTime': flightTime,
  'WINGMAN.gpsView': {
    'GPS view': 'GPS-Ansicht',
    Compass: 'Kompass',
    Horizon: 'Horizont',
    'Horizon: set Telem Ratio to 1:4 or faster': 'Horizont: Stelle „Telem Ratio“ auf 1:4 oder schneller.',
  },
  'WINGMAN.barStyle': {
    'Bar style': 'Balkenstil',
    Solid: 'Durchgehend',
    Segments: 'Segmente',
    Zones: 'Zonen',
    'Battery and link bars: plain, blocks or zones': 'Balken für Akku und Verbindung: durchgehend, in Blöcken oder in Zonen',
  },
  // the Models page: its own rows, not from a manifest
  'MODELS.voltage': { Voltage: 'Spannung', 'Whole-pack voltage (V). Sets SoC % and warnings. 4S full ~16.8V, empty ~14.0V.': 'Spannung des ganzen Packs (V). Daraus kommen Ladestand in % und Warnungen. 4S voll etwa 16,8 V, leer etwa 14,0 V.' },
  'MODELS.current': { Current: 'Strom', 'Live current draw (A). Feeds the remaining-time estimate, e.g. 0-120A.': 'Aktueller Strom (A). Daraus schätzt Lipo Nanny die Restzeit, z. B. 0 bis 120 A.' },
  'MODELS.capacity': {
    Capacity: 'Verbrauch',
    'Consumed mAh, counts UP from 0 (or %, see Capacity unit). Main warn trigger.': 'Verbrauchte mAh, zählt ab 0 aufwärts (oder %, siehe „Einheit des Verbrauchs“). Löst die Warnungen vor allem aus.',
  },
  'MODELS.capacityUnit': {
    'Capacity unit': 'Einheit des Verbrauchs',
    'Only if the FC sends remaining %. FC capacity must equal the pack\'s mAh.': 'Nur, wenn der Flight Controller den Rest in % sendet. Seine Kapazität muss den mAh des Packs entsprechen.',
  },
  'MODELS.module.lipo': { Battery: 'Akku', 'Battery column, pack selection and Lipo Nanny alerts. Off: none of them.': 'Spalte „Akku“, Wahl des Packs und Ansagen von Lipo Nanny. Aus: nichts davon.' },
  'MODELS.module.link': { Link: 'Verbindung', 'Link column and Link Sentinel alerts. Off: no link values, no link alerts.': 'Spalte „Verbindung“ und Ansagen von Link Sentinel. Aus: keine Werte und Ansagen zur Verbindung.' },
  'MODELS.module.gps': { GPS: 'GPS', 'GPS column, search page and GPS Homer alerts. Off: no GPS values or alerts.': 'Spalte „GPS“, Suchseite und Ansagen von GPS Homer. Aus: keine GPS-Werte und keine Ansagen dazu.' },

  'WINGMAN.switchPage': { 'Switch page': 'Schalterseite', 'Switches and FC modes on the wait page (aileron right)': 'Schalter und FC-Modi auf der Warteseite (Querruder rechts)' },
};

// A manifest text in the interface's language; `places` are "<app>.<field>" or "<app>.sound.<key>".
export function manifestText(lang: Lang, places: string[], text: string): string {
  if (lang !== 'de') return text;
  for (const p of places) {
    const de = Object.hasOwn(DE, p) && Object.hasOwn(DE[p]!, text) ? DE[p]![text] : undefined;
    if (de) return de;
  }
  return text;
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
