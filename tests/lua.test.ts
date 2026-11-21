import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LuaError, luaRun } from '../src/core/lua.ts';

describe('Lua scripts from the card', () => {
  let dir: string;
  let card: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wingman-lua-'));
    card = join(dir, 'card');
    await writeFile(join(dir, 'secret.txt'), 'outside');
    for (const [path, text] of [
      ['SCRIPTS/APP/notes.txt', 'hello'],
      ['SCRIPTS/APP/config.lua', 'return { a = 1 }'],
      ['SCRIPTS/APP/part.lua', 'return 1 + 2'],
      ['LOGS/flight.csv', 'Date,Time'],
      ['MODELS/model1.yml', 'header:'],
      ['MODELS/trick.lua', 'return 1'],
    ]) {
      await mkdir(join(card, path, '..'), { recursive: true });
      await writeFile(join(card, path), text);
    }
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  // Runs a chunk and returns the value of its global "out".
  const run = (code: string, timeLimitMs?: number) => {
    const r = luaRun({ card, timeLimitMs });
    r.exec(`function result() return out end\n${code}`, 'test');
    return { out: r.call('result'), writes: r.writes };
  };
  const read = (path: string) => run(`local f = io.open(${JSON.stringify(path)}, "r"); out = f and io.read(f, 100) or false`).out;

  it('has no way out to the computer', () => {
    const names = ['os', 'require', 'loadfile', 'dofile', 'load', 'debug', 'package', 'utf8', 'coroutine', 'collectgarbage'];
    const { out } = run(`out = {}; for _, n in ipairs({ ${names.map((n) => `"${n}"`).join(', ')} }) do out[n] = type(_G[n]) end; out.io = {}; for k in pairs(io) do out.io[#out.io + 1] = k end; table.sort(out.io)`);
    const o = out as Record<string, unknown>;
    expect(Object.fromEntries(names.map((n) => [n, o[n]]))).toEqual({
      os: 'nil',
      require: 'nil',
      loadfile: 'nil',
      dofile: 'nil',
      load: 'nil',
      debug: 'nil',
      package: 'nil',
      utf8: 'nil',
      coroutine: 'nil',
      // a stand-in that does nothing, as on the radio
      collectgarbage: 'function',
    });
    expect(o.io).toEqual(['close', 'open', 'read', 'write']);
    expect(run('out = type(__fopen) .. type(__loadtext) .. type(__setenv)').out).toBe('nilnilnil');
  });

  it('reads only below the allowed folders of the card', () => {
    expect(read('/SCRIPTS/APP/notes.txt')).toBe('hello');
    expect(read('/MODELS/model1.yml')).toBe('header:');
    expect(read('/LOGS/flight.csv')).toBe(false);
    expect(read('/SCRIPTS/../LOGS/flight.csv')).toBe(false);
    expect(read('/../secret.txt')).toBe(false);
    expect(read('/SCRIPTS/APP/../../../secret.txt')).toBe(false);
    expect(read('SCRIPTS/APP/notes.txt')).toBe(false);
    expect(read('/SCRIPTS\\APP\\notes.txt')).toBe(false);
    expect(read('/SCRIPTS/APP/notes.txt\n')).toBe(false);
  });

  it('loads Lua only from SCRIPTS and as text', () => {
    expect(run('out = loadScript("/SCRIPTS/APP/part.lua")()').out).toBe(3);
    expect(run('out = loadScript("/MODELS/trick.lua") == nil').out).toBe(true);
    expect(run('out = loadScript("/SCRIPTS/APP/notes.txt") == nil').out).toBe(true);
    expect(run('out = select(2, loadScript("/SCRIPTS/APP/../../MODELS/trick.lua")) ~= nil').out).toBe(true);
  });

  it('keeps writes in memory, only for settings files and GPS Homer flights', async () => {
    const write = (path: string) => `local f = io.open(${JSON.stringify(path)}, "w"); if f then io.write(f, "x"); io.close(f) end; out = (out or "") .. (f and "y" or "n")`;
    const { out, writes } = run(
      [
        write('/SCRIPTS/APP/config.lua'),
        write('/SCRIPTS/GPSHOMER/flights.lua'),
        write('/SCRIPTS/APP/core.lua'),
        write('/SCRIPTS/APP/notes.txt'),
        write('/MODELS/model1.yml'),
        write('/RADIO/radio.yml'),
        write('/SCRIPTS/APP/../OTHER/config.lua'),
        write('/config.lua'),
      ].join('\n'),
    );
    expect(out).toBe('yynnnnnn');
    expect([...writes.keys()].sort()).toEqual(['/SCRIPTS/APP/config.lua', '/SCRIPTS/GPSHOMER/flights.lua']);
    expect(await readFile(join(card, 'SCRIPTS', 'APP', 'config.lua'), 'utf8')).toBe('return { a = 1 }');
    // a script reads back what it wrote this run
    expect(run(`${write('/SCRIPTS/APP/config.lua')}; local f = io.open("/SCRIPTS/APP/config.lua"); out = io.read(f)`).out).toBe('x');
  });

  it('deletes nothing on the card', async () => {
    expect(run('out = del("/SCRIPTS/APP/notes.txt")').out).toBe(false);
    expect(await readFile(join(card, 'SCRIPTS', 'APP', 'notes.txt'), 'utf8')).toBe('hello');
  });

  it('stops a script that does not finish', () => {
    expect(() => run('while true do end', 50)).toThrow(LuaError);
    expect(() => run('while true do end', 50)).toThrow(/took too long/);
  });
});
