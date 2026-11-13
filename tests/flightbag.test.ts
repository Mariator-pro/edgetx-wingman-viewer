import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { changeModel, flightBagApps, modelEdit } from '../src/core/flightbag.ts';

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
});
