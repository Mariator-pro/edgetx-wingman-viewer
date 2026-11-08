import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fengari from 'fengari';
import { isSafeName } from './paths.ts';

// Runs the Lua scripts of the user's own apps from an SD card (Lua 5.3, as on the radio), shut off from the
// computer: only the string, table and math libraries; no io, os, require, loadfile or dofile. Files come
// through stand-ins for EdgeTX's own functions, read from the card and only below a few folders; what the
// scripts write stays in memory until the caller writes it to the card itself. The radio's other functions
// are stand-ins that do nothing, and a time limit stops a script that doesn't finish.

const { lua, lauxlib, lualib, to_luastring } = fengari;

const MAX_FILE = 512 * 1024;
const MAX_READ = 16 * 1024 * 1024; // all files of one run together
const TIME_LIMIT_MS = 5000;
const HOOK_EVERY = 10_000; // instructions between looks at the clock

// What a script may read (and list) and where it may write: settings files of the apps only.
const READABLE = /^\/(SCRIPTS|SOUNDS|WIDGETS|MODELS)(\/|$)/;
const WRITABLE = /^\/SCRIPTS\/[^/]+\/config\.lua$/;

// A card path as the scripts write it ("/SCRIPTS/LIPONY/core.lua"): its parts, or undefined when it could
// lead anywhere else.
function parts(path: string): string[] | undefined {
  if (!path.startsWith('/') || /[\\\p{Cc}]/u.test(path)) return undefined;
  const p = path.split('/').filter((s) => s !== '');
  return p.every(isSafeName) ? p : undefined;
}

const clean = (path: string) => '/' + (parts(path) ?? []).join('/');

export class LuaError extends Error {}

export interface LuaRun {
  // Calls a global Lua function with plain values and returns its first result as plain values.
  call: (name: string, ...args: unknown[]) => unknown;
  // Files written by the scripts, by card path; nothing is on the card yet.
  writes: Map<string, Uint8Array>;
  // Runs a chunk of Lua text (the caller's own code, e.g. helpers it then calls).
  exec: (code: string, name: string) => void;
}

const decoder = new TextDecoder();

// The Lua prelude: EdgeTX's functions as far as the scripts need them on a computer, built on the few
// functions the computer side gives (names starting with "__"), which are taken out of reach afterwards.
const PRELUDE = `
local fopen, fread, fwrite, fclose, fsize, list, now, clock, imperial =
  __fopen, __fread, __fwrite, __fclose, __fsize, __list, __now, __clock, __imperial
__fopen, __fread, __fwrite, __fclose, __fsize, __list, __now, __clock, __imperial = nil
local loadtext, setenv = __loadtext, __setenv
__loadtext, __setenv = nil, nil
dofile, loadfile, load, require, print = nil, nil, nil, nil, function() end

local handles = setmetatable({}, { __mode = "k" })
io = {
  open = function(path, mode)
    local id = fopen(path, mode or "r")
    if not id then return nil end
    local f = {}
    handles[f] = id
    return f
  end,
  read = function(f, n)
    local id = handles[f]
    if not id then error("io.read: not a file") end
    return fread(id, type(n) == "number" and n or -1)
  end,
  write = function(f, ...)
    local id = handles[f]
    if not id then error("io.write: not a file") end
    for i = 1, select("#", ...) do fwrite(id, tostring((select(i, ...)))) end
    return f
  end,
  close = function(f)
    local id = handles[f]
    if id then fclose(id); handles[f] = nil end
  end,
}

function fstat(path)
  local size = fsize(path)
  if size == nil then return nil end
  return { size = size, attrib = size < 0 and 0x10 or 0 }
end

function dir(path)
  local names = list(path)
  if not names then error("dir: no folder " .. tostring(path)) end
  local i = 0
  return function() i = i + 1; return names[i] end
end

function loadScript(path, mode, env)
  local chunk, err = loadtext(path)
  if not chunk then return nil, err end
  if type(env) == "table" then setenv(chunk, env) end
  return chunk
end

local function nothing() end
local function stub() return setmetatable({}, { __index = function() return nothing end }) end
model, lcd, system, serial = stub(), stub(), stub(), stub()
Bitmap = { open = nothing, getSize = function() return 0, 0 end }
lvgl = nil
LCD_W, LCD_H = 480, 272

getTime = clock
getDateTime = function()
  local y, mo, d, h, mi, s = now()
  return { year = y, mon = mo, day = d, hour = h, min = mi, sec = s }
end
getVersion = function() return "2.12.5", "computer", 2, 12, 5, "EdgeTX" end
getGeneralSettings = function() return { imperial = imperial, battMin = 0, battMax = 0 } end
getValue = function() return 0 end
getSourceValue = nothing
getFieldInfo = nothing
getSwitchIndex = nothing
getSwitchName = nothing
getRSSI = function() return 0, 0, 0 end
playFile, playNumber, playHaptic, playTone, playDuration, killEvents = nothing, nothing, nothing, nothing, nothing, nothing
setTelemetryValue = nothing
popupInput, popupWarning, popupConfirmation = nothing, nothing, nothing
del = function() return false end -- nothing is deleted on the card
`;

export interface LuaOptions {
  card: string; // the SD card's root folder
  imperial?: boolean; // the radio's units
  timeLimitMs?: number;
}

// A new Lua state for one task on one card. Not reused: every task starts from the card's files.
export function luaRun(o: LuaOptions): LuaRun {
  const L = lauxlib.luaL_newstate();
  for (const [name, open] of [
    ['_G', lualib.luaopen_base],
    ['string', lualib.luaopen_string],
    ['table', lualib.luaopen_table],
    ['math', lualib.luaopen_math],
  ] as const) {
    lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
    lua.lua_pop(L, 1);
  }

  const writes = new Map<string, Uint8Array>();
  const open = new Map<number, { path: string; data: Uint8Array; pos: number; write: boolean; parts: Uint8Array[] }>();
  let nextId = 1;
  let budget = MAX_READ;
  let deadline = 0;

  const fail = (msg: string): never => {
    throw new LuaError(msg);
  };

  const fullPath = (path: string) => {
    const p = parts(path);
    return p && READABLE.test(path) ? join(o.card, ...p) : undefined;
  };

  // A file as the scripts see it: what they wrote this run, else the card's.
  const readFile = (path: string): Uint8Array | undefined => {
    const written = writes.get(clean(path));
    if (written) return written;
    const full = fullPath(path);
    if (!full) return undefined;
    try {
      const st = statSync(full);
      if (!st.isFile() || st.size > MAX_FILE || st.size > budget) return undefined;
      budget -= st.size;
      return readFileSync(full);
    } catch {
      return undefined;
    }
  };

  const str = (idx: number): string => {
    const s = lua.lua_tolstring(L, idx);
    return s ? decoder.decode(s) : '';
  };

  const fn = (name: string, f: () => number) => {
    lua.lua_pushjsfunction(L, f);
    lua.lua_setglobal(L, to_luastring(name));
  };

  fn('__fopen', () => {
    const path = str(1);
    const mode = str(2);
    if (/^[wa]/.test(mode)) {
      if (!parts(path) || !WRITABLE.test(clean(path))) {
        lua.lua_pushnil(L);
        return 1;
      }
      const old = mode.startsWith('a') ? readFile(path) : undefined;
      open.set(nextId, { path: clean(path), data: new Uint8Array(), pos: 0, write: true, parts: old ? [old] : [] });
    } else {
      const data = readFile(path);
      if (!data) {
        lua.lua_pushnil(L);
        return 1;
      }
      open.set(nextId, { path: clean(path), data, pos: 0, write: false, parts: [] });
    }
    lua.lua_pushinteger(L, nextId++);
    return 1;
  });
  fn('__fread', () => {
    const f = open.get(lua.lua_tointeger(L, 1));
    if (!f || f.write) return 0;
    const n = lua.lua_tointeger(L, 2);
    const end = n < 0 ? f.data.length : Math.min(f.data.length, f.pos + n);
    lua.lua_pushstring(L, f.data.subarray(f.pos, end));
    f.pos = end;
    return 1;
  });
  fn('__fwrite', () => {
    const f = open.get(lua.lua_tointeger(L, 1));
    if (f?.write) f.parts.push(Uint8Array.from(lua.lua_tolstring(L, 2) as Uint8Array));
    return 0;
  });
  fn('__fclose', () => {
    const id = lua.lua_tointeger(L, 1);
    const f = open.get(id);
    open.delete(id);
    if (f?.write) writes.set(f.path, Buffer.concat(f.parts));
    return 0;
  });
  // size of a file, -1 for a folder, nil when there is none
  fn('__fsize', () => {
    const path = str(1);
    const written = writes.get(clean(path));
    const full = fullPath(path);
    let size: number | undefined = written?.length;
    if (size === undefined && full) {
      try {
        const st = statSync(full);
        size = st.isDirectory() ? -1 : st.size;
      } catch {
        // none
      }
    }
    if (size === undefined) lua.lua_pushnil(L);
    else lua.lua_pushinteger(L, size);
    return 1;
  });
  fn('__list', () => {
    const full = fullPath(str(1));
    let names: string[] | undefined;
    try {
      names = full ? readdirSync(full).filter(isSafeName).sort() : undefined;
    } catch {
      names = undefined;
    }
    if (!names) {
      lua.lua_pushnil(L);
      return 1;
    }
    lua.lua_createtable(L, names.length, 0);
    names.forEach((n, i) => {
      lua.lua_pushstring(L, to_luastring(n));
      lua.lua_rawseti(L, -2, i + 1);
    });
    return 1;
  });
  fn('__loadtext', () => {
    const path = str(1);
    const data = /\.lua$/.test(path) && path.startsWith('/SCRIPTS/') ? readFile(path) : undefined;
    if (!data) {
      lua.lua_pushnil(L);
      lua.lua_pushstring(L, to_luastring(`${path}: not found`));
      return 2;
    }
    if (lauxlib.luaL_loadbufferx(L, data, data.length, to_luastring('@' + clean(path)), to_luastring('t')) !== lua.LUA_OK) {
      lua.lua_pushnil(L);
      lua.lua_insert(L, -2);
      return 2;
    }
    return 1;
  });
  // the environment of a loaded chunk is its first upvalue
  fn('__setenv', () => {
    lua.lua_pushvalue(L, 2);
    lua.lua_setupvalue(L, 1, 1);
    return 0;
  });
  fn('__now', () => {
    const d = new Date();
    for (const v of [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]) lua.lua_pushinteger(L, v);
    return 6;
  });
  const t0 = performance.now();
  fn('__clock', () => {
    lua.lua_pushinteger(L, Math.floor((performance.now() - t0) / 10));
    return 1;
  });
  lua.lua_pushinteger(L, o.imperial ? 1 : 0);
  lua.lua_setglobal(L, to_luastring('__imperial'));

  lua.lua_sethook(
    L,
    () => {
      if (Date.now() > deadline) lauxlib.luaL_error(L, to_luastring('script took too long'));
    },
    lua.LUA_MASKCOUNT,
    HOOK_EVERY,
  );

  const protectedCall = (nargs: number, what: string) => {
    deadline = Date.now() + (o.timeLimitMs ?? TIME_LIMIT_MS);
    if (lua.lua_pcall(L, nargs, 1, 0) !== lua.LUA_OK) {
      const msg = str(-1);
      lua.lua_pop(L, 1);
      fail(`${what}: ${msg}`);
    }
  };

  const exec = (code: string, name: string) => {
    const buf = to_luastring(code);
    if (lauxlib.luaL_loadbufferx(L, buf, buf.length, to_luastring('=' + name), to_luastring('t')) !== lua.LUA_OK) fail(`${name}: ${str(-1)}`);
    protectedCall(0, name);
    lua.lua_pop(L, 1);
  };

  exec(PRELUDE, 'prelude');

  const call = (name: string, ...args: unknown[]) => {
    if (lua.lua_getglobal(L, to_luastring(name)) !== lua.LUA_TFUNCTION) fail(`${name}: no such function`);
    for (const a of args) push(L, a, 0);
    protectedCall(args.length, name);
    const out = toJs(L, -1, 0);
    lua.lua_pop(L, 1);
    return out;
  };

  return { call, writes, exec };
}

const MAX_DEPTH = 32;

// A plain value onto the Lua stack: whole numbers as Lua integers, so they stay "25" and not "25.0" when
// the scripts write them back.
function push(L: unknown, v: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new LuaError('value too deep');
  if (v === null || v === undefined) lua.lua_pushnil(L);
  else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
  else if (typeof v === 'number') {
    if (Number.isInteger(v)) lua.lua_pushinteger(L, v);
    else lua.lua_pushnumber(L, v);
  } else if (typeof v === 'string') lua.lua_pushstring(L, to_luastring(v));
  else if (Array.isArray(v)) {
    lua.lua_createtable(L, v.length, 0);
    v.forEach((x, i) => {
      push(L, x, depth + 1);
      lua.lua_rawseti(L, -2, i + 1);
    });
  } else if (typeof v === 'object') {
    lua.lua_createtable(L, 0, 0);
    for (const [k, x] of Object.entries(v)) {
      push(L, x, depth + 1);
      lua.lua_setfield(L, -2, to_luastring(k));
    }
  } else throw new LuaError(`can't pass ${typeof v}`);
}

// A Lua value as plain values: tables with only the keys 1..n become arrays, others objects without a
// prototype (their keys come from the card); functions and the like are left out.
function toJs(L: unknown, idx: number, depth: number): unknown {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return decoder.decode(lua.lua_tolstring(L, idx));
  if (t !== lua.LUA_TTABLE || depth > MAX_DEPTH) return undefined;
  const abs = lua.lua_absindex(L, idx);
  const entries: [string | number, unknown][] = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, abs) !== 0) {
    const kt = lua.lua_type(L, -2);
    const key = kt === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : kt === lua.LUA_TSTRING ? decoder.decode(lua.lua_tolstring(L, -2)) : undefined;
    const value = toJs(L, -1, depth + 1);
    if (key !== undefined && value !== undefined) entries.push([key, value]);
    lua.lua_pop(L, 1);
  }
  const n = entries.length;
  if (n > 0 && entries.every(([k]) => typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= n)) {
    const arr: unknown[] = new Array(n);
    for (const [k, v] of entries) arr[(k as number) - 1] = v;
    return arr;
  }
  const obj: Record<string, unknown> = Object.create(null);
  for (const [k, v] of entries) obj[String(k)] = v;
  return obj;
}
