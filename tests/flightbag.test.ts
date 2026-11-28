import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { batteryEdit, changeBattery, changeModel, flightBagApps, flightBagView, modelEdit, saveFlightBag } from '../src/core/flightbag.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
// Flight Bag's Lua files come from the Wingman repo next to this one; without it the card tests are skipped.
const WINGMAN = join(import.meta.dirname, '..', '..', 'edgetx-flight-wingman', 'src', 'SCRIPTS');
const hasWingman = await stat(join(WINGMAN, 'FLIGHTBAG', 'apps.lua')).then(
  () => true,
  () => false,
);

describe('Flight Bag glue', () => {
  it('defines each local function once, so a later one never hides an earlier one', async () => {
    const src = await readFile(join(import.meta.dirname, '..', 'src', 'core', 'flightbag.ts'), 'utf8');
    const glue = /const GLUE = `([\s\S]*?)`;/.exec(src)?.[1] ?? '';
    const names = [...glue.matchAll(/^\s*local function (\w+)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe.skipIf(!hasWingman)('Flight Bag models on a card', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  const card = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wingman-flightbag-'));
    dirs.push(dir);
    const c = join(dir, 'card');
    await cp(join(FIXTURES, 'elrs-two-flights'), c, { recursive: true });
    // the apps' code, but the fixture's settings
    const skip = new Set(['config.lua', 'flights.lua']);
    await cp(WINGMAN, join(c, 'SCRIPTS'), { recursive: true, force: false, filter: (p) => !skip.has(basename(p)) && !p.endsWith('.luac') });
    // the fixture's Lipo Nanny settings as a full settings file of this core version
    const core = await readFile(join(WINGMAN, 'LIPONY', 'core.lua'), 'utf8');
    const schema = /^local SCHEMA_VERSION\s*=\s*(\d+)/m.exec(core)?.[1] ?? '1';
    const cfg = join(c, 'SCRIPTS', 'LIPONY', 'config.lua');
    await writeFile(cfg, (await readFile(cfg, 'utf8')).replace('return {', `return { schemaVersion = ${schema}, generation = 0,`));
    return c;
  };

  it('opens and saves a model in English and German', async () => {
    const c = await card();
    for (const lang of ['en', 'de']) {
      const v = await modelEdit(c, 'model1.yml', null, lang);
      expect(v.file).toBe('model1.yml');
      expect(v.parallelProblem).toBeTruthy();
      expect(await changeModel(c, 'model1.yml', v.draft, 'save', lang)).toEqual({});
    }
  });

  it("takes the button and question for a damaged file and the resets from Flight Bag's files", async () => {
    const c = await card();
    await writeFile(join(c, 'SCRIPTS', 'SNTNL', 'config.lua'), 'return { broken');
    const apps = await flightBagApps(c, 'de');
    const sntnl = apps.find((a) => a.folder === 'SNTNL');
    expect(sntnl?.problem).toBe('damaged');
    expect(sntnl?.fixLabel).toBe('Neu anlegen');
    expect(sntnl?.fixAsk).toMatch(/\?/);
    expect(apps.find((a) => a.folder === 'GPSHOMER')?.resets.map((r) => r.id)).toEqual(['settings', 'flights']);
  });

  it('greys an app the active model does not use, with the reason from Flight Bag', async () => {
    const c = await card();
    const before = await flightBagApps(c, 'en');
    expect(before.find((a) => a.folder === 'GPSHOMER')?.off).toBeUndefined();
    expect(before.find((a) => a.folder === 'WINGMAN')?.offText).toBe('Not used on this model');
    // GPS Homer's widget off the screen, Link Sentinel only as a global function
    const model = join(c, 'MODELS', 'model1.yml');
    const yml = await readFile(model, 'utf8');
    await writeFile(model, yml.replace('widgetName: GPS Homer', 'widgetName: Text').replace('widgetName: Sentinel', 'widgetName: Text'));
    await writeFile(join(c, 'RADIO', 'radio.yml'), (await readFile(join(c, 'RADIO', 'radio.yml'), 'utf8')) + 'customFn:\n   0:\n      swtch: "ON"\n      func: PLAY_SCRIPT\n      def: "sntnl,1,On"\n');
    const apps = await flightBagApps(c, 'de');
    const gps = apps.find((a) => a.folder === 'GPSHOMER');
    expect(gps?.off).toBe(true);
    expect(gps?.offText).toBe('Von diesem Modell nicht genutzt');
    expect(gps?.about).not.toContain(gps?.offText);
    expect(gps?.setupErrors).toEqual([]);
    expect(apps.find((a) => a.folder === 'SNTNL')?.off).toBeUndefined();
  });

  it('saves a page through its rules and replaces the files, leaving no temporary or macOS files', async () => {
    const c = await card();
    const lipo = join(c, 'SCRIPTS', 'LIPONY');
    const cfg = join(lipo, 'config.lua');
    await writeFile(join(lipo, '._config.lua'), 'mac');
    await writeFile(join(c, 'SCRIPTS', '._LIPONY'), 'mac');
    const before = await readFile(cfg, 'utf8');

    // low below critical breaks Lipo Nanny's rule: nothing is written
    const bad = await saveFlightBag(c, 'warnings', { 'field:LIPONY:warnPct': 10 });
    expect(bad.written).toEqual([]);
    expect(bad.problems).toEqual(['Lipo Nanny: Battery low must be above Battery critical']);
    expect(await readFile(cfg, 'utf8')).toBe(before);
    // a value outside the field's range is refused before the page logic sees it
    await expect(saveFlightBag(c, 'warnings', { 'field:LIPONY:warnPct': 500 })).rejects.toThrow(/warnPct/);
    expect(await readFile(cfg, 'utf8')).toBe(before);

    const ok = await saveFlightBag(c, 'warnings', { 'field:LIPONY:warnPct': 40 });
    expect(ok.problems).toEqual([]);
    expect(ok.written).toContain('/SCRIPTS/LIPONY/config.lua');
    expect(await readFile(cfg, 'utf8')).toMatch(/\["warnPct"\] = 40,/);
    expect((await flightBagView(c, 'warnings')).rows.find((r) => r.id === 'field:LIPONY:warnPct')?.value).toBe(40);
    expect((await readdir(lipo)).filter((f) => f.startsWith('._') || f.endsWith('.new'))).toEqual([]);
    expect(await readdir(join(c, 'SCRIPTS'))).not.toContain('._LIPONY');
  });

  it("sets a model's own page and bar style of Wingman through Flight Bag's page logic", async () => {
    const c = await card();
    const v = await modelEdit(c, 'model1.yml', null);
    expect(v.own?.map((o) => o.key)).toEqual(['gpsView', 'barStyle']);
    const page = v.own?.[0];
    expect(page?.label).toBe('Page style');
    expect(page?.desc).toBe('Global: as set under Display (Compass). Or a choice only for this model.');
    expect(page?.choices.map((x) => x.id)).toEqual(['', 'compass', 'horizon', 'tiles']);
    expect(page?.choices[0]?.label).toBe('Global');
    expect(v.draft.own ?? {}).toEqual({});

    const draft = { ...v.draft, own: { gpsView: 'horizon', barStyle: 'zones' } };
    const changed = await modelEdit(c, 'model1.yml', draft);
    expect(changed.dirty).toBe(true);
    expect(changed.draft.own).toEqual({ gpsView: 'horizon', barStyle: 'zones' });
    await expect(changeModel(c, 'model1.yml', { ...v.draft, own: { gpsView: 'radar' } }, 'save')).rejects.toThrow();
    expect(await changeModel(c, 'model1.yml', draft, 'save')).toEqual({});
    const cfg = await readFile(join(c, 'SCRIPTS', 'WINGMAN', 'config.lua'), 'utf8');
    expect(cfg).toMatch(/\["gpsView"\] = "horizon"/);
    expect(cfg).toMatch(/\["barStyle"\] = "zones"/);
    const list = (await flightBagView(c, 'models')).models?.list.find((m) => m.file === 'model1.yml');
    expect(list?.modsText).toBe('Battery, Link, GPS (Horizon, Zones)');
    const de = (await modelEdit(c, 'model1.yml', null, 'de')).own;
    expect(de?.map((o) => o.label)).toEqual(['Seitenstil', 'Balkenstil']);
    expect(de?.[0]?.choices[0]?.label).toBe('Global');

    // back to Global: the model leaves Wingman's file
    expect(await changeModel(c, 'model1.yml', { ...v.draft, own: {} }, 'save')).toEqual({});
    expect(await readFile(join(c, 'SCRIPTS', 'WINGMAN', 'config.lua'), 'utf8')).not.toMatch(/model1\.yml/);
  });

  it("adds and deletes a battery through Lipo Nanny's rules", async () => {
    const c = await card();
    const list = async () => (await flightBagView(c, 'batteries')).batteries?.list.map((b) => b.name);
    expect(await list()).toEqual(['Sample 6s 1300mAh']);
    const fresh = await batteryEdit(c, undefined, null);
    expect(fresh.isNew).toBe(true);
    const cfg = join(c, 'SCRIPTS', 'LIPONY', 'config.lua');
    const before = await readFile(cfg, 'utf8');
    expect(await changeBattery(c, undefined, fresh.draft, 'save')).toEqual({ problem: 'Enter a manufacturer.' });
    expect(await readFile(cfg, 'utf8')).toBe(before);

    expect(await changeBattery(c, undefined, { ...fresh.draft, manufacturer: 'Test', cells: 4 }, 'save')).toEqual({});
    expect(await list()).toEqual(['Sample 6s 1300mAh', 'Test 4s LiPo 1300mAh']);
    expect(await changeBattery(c, 'bat_001', null, 'delete')).toEqual({});
    expect(await list()).toEqual(['Test 4s LiPo 1300mAh']);
  });
});
