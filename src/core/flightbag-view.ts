// What Flight Bag on the computer shows of a page; shared by the server and the interface, so free of Node.

export const FLIGHT_BAG_PAGES = ['warnings', 'alerts', 'display', 'batteries', 'models', 'flights'] as const;
export type FlightBagPage = (typeof FLIGHT_BAG_PAGES)[number];
export const isFlightBagPage = (v: unknown): v is FlightBagPage => FLIGHT_BAG_PAGES.includes(v as FlightBagPage);
// pages of fields from the apps' manifests; the others have their own views
export const SETTINGS_PAGES: FlightBagPage[] = ['warnings', 'alerts', 'display'];

export interface FieldView {
  key: string;
  label: string;
  type: 'bool' | 'choice' | 'number';
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  unit?: string;
  prefix?: string;
  offValue?: number; // this number means "Off"
  choices?: (string | number | boolean)[];
  labels?: string[];
  hint?: string; // with %v for the value
}

export interface SoundOptionView {
  id: string; // "off", "default" or "file:<name>"
  label: string;
}

export interface RowView {
  id: string;
  kind: 'shared' | 'head' | 'fix' | 'field' | 'sound';
  app?: string; // folder of the app; for a shared row the first of its apps
  apps?: string[]; // shared row: all apps it sets
  text?: string; // head: the app's name
  fix?: 'noConfig' | 'damaged'; // fix: the app's settings file is missing or damaged
  button?: string; // fix: the button (Create, Recreate), in the interface's language
  ask?: string; // fix: the question before the damaged file is replaced
  disabled?: boolean; // greyed out, e.g. Strength while vibration is off
  field?: FieldView;
  value?: unknown; // missing while a shared value differs per app
  mixed?: boolean;
  hint?: string; // the row's help as the page logic gives it, in the interface's language
  sound?: { key: string; label: string; hint?: string; options: SoundOptionView[]; value: string; play?: string };
}

export interface AppInfoView {
  folder: string;
  name: string;
  version?: string;
  ok: boolean; // works with this Flight Bag
}

// An app as Flight Bag's popup shows it: about, problems, its files and what can be reset.
export interface AppDetailView {
  folder: string;
  name: string;
  version?: string;
  ok: boolean;
  sign: boolean; // the warning sign beside the app
  icon: boolean; // the card has an icon.png for it
  url?: string; // "github.com/…", from the manifest
  about: string[]; // e.g. copyright and licence
  problem?: 'update' | 'noConfig' | 'damaged';
  setupErrors: string[]; // of the radio's active model, English from the app
  files: { label: string; path: string }[];
  fix: boolean; // the missing or damaged settings file can be created or recreated
  fixLabel?: string; // its button (Create, Recreate) and question, in the interface's language
  fixAsk?: string;
  resets: { id: string; label: string; ask?: string; desc?: string }[]; // by the manifest's id; label, question and what it does in the interface's language
}

export interface FlightBagView {
  pages: FlightBagPage[]; // the pages with at least one installed app
  page: FlightBagPage;
  rows: RowView[];
  apps: AppInfoView[];
  batteries?: BatteriesView; // the Batteries page
  models?: ModelsView; // the Models page
  flights?: LastFlightView[]; // the Last flights page, newest first
}

export interface Limit {
  min: number;
  max: number;
  step?: number;
}

// One pack of a battery: what the user sets (cycles, wear, purchase month) and Lipo Nanny's statistics.
export interface PackDraft {
  id?: string; // pack_NNNN; missing for a pack added in the dialog
  label: number; // its number within the battery
  cycles: number;
  wear: number; // %
  buyDate?: string; // YYYY-MM
  totalMah?: number;
  minVCell?: number;
  lastUsed?: string; // YYYY-MM-DD
}

// A battery of Lipo Nanny as the dialog edits it. Low and critical are both set or both missing (general values).
export interface BatteryDraft {
  name: string;
  nameAuto: boolean;
  manufacturer: string;
  chemistry: string;
  capacityMah: number;
  cells: number;
  warnPct?: number;
  critPct?: number;
  packs: PackDraft[];
}

export interface BatteryView extends BatteryDraft {
  id: string;
  models: string[]; // names of the models it is assigned to
}

export interface BatteriesView {
  broken: boolean; // Lipo Nanny's settings file can't be used
  list: BatteryView[];
  warnPct: number; // general values
  critPct: number;
  chemistries: string[];
  limits: { capacityMah: Limit; cells: Limit; wear: Limit; warnPct: Limit; critPct: Limit };
  textMax: { name: number; manufacturer: number };
  maxPacks: number;
}

// The dialog's battery after the page logic saw it: the generated name, and why it can't be saved yet.
export interface BatteryEditView {
  draft: BatteryDraft;
  isNew: boolean;
  dirty: boolean;
  invalid?: string; // English
  archiveLocked?: string; // why no pack can be retired now
  deleteBlocked?: string;
  deleteQuestion: string;
  full: boolean; // no more packs
}

export interface ModuleView {
  key: string; // lipo, link, gps
  label: string;
  desc?: string;
}

// A model on the Models page: set up in Lipo Nanny or Wingman, or only on the card (configured false).
export interface ModelSummary {
  file: string; // model01.yml
  name: string;
  configured: boolean;
  active: boolean; // the radio's selected model
  onCard: boolean; // its model file is on the card
  cells?: number;
  parallel?: boolean;
  batteries?: string[]; // names of the assigned batteries
  customSensors?: boolean;
  mods?: Record<string, boolean>; // Wingman's columns, by module
}

export interface ModelsView {
  broken: boolean; // Lipo Nanny's settings file can't be used
  lipo: boolean; // Lipo Nanny's settings are there
  wingman: boolean;
  wingmanBroken: boolean; // Wingman is installed, its settings file can't be used
  list: ModelSummary[];
  modules: ModuleView[];
}

// A model as the dialog edits it; the battery part only with Lipo Nanny, mods only with Wingman.
export interface ModelDraft {
  cells?: number;
  parallel?: boolean;
  batteryIds?: string[];
  sensors?: Record<string, string>; // by field; missing means the default
  mods?: Record<string, boolean>;
}

export interface SensorFieldView {
  key: string; // voltage, current, capacity, capacityUnit
  label: string;
  desc?: string;
  unit: boolean; // capacityUnit: mAh used (no value) or "pct"
  default?: string; // sensor name used without a choice
  options: string[]; // the model's sensors
}

export interface AssignView {
  id: string;
  name: string;
  checked: boolean;
  selectable: boolean; // in parallel mode only batteries with 2 packs or more
  packs: number;
}

// The dialog's model after the page logic saw it.
export interface ModelEditView {
  file: string;
  name: string;
  draft: ModelDraft;
  isNew: boolean;
  dirty: boolean;
  cellLimit?: Limit;
  assign?: AssignView[]; // batteries with the model's cells
  otherCells?: number; // assigned batteries with other cells, dropped on saving
  smallProfiles?: number; // assigned batteries with fewer than 2 packs in parallel mode, dropped on saving
  parallelInvalid?: boolean;
  parallelProblem?: string; // the message for it
  sensors?: SensorFieldView[];
  customSensors?: boolean;
  modules?: ModuleView[];
}

// A position GPS Homer stored when the telemetry ended after a flight.
export interface LastFlightView {
  date: string; // YYYY-MM-DD, empty without the radio's clock
  time: string; // HH:MM
  model: string;
  lat: number;
  lon: number;
  latText: string;
  lonText: string;
  url: string; // map link
}

export type Edits = Record<string, unknown>;
