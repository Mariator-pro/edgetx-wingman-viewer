// Reads the settings files the cores write on the SD card ("return { ["key"] = value, ... }"): a Lua table
// literal with strings, numbers, booleans and nested tables. Only data, nothing is executed; anything else is
// an error. Tables with only positional entries become arrays, others objects without a prototype.

export type LuaValue = string | number | boolean | null | LuaValue[] | { [key: string]: LuaValue };

const MAX_DEPTH = 32;

export function parseLuaTable(text: string): LuaValue {
  let i = 0;

  const fail = (what: string): never => {
    throw new Error(`Lua table: ${what} at ${i}`);
  };

  function skip(): void {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith('--', i)) {
        const long = /^--\[(=*)\[/.exec(text.slice(i, i + 64));
        if (long) {
          const end = text.indexOf(`]${long[1]}]`, i);
          i = end < 0 ? text.length : end + long[1]!.length + 2;
        } else {
          const nl = text.indexOf('\n', i);
          i = nl < 0 ? text.length : nl + 1;
        }
        continue;
      }
      return;
    }
  }

  function string(): string {
    const q = text[i++];
    let out = '';
    while (i < text.length && text[i] !== q) {
      const c = text[i++]!;
      if (c === '\n') fail('line break in string');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '\n': '\n', a: '\x07', b: '\b', f: '\f', v: '\v' };
      if (e !== undefined && e in map) out += map[e];
      else if (e !== undefined && /\d/.test(e)) {
        let digits = e;
        while (digits.length < 3 && /\d/.test(text[i] ?? '')) digits += text[i++];
        out += String.fromCharCode(Number(digits));
      } else fail('unknown escape');
    }
    if (text[i] !== q) fail('unterminated string');
    i++;
    return out;
  }

  function number(): number {
    const m = /^-?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) fail('number expected');
    const s = m![0];
    i += s.length;
    const sign = s.startsWith('-') ? -1 : 1;
    const body = sign < 0 ? s.slice(1) : s;
    return sign * (/^0[xX]/.test(body) ? parseInt(body.slice(2), 16) : Number(body));
  }

  function value(depth: number): LuaValue {
    skip();
    const c = text[i];
    if (c === '{') return table(depth + 1);
    if (c === '"' || c === "'") return string();
    if (c === '-' || c === '.' || (c !== undefined && /\d/.test(c))) return number();
    for (const [word, v] of [['true', true], ['false', false], ['nil', null]] as const) {
      if (text.startsWith(word, i) && !/\w/.test(text[i + word.length] ?? '')) {
        i += word.length;
        return v;
      }
    }
    return fail('value expected');
  }

  function table(depth: number): LuaValue {
    if (depth > MAX_DEPTH) fail('too deep');
    i++; // {
    const keyed: { [key: string]: LuaValue } = Object.create(null);
    const list: LuaValue[] = [];
    for (;;) {
      skip();
      if (text[i] === '}') {
        i++;
        break;
      }
      let key: string | undefined;
      if (text[i] === '[') {
        i++;
        skip();
        const k = value(depth);
        if (typeof k !== 'string' && typeof k !== 'number') fail('key must be a string or number');
        key = String(k);
        skip();
        if (text[i++] !== ']') fail('] expected');
        skip();
        if (text[i++] !== '=') fail('= expected');
      } else {
        const m = /^[A-Za-z_]\w*\s*=(?!=)/.exec(text.slice(i));
        if (m) {
          key = m[0].replace(/\s*=$/, '');
          i += m[0].length;
        }
      }
      const v = value(depth);
      if (key === undefined) list.push(v);
      else keyed[key] = v;
      skip();
      if (text[i] === ',' || text[i] === ';') i++;
      else if (text[i] !== '}') fail(', or } expected');
    }
    const keys = Object.keys(keyed);
    if (keys.length === 0) return list;
    // Positional entries next to keyed ones keep their Lua index as key
    list.forEach((v, n) => {
      if (!(String(n + 1) in keyed)) keyed[String(n + 1)] = v;
    });
    return keyed;
  }

  skip();
  if (text.startsWith('return', i)) i += 'return'.length;
  const result = value(0);
  skip();
  if (i < text.length) fail('unexpected text after the table');
  return result;
}

export const isTable = (v: unknown): v is { [key: string]: LuaValue } => typeof v === 'object' && v !== null && !Array.isArray(v);
