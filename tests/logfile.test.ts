import { describe, expect, it } from 'vitest';
import { headerFromModel, parseColumn, parseLog, splitLine } from '../src/core/logfile.ts';
import { parseLuaTable } from '../src/core/luatable.ts';
import { modelForLog, modelNameOfLog, parseLipoConfig, parseModelYml } from '../src/core/projects.ts';
import { mapRoles, samples } from '../src/core/roles.ts';
import { header, line, log, TAIL, T0 } from './helpers.ts';

describe('Lua tables', () => {
  it('reads the settings files of the cores', () => {
    const v = parseLuaTable(`-- comment\nreturn {\n  ["rqlyThreshold"] = 45,\n  ["sounds"] = {},\n  ["list"] = { "a", 'b\\n', },\n  plain = -0x10, f = 1.5e2, t = true, n = nil,\n}`);
    expect(v).toEqual({ rqlyThreshold: 45, sounds: [], list: ['a', 'b\n'], plain: -16, f: 150, t: true, n: null });
  });

  it('runs nothing and refuses anything but data', () => {
    expect(() => parseLuaTable('return { a = os.exit() }')).toThrow();
    expect(() => parseLuaTable('return {} print(1)')).toThrow();
    expect(() => parseLuaTable('return ' + '{'.repeat(40) + '}'.repeat(40))).toThrow();
  });

  it('keeps keys like __proto__ as plain data', () => {
    const v = parseLuaTable('return { ["__proto__"] = { x = 1 } }') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.keys(v)).toEqual(['__proto__']);
  });
});

describe('log file', () => {
  it('splits columns and units, text values in quotes', () => {
    expect(parseColumn('RQly(%)')).toEqual({ name: 'RQly', unit: '%' });
    expect(parseColumn('Hdg(°)')).toEqual({ name: 'Hdg', unit: '°' });
    expect(parseColumn('FM')).toEqual({ name: 'FM' });
    expect(splitLine('1,"A,B",3')).toEqual(['1', '"A,B"', '3']);
  });

  it('reads date and time as the radio wrote them', () => {
    const l = parseLog(log([{ s: 0 }, { s: 1.5 }]));
    expect(l.hasDate).toBe(true);
    expect(l.lines.map((x) => x.t)).toEqual([T0, T0 + 1500]);
  });

  it('reads logs without a clock (time in 10 ms ticks)', () => {
    const l = parseLog(`Time,RQly(%),${TAIL}\n100,99,0,0,0,0,0,0,1500,7.9\n200,98,0,0,0,0,0,0,1500,7.9\n`);
    expect(l.hasDate).toBe(false);
    expect(l.lines.map((x) => x.t)).toEqual([1000, 2000]);
  });

  it('skips a last line without line break (cut off) and broken lines', () => {
    const text = [header(), line({ s: 0 }), 'garbage', line({ s: 1 }), line({ s: 2 }).slice(0, 20)].join('\n');
    const l = parseLog(text);
    expect(l.lines).toHaveLength(2);
    expect(l.skipped).toBe(2);
  });

  it('reads lines with a sensor added while logging with the header from the model file', () => {
    const model = parseModelYml(
      'model01.yml',
      `header:\n   name: "Quad"\ntelemetrySensors:\n${['1RSS:17', 'RQly:13', 'FM:0', 'GPS:40', 'Alt:9', 'Sats:0', 'RxBt:1', 'LNst:0']
        .map((s, i) => `   ${i}:\n      label: "${s.split(':')[0]}"\n      unit: ${s.split(':')[1]}\n      prec: 0\n      logs: 1\n`)
        .join('')}`,
    );
    const text = [header(), line({ s: 0, lq: 100, rssi: -60 }), line({ s: 1, lq: 100, rssi: -60, extra: ['2'] })].join('\n') + '\n';
    const l = parseLog(text, model);
    expect(l.skipped).toBe(0);
    expect(l.schemas).toHaveLength(2);
    expect(l.schemas[1]!.fromModel).toBe(true);
    expect(l.schemas[1]!.header).toBe(header(['LNst']));
    const { samples: s } = samples(l);
    expect(s[0]!.values.lnst).toBeUndefined();
    expect(s[1]!.values.lnst).toBe(2);
    expect(s[1]!.values.volt).toBe(25);
  });

  it('skips such lines when the model file does not fit either', () => {
    const model = parseModelYml('model01.yml', 'header:\n   name: "Quad"\ntelemetrySensors:\n   0:\n      label: "RQly"\n      unit: 13\n      logs: 1\n');
    const text = [header(), line({ s: 0 }), line({ s: 1, extra: ['2'] })].join('\n') + '\n';
    expect(parseLog(text, model).skipped).toBe(1);
    expect(headerFromModel(['Date', 'Time', 'RQly(%)', 'Rud', 'TxBat(V)'], model)).toEqual(['Date', 'Time', 'RQly(%)', 'Rud', 'TxBat(V)']);
  });
});

describe('roles', () => {
  it('takes the names of the cores first, then other radio systems', () => {
    const elrs = mapRoles(parseLog(header() + '\n').schemas[0]!);
    expect(elrs.index.lq).toBe(3);
    expect(elrs.unit.alt).toBe('m');
    const frsky = mapRoles(parseLog(header([], { lq: 'LQ(%)', rssi: 'RSSI(dB)', volt: 'VFAS(V)', alt: 'Alt(ft)' }) + '\n').schemas[0]!);
    expect(frsky.index.rssi1).toBe(2);
    expect(frsky.index.lq).toBe(3);
    expect(frsky.index.volt).toBe(8);
    expect(frsky.unit.alt).toBe('ft');
  });

  it('prefers GAlt over Alt', () => {
    const r = mapRoles(parseLog(`Date,Time,Alt(m),GAlt(m),${TAIL}\n`).schemas[0]!);
    expect(r.index.alt).toBe(3);
  });

  it("uses the battery sensors set for the model in Lipo Nanny's settings first", () => {
    const r = mapRoles(parseLog(`Date,Time,RxBt(V),VBat(V),${TAIL}\n`).schemas[0]!, { sensors: { voltage: 'VBat' }, chemistries: [] });
    expect(r.index.volt).toBe(3);
  });
});

describe('project data', () => {
  it("reads Lipo Nanny's models, packs and chemistries", () => {
    const { lipoModels, packs } = parseLipoConfig(`return {
      ["batteries"] = { { ["id"] = "bat_001", ["name"] = "6s 1300", ["chemistry"] = "LiIon",
        ["instances"] = { { ["id"] = "pack_0007", ["label"] = 3 } } } },
      ["models"] = { ["model01.yml"] = { ["batteryIds"] = { "bat_001" }, ["cells"] = 6, ["sensors"] = { ["voltage"] = "VBat" } } },
    }`);
    expect(lipoModels['model01.yml']).toEqual({ cells: 6, sensors: { voltage: 'VBat', current: undefined, capacity: undefined }, chemistries: ['LiIon'] });
    expect(packs[7]).toEqual({ battery: '6s 1300', label: '3', chemistry: 'LiIon' });
    expect(parseLipoConfig('return { broken')).toEqual({ lipoModels: {}, packs: {} });
  });

  it('reads a model file with a broken end or a key twice, as the radio does', () => {
    const m = parseModelYml('model01.yml', 'checksum: 1\nchecksum: 2\nheader:\n   name: "Quad"\ntelemetrySensors:\n   0:\n      label: "RQly"\n      unit: 13\n      logs: 1\nlast: GLOBAL\n       g: 255\n         b: 255\n');
    expect(m.name).toBe('Quad');
    expect(m.sensors).toEqual([{ label: 'RQly', unit: 13, prec: 0, logs: true }]);
  });

  it('finds the model of a log by its name in the file name', () => {
    expect(modelNameOfLog('My Quad-2026-10-25-143012.csv')).toBe('My Quad');
    expect(modelNameOfLog('My Quad-2026-10-25.csv')).toBe('My Quad');
    const projects = { models: [{ file: 'model02.yml', name: 'A:B', sensors: [] }], lipoModels: {}, packs: {} };
    expect(modelForLog('A_B-2026-10-25.csv', projects)?.file).toBe('model02.yml');
    expect(modelForLog('Other-2026-10-25.csv', projects)).toBeUndefined();
  });
});
