// Writes the test logs in tests/fixtures/ with the EdgeTX simulator of the Wingman repo
// (Mariator-pro/edgetx-flight-wingman, tools/sim/, needs its VS Code extension and firmware).
// Usage: WINGMAN_REPO=<path to the Wingman repo> node scripts/sim-logs.ts [name | sample]
// (sample: the app's sample flight in assets/sample/, about three minutes)
// Each fixture is a small SD card: RADIO/radio.yml, MODELS/, the cores' settings and LOGS/.
// Runs in real time (about six minutes for all).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const REPO = process.env.WINGMAN_REPO;
if (!REPO) throw new Error('Set WINGMAN_REPO to the Wingman repo.');
const sim = createRequire(import.meta.url)(join(REPO, 'tools/sim/sim-lib.js'));
const OUT = join(import.meta.dirname, '..', 'tests', 'fixtures');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sensors of the cores as after "Discover new sensors"; a function script fills them like the cores would
// (stand-in until the cores have them).
const CORE_SENSORS = [
  ['LNst', 0x5100],
  ['LNpk', 0x5101],
  ['LSst', 0x5102],
  ['GHst', 0x5103],
] as const;
const CORE_SCRIPT = `
local home
local function dist(g)
  if type(g) ~= "table" or not home then return 0 end
  local dy = (g.lat - home.lat) * 111320
  local dx = (g.lon - home.lon) * 111320 * math.cos(math.rad(home.lat))
  return math.sqrt(dx * dx + dy * dy)
end
local function run()
  local lq, rss, capa, sats, g = getValue("RQly"), getValue("1RSS"), getValue("Capa"), getValue("Sats"), getValue("GPS")
  if type(g) == "table" and g.lat ~= 0 and not home then home = { lat = g.lat, lon = g.lon } end
  local rest = 100 - capa / 13
  local ln = (rest <= 20 and 2) or (rest <= 30 and 1) or 0
  local ls = (lq > 0 and lq < 42 and 2) or (rss ~= 0 and rss < -100 and 1) or 0
  local gh = (sats > 0 and sats < 6 and 3) or (dist(g) > 500 and 2) or 0
  setTelemetryValue(0x5100, 0, 0, ln, 0, 0, "LNst")
  setTelemetryValue(0x5101, 0, 0, 2, 0, 0, "LNpk")
  setTelemetryValue(0x5102, 0, 0, ls, 0, 0, "LSst")
  setTelemetryValue(0x5103, 0, 0, gh, 0, 0, "GHst")
end
return { run = run }
`;

const LIPONY = (modelFile: string) => `-- Lipo-Nanny configuration (test data).
return {
  ["batteries"] = {
    {
      ["id"] = "bat_001",
      ["name"] = "Sample 6s 1300mAh",
      ["chemistry"] = "LiPo",
      ["cells"] = 6,
      ["instances"] = {
        { ["id"] = "pack_0001", ["label"] = 1 },
        { ["id"] = "pack_0002", ["label"] = 2 },
      },
    },
  },
  ["models"] = {
    ["${modelFile}"] = { ["batteryIds"] = { "bat_001" }, ["cells"] = 6, ["parallel"] = false },
  },
}
`;

function crc16(buf: Buffer): number {
  let c = 0xffff;
  for (const x of buf) {
    c ^= x << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function sensorYml(index: number, label: string, id: number): string {
  return [`   ${index}:`, '      id1: ', `         id: ${id}`, '      id2: ', '         instance: 0', `      label: "${label}"`, '      subId: 0', '      type: TYPE_CUSTOM', '      unit: 0', '      prec: 0', '      autoOffset: 0', '      filter: 0', '      logs: 1', '      persistent: 0', '      onlyPositive: 0', '      cfg: ', '         custom: ', '            ratio: 0', '            offset: 0', ''].join('\n');
}

interface Setup {
  name: string;
  modelName: string;
  coreSensors: boolean;
  oneLogPerDay?: boolean;
  logTenths?: number; // log interval in 0.1 s, default 1 s
  stickMode?: number; // as in radio.yml, 0 to 3 for mode 1 to 4
}

function prepare(s: Setup): { SD: string; modelPath: string; modelFile: string } {
  const { SD, modelPath } = sim.setupSd('widgets');
  const modelFile = modelPath.split('/').pop()!;
  const radio = join(SD, 'RADIO/radio.yml');
  let body = readFileSync(radio, 'utf8').replace(/^checksum:[^\n]*\n/, '');
  if (s.oneLogPerDay) body = body.replace(/^oneLogPerDay: 0/m, 'oneLogPerDay: 1');
  if (s.stickMode !== undefined) body = body.replace(/^stickMode: \d/m, `stickMode: ${s.stickMode}`);
  writeFileSync(radio, `checksum: ${crc16(Buffer.from(body))}\n${body}`);
  let yml = readFileSync(modelPath, 'utf8').replace(/^(header: *\n(?: {3}.*\n)*? {3}name: )".*"/m, `$1"${s.modelName}"`);
  const fns = ['customFn: ', '   0:', '      swtch: "ON"', '      func: LOGS', `      def: "${s.logTenths ?? 10},1"`];
  if (s.coreSensors) {
    fns.push('   1:', '      swtch: "ON"', '      func: PLAY_SCRIPT', '      def: "cores,1,On"');
    mkdirSync(join(SD, 'SCRIPTS/FUNCTIONS'), { recursive: true });
    writeFileSync(join(SD, 'SCRIPTS/FUNCTIONS/cores.lua'), CORE_SCRIPT);
    yml = addSensors(yml);
  }
  yml = yml.replace(/^potsWarnEnabled:/m, `${fns.join('\n')}\npotsWarnEnabled:`);
  writeFileSync(modelPath, yml);
  writeFileSync(join(SD, 'SCRIPTS/LIPONY/config.lua'), LIPONY(modelFile));
  return { SD, modelPath, modelFile };
}

function addSensors(yml: string): string {
  const used = [...yml.matchAll(/^ {3}(\d+):\n {6}id1:/gm)].map((m) => Number(m[1]));
  let next = Math.max(...used) + 1;
  const add = CORE_SENSORS.map(([label, id]) => sensorYml(next++, label, id)).join('');
  return yml.replace(/^screenData:/m, `${add}screenData:`);
}

const STICK = { rud: 0, ele: 1, thr: 2, ail: 3 } as const;

// Runs scenarios of the Wingman simulator one after another, with sticks that follow the flight.
// telemetry state of the simulator (untyped there)
type Tel = Record<string, any>;
interface Scenario {
  END: number;
  f: (t: number, tel: Tel) => void;
}

async function run(SD: string, scenarios: (string | Scenario)[]): Promise<void> {
  const host = sim.createHost(SD, { frame: () => {} });
  const tel = sim.newTelemetry();
  sim.streamTelemetry(host, tel);
  const stick = (name: keyof typeof STICK, v: number) =>
    host.handleInput({ type: 'simAnalog', index: STICK[name], value: 2048 + Math.round(Math.max(-1, Math.min(1, v)) * 2047) });
  await host.start(sim.findRadio('tx16s'), null);
  await sleep(2000);
  for (const name of scenarios) {
    const sc: Scenario = typeof name === 'string' ? sim.SCENARIOS[name] : name;
    const t0 = Date.now();
    for (;;) {
      const t = (Date.now() - t0) / 1000;
      if (t > sc.END) break;
      sc.f(t, tel);
      const flying = tel.on && tel.fm !== 'ACRO*';
      stick('thr', flying ? 0.1 + 0.3 * Math.sin(t / 3) : -1);
      stick('ail', flying ? Math.max(-1, Math.min(1, tel.roll / 40)) : 0);
      stick('ele', flying ? Math.max(-1, Math.min(1, tel.pitch / 20)) : 0);
      stick('rud', flying ? 0.2 * Math.sin(t) : 0);
      await sleep(100);
    }
  }
  await host.stop();
}

function save(dir: string, SD: string, modelPath: string, modelFile: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'MODELS'), { recursive: true });
  cpSync(join(SD, 'RADIO/radio.yml'), join(dir, 'RADIO/radio.yml'));
  cpSync(modelPath, join(dir, 'MODELS', modelFile));
  for (const core of ['LIPONY', 'SNTNL', 'GPSHOMER']) cpSync(join(SD, 'SCRIPTS', core, 'config.lua'), join(dir, 'SCRIPTS', core, 'config.lua'));
  cpSync(join(SD, 'LOGS'), join(dir, 'LOGS'), { recursive: true });
  rmSync(SD, { recursive: true, force: true });
  console.log(`${dir}: ${readdirSync(join(dir, 'LOGS')).join(', ')}`);
}

const FIXTURES: Record<string, () => Promise<void>> = {
  // Two flights in one log: a flight with warnings, RTH and landing; then a crash far out (search).
  'elrs-two-flights': async () => {
    const s = prepare({ name: 'elrs-two-flights', modelName: 'Sample Quad', coreSensors: true });
    await run(s.SD, ['flight', 'search']);
    save(join(OUT, 'elrs-two-flights'), s.SD, s.modelPath, s.modelFile);
  },
  // One log per day: a flight without the cores' sensors, then they are discovered, then a second flight.
  'daily-sensor-added': async () => {
    const s = prepare({ name: 'daily-sensor-added', modelName: 'Daily Quad', coreSensors: false, oneLogPerDay: true });
    await run(s.SD, ['search']);
    writeFileSync(s.modelPath, addSensors(readFileSync(s.modelPath, 'utf8')));
    await run(s.SD, ['search']);
    save(join(OUT, 'daily-sensor-added'), s.SD, s.modelPath, s.modelFile);
  },
};

// The app's sample flight: a smooth route through waypoints (north, east in m from home), so position, course,
// speed and bank agree; logged every 0.2 s. Out in curves and a loop, weak link far out, a short GPS dropout,
// RTH straight home, landing.
const M_LAT = 89.83; // CRSF units (1e-7 deg) per metre at the simulator's home latitude
const M_LON = 123.9;
const WAYPOINTS: [number, number][] = [
  [0, 0], [40, 0], [120, 50], [200, -30], [290, -60], [380, 0], [450, 110], [560, 150], [640, 80], [650, -40],
  [570, -130], [460, -110], [420, -20], [480, 60],
];

// Catmull-Rom through the waypoints, sampled densely, with the distance along the route
function route(): { pts: [number, number][]; at: number[] } {
  const w = [WAYPOINTS[0]!, ...WAYPOINTS, WAYPOINTS[WAYPOINTS.length - 1]!];
  const pts: [number, number][] = [];
  for (let i = 1; i < w.length - 2; i++) {
    const [p0, p1, p2, p3] = [w[i - 1]!, w[i]!, w[i + 1]!, w[i + 2]!];
    for (let k = 0; k < 50; k++) {
      const u = k / 50;
      const c = (j: 0 | 1) =>
        0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u ** 3);
      pts.push([c(0), c(1)]);
    }
  }
  pts.push(WAYPOINTS[WAYPOINTS.length - 1]!);
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return { pts, at };
}

function sampleScenario(): Scenario {
  const { pts, at } = route();
  const length = at[at.length - 1]!;
  const pos = (d: number): [number, number] => {
    const x = Math.min(length, Math.max(0, d));
    let i = 1;
    while (i < at.length - 1 && at[i]! < x) i++;
    const f = (x - at[i - 1]!) / (at[i]! - at[i - 1]! || 1);
    return [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f];
  };
  const bearing = (a: [number, number], b: [number, number]) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const lerp = (a: number, b: number, t0: number, t1: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  // speed (m/s) over flight time: up to 13 in 6 s, then between 11 and 16
  const speed = (ft: number) => Math.min(1, ft / 6) * (13.5 + 2.5 * Math.sin(ft / 9));
  const T0 = 20; // takeoff
  const dist: number[] = [0]; // distance along the route per 0.1 s
  while (dist[dist.length - 1]! < length) dist.push(dist[dist.length - 1]! + speed(dist.length * 0.1) * 0.1);
  const OUT = dist.length * 0.1; // flight time at the end of the route
  const end = pos(length);
  const RTH = Math.hypot(end[0], end[1]) / 15; // straight home at 15 m/s
  const LAND = 10;
  let capa = 0;
  let last = 0;
  const state = { alt: 0 };

  const battery = (tel: Tel, amps: number, t: number) => {
    capa += (amps * Math.max(0, t - last) * 1000) / 3600;
    last = t;
    tel.capa = Math.round(capa);
    tel.curr10 = Math.round(amps * 10);
    tel.volt10 = Math.round(252 - (40 * capa) / 1300 - amps * 0.15);
    tel.remain = Math.max(0, Math.round(100 - capa / 13));
  };
  const place = (tel: Tel, n: number, e: number) => {
    tel.lat = Math.round(437654321 + n * M_LAT);
    tel.lon = Math.round(-792345678 + e * M_LON);
  };
  const link = (tel: Tel, d: number) => {
    tel.rssi = Math.round(48 + d / 16 + 2 * Math.sin(last * 1.7));
    tel.rssi2 = tel.rssi + 4;
    tel.lq = 100;
    tel.tpwrIdx = sim.TPWR_IDX[d > 350 ? 250 : 100];
  };

  return {
    END: T0 + OUT + RTH + LAND + 12,
    f(t, tel) {
      if (t < 4) {
        tel.on = false;
        return;
      }
      tel.on = true;
      if (t < T0) {
        // on the ground, disarmed: satellites come in
        tel.fm = 'ACRO*';
        place(tel, 0, 0);
        Object.assign(tel, { alt: 0, gspd10: 0, roll: 0, pitch: 0, hdg100: 0, yaw: 0 });
        tel.sats = Math.round(lerp(6, 13, 4, 12, t));
        tel.dop100 = Math.round(lerp(400, 110, 4, 12, t));
        link(tel, 0);
        tel.tpwrIdx = sim.TPWR_IDX[25];
        last = t;
        battery(tel, 0.5, t);
        return;
      }
      const ft = t - T0;
      tel.sats = 13;
      tel.dop100 = 110;
      if (ft < OUT) {
        const i = Math.min(dist.length - 1, Math.floor(ft / 0.1));
        const d = dist[i]! + (dist[Math.min(dist.length - 1, i + 1)]! - dist[i]!) * (ft / 0.1 - i);
        const [n, e] = pos(d);
        const v = speed(ft);
        const h1 = bearing([n, e], pos(d + 3));
        const h2 = bearing(pos(d + 3), pos(d + 6));
        const turn = ((((h2 - h1 + 540) % 360) - 180) * v) / 3; // deg/s
        const hdg = (h1 + 360) % 360;
        tel.fm = ft < 15 ? 'STAB' : 'ACRO';
        // climb to 70 m, then up and down; higher far out
        const alt = Math.min(1, ft / 10) * (70 + 18 * Math.sin(ft / 7) + 25 * Math.max(0, (Math.hypot(n, e) - 400) / 250));
        tel.alt = Math.round(alt);
        place(tel, n, e);
        tel.hdg100 = Math.round(hdg * 100);
        tel.yaw = hdg > 180 ? hdg - 360 : hdg;
        tel.gspd10 = Math.round(v * 36);
        tel.roll = Math.max(-55, Math.min(55, (Math.atan((v * turn * Math.PI) / 180 / 9.81) * 180) / Math.PI));
        tel.pitch = -(3 + v * 1.2) + Math.max(0, alt - state.alt) * 4;
        const far = Math.hypot(n, e);
        link(tel, far);
        // weak link far out, for a few seconds; a short GPS dropout on the way out
        if (ft > OUT - 14 && ft < OUT - 9) {
          tel.lq = Math.round(lerp(90, 36, OUT - 14, OUT - 11, ft));
          tel.rssi = 104;
          tel.rssi2 = 108;
          tel.tpwrIdx = sim.TPWR_IDX[500];
        }
        if (ft > OUT * 0.45 && ft < OUT * 0.45 + 4) {
          tel.sats = 4;
          tel.dop100 = 650;
        }
        battery(tel, 8 + v * 0.9 + Math.max(0, alt - state.alt) * 30, t);
        state.alt = alt;
        return;
      }
      const rt = ft - OUT;
      if (rt < RTH) {
        // RTH: straight home at 15 m/s, sinking to 20 m
        const f = rt / RTH;
        const n = end[0] * (1 - f);
        const e = end[1] * (1 - f);
        const hdg = (bearing(end, [0, 0]) + 360) % 360;
        tel.fm = 'RTH';
        place(tel, n, e);
        tel.alt = Math.round(lerp(state.alt, 20, 0, RTH, rt));
        tel.hdg100 = Math.round(hdg * 100);
        tel.yaw = hdg > 180 ? hdg - 360 : hdg;
        tel.gspd10 = Math.round(15 * 36 * Math.min(1, (RTH - rt) / 3 + 0.2));
        tel.roll = 0;
        tel.pitch = -12;
        link(tel, Math.hypot(n, e));
        battery(tel, 18, t);
        return;
      }
      const lt = rt - RTH;
      if (lt < LAND) {
        // back in control: hover down next to home
        tel.fm = 'ACRO';
        place(tel, lerp(0, 6, 0, LAND, lt), lerp(0, 4, 0, LAND, lt));
        tel.alt = Math.round(lerp(20, 0, 0, LAND, lt));
        tel.gspd10 = Math.round(lt < LAND - 1 ? 30 : 0);
        tel.roll = 0;
        tel.pitch = -2;
        link(tel, 10);
        battery(tel, 14, t);
        return;
      }
      tel.fm = 'ACRO*';
      Object.assign(tel, { alt: 0, gspd10: 0, roll: 0, pitch: 0 });
      battery(tel, 0.5, t);
      if (lt > LAND + 6) tel.on = false;
    },
  };
}

// The app's sample flight (assets/sample/): the flight above as a small SD card of its own.
async function sample(): Promise<void> {
  const { analyseLogs, logsAt } = await import('../src/core/store.ts');
  const { toCsv } = await import('../src/core/export.ts');
  const s = prepare({ name: 'sample', modelName: 'Sample Quad', coreSensors: true, logTenths: 2, stickMode: 1 });
  await run(s.SD, [sampleScenario()]);
  const tmp = join(OUT, '.sample');
  save(tmp, s.SD, s.modelPath, s.modelFile);
  const [a] = await analyseLogs(await logsAt(tmp));
  const dir = join(import.meta.dirname, '..', 'assets', 'sample');
  rmSync(dir, { recursive: true, force: true });
  for (const sub of ['RADIO', 'MODELS', 'SCRIPTS']) cpSync(join(tmp, sub), join(dir, sub), { recursive: true });
  mkdirSync(join(dir, 'LOGS'), { recursive: true });
  writeFileSync(join(dir, 'LOGS', a!.file), toCsv(a!, a!.flights[0]!));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${dir}: ${a!.file}, flight 1 of ${a!.flights.length}`);
}

const only = process.argv[2];
for (const [name, make] of Object.entries(FIXTURES)) if (!only || only === name) await make();
if (!only || only === 'sample') await sample();
process.exit(0);
