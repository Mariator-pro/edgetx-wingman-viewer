import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dropAppleDouble } from './appledouble.ts';
import { AppError } from './errors.ts';
import { LuaError, luaRun, type LuaRun } from './lua.ts';
import { isSafeName, printable } from './paths.ts';
import { isModelFile, parseModelYml, readYaml, RADIO_SETTINGS } from './projects.ts';

// Flight Bag on the computer: the settings of the user's Lua apps on a connected radio, with the same fields,
// rules and page logic the radio's Flight Bag uses. Its files on the card run in the Lua sandbox; what they
// write is put on the card here through a new file that then replaces the old one.

import {
  isFlightBagPage,
  type AppDetailView,
  type AppInfoView,
  type AssignView,
  type BatteriesView,
  type BatteryDraft,
  type BatteryEditView,
  type BatteryView,
  type Edits,
  type FlightBagPage,
  type FlightBagView,
  type LastFlightView,
  type ModelDraft,
  type ModelEditView,
  type ModelsView,
  type ModelSummary,
  type ModuleView,
  type PackDraft,
  type RowView,
  type SensorFieldView,
  type SoundOptionView,
} from './flightbag-view.ts';

export { isFlightBagPage } from './flightbag-view.ts';

// The viewer's Lua side: loads Flight Bag's shared files from the card and turns the page model into plain
// values. Runs inside the sandbox with the card's files.
const GLUE = `
local A, apps
local makers = {}

-- The radio's active model as the page logic asks for it, and the telemetry sensors of that model's file.
-- On the computer every model opened for editing counts as active, so its sensors can be chosen.
local active, sensorNames = nil, {}
model.getInfo = function()
  if active then return { filename = active, name = A and A.modelName(active) or active } end
end
model.getSensor = function(i)
  local n = sensorNames[i + 1]
  if n then return { name = n } end
end

local function need(path)
  local chunk, err = loadScript(path)
  if not chunk then error("missing:" .. path, 0) end
  return chunk()
end

-- The language of this program's interface: Flight Bag's files and the apps give their texts in it
-- (where they offer it; older ones are English only).
local wanted = "en"
function fb_lang(code) wanted = code end

-- A text of Flight Bag's own language files, or the English of older files.
local function langText(area, id, english)
  if type(A.t) == "function" then return A.t(area, id) end
  return english
end

-- The interface of Flight Bag's files this program understands: { 1, >= 0 }, from apps.lua's A.API.
local API_MAJOR = 1
local function start()
  if A then return end
  A = need("/SCRIPTS/FLIGHTBAG/apps.lua")
  local major = type(A.API) == "table" and A.API[1] or nil
  if type(major) ~= "number" or major < API_MAJOR then error("flightbag:old", 0) end
  if major > API_MAJOR then error("flightbag:new", 0) end
  if type(A.setLang) == "function" then A.setLang(wanted) end
  apps = A.scan()
end

-- The page logic of a page: its own file, or the shared one for pages of fields.
local FILES = { batteries = "batteries_model.lua", models = "models_model.lua", flights = "flights_model.lua" }
local function maker(id)
  local file = FILES[id] or "settings_model.lua"
  if not makers[file] then makers[file] = need("/SCRIPTS/FLIGHTBAG/" .. file) end
  return makers[file]
end

local function pageOf(id)
  for _, p in ipairs(A.PAGES) do if p.id == id then return p end end
end

local function open(id)
  local p = pageOf(id)
  if not p then error("page:" .. tostring(id), 0) end
  local list = A.pageApps(apps, p)
  return maker(id)({ lib = A, apps = list, allApps = apps, id = id, title = p.label, close = function() end }), list
end

local function sharedApps(list, key)
  local out = {}
  for _, app in ipairs(list) do
    if app.cfg then
      for _, f in ipairs(app.man.fields or {}) do
        if f.key == key and f.shared then out[#out + 1] = app.folder end
      end
    end
  end
  return out
end

local function rowId(r)
  if r.kind == "shared" then return "shared:" .. r.key end
  if r.kind == "field" then return "field:" .. r.block.app.folder .. ":" .. r.field.key end
  if r.kind == "sound" then return "sound:" .. r.block.app.folder .. ":" .. r.key end
  if r.kind == "fix" then return "fix:" .. r.block.app.folder end
  if r.kind == "head" then return "head:" .. r.text end
end

local function fieldView(f)
  local unit = f.unit
  if type(unit) == "function" then
    local ok, u = pcall(unit, {})
    unit = ok and type(u) == "string" and u or nil
  end
  local kind = f.type == "bool" and "bool" or f.type == "choice" and "choice" or "number"
  return {
    key = f.key, label = f.label, type = kind, min = f.min, max = f.max, step = f.step,
    default = f.default, unit = unit, prefix = f.prefix, offValue = f.off,
    choices = f.choices, labels = f.labels, hint = f.hint,
  }
end

local function soundId(name)
  if name == false then return "off" end
  if name == nil then return "default" end
  return "file:" .. name
end

-- A value the page may take for field f: of its kind, within its limits and on its steps.
local function valid(f, v)
  if f.type == "bool" then return type(v) == "boolean" end
  if f.type == "choice" then
    for _, c in ipairs(f.choices or {}) do if c == v then return true end end
    return false
  end
  if math.type(v) == nil then return false end
  if f.off ~= nil and v == f.off then return true end
  if f.min and v < f.min or f.max and v > f.max then return false end
  local step = f.step or 1
  local i = (v - (f.min or 0)) / step
  return math.abs(i - math.floor(i + 0.5)) < 1e-9
end

local function apply(M, edits)
  for _, r in ipairs(M.rows) do
    local id = rowId(r)
    local v = id and edits[id]
    if v ~= nil then
      if r.kind == "sound" then
        local found
        for i, o in ipairs(M.soundOptions(r.block)) do
          if soundId(o.name) == v then found = i end
        end
        if not found then error("invalid:" .. id, 0) end
        M.setSound(r, found)
      elseif r.kind == "shared" or r.kind == "field" then
        if not valid(r.field, v) then error("invalid:" .. id, 0) end
        M.setValue(r, v)
      end
    end
  end
end

local function describe(M, list, id)
  local rows = {}
  for _, r in ipairs(M.rows) do
    local v = { id = rowId(r), kind = r.kind, disabled = r.off == true }
    if r.kind == "head" then
      v.text = r.text
    elseif r.kind == "fix" then
      v.app, v.fix = r.block.app.folder, r.block.err == "missing" and "noConfig" or "damaged"
      v.text, v.button, v.ask = r.text, r.button, r.ask
    elseif r.kind == "shared" or r.kind == "field" then
      v.field = fieldView(r.field)
      local value, mixed = M.getValue(r), false
      if r.kind == "shared" then
        v.apps = sharedApps(list, r.key)
        v.app = v.apps[1]
        mixed = value == nil
      else
        v.app = r.block.app.folder
      end
      v.value, v.mixed = value, mixed
      v.hint = M.hintOf(r)   -- the row's help as the radio shows it: value filled in, or the note on a mixed value
    elseif r.kind == "sound" then
      local b = r.block
      v.app = b.app.folder
      local opts = {}
      for i, o in ipairs(M.soundOptions(b)) do opts[i] = { id = soundId(o.name), label = o.label } end
      local name = b.snd[r.key]
      local file = name
      if type(file) ~= "string" then file = b.core.SOUND_DEFAULTS and b.core.SOUND_DEFAULTS[r.key] end
      if name == false then file = nil end
      local chosen = opts[M.soundIndex(r)]
      v.sound = { key = r.key, label = r.label, hint = r.hint, options = opts,
                  value = chosen and chosen.id or "default",
                  play = file and (b.core.SOUND_DIR .. file) or nil }
    end
    rows[#rows + 1] = v
  end
  local pages = {}
  for _, p in ipairs(A.menu(apps)) do pages[#pages + 1] = p.id end
  local info = {}
  for _, a in ipairs(apps) do
    info[#info + 1] = { folder = a.folder, name = a.name or a.folder, version = a.version, ok = a.ok == true }
  end
  return { pages = pages, page = id, rows = rows, apps = info }
end

-- ---------------------------------------------------------------------------
-- Batteries
-- ---------------------------------------------------------------------------

local function lipo(list)
  for _, a in ipairs(list) do if a.folder == "LIPONY" then return a end end
end

local function draftOf(prof)
  local packs = {}
  for i, p in ipairs(prof.instances) do
    packs[i] = { id = p.id, label = p.label, cycles = p.cycles or 0, wear = p.wear or 0, buyDate = p.buyDate,
                 totalMah = p.totalMah, minVCell = p.minVCell, lastUsed = p.lastUsed }
  end
  return { name = prof.name, nameAuto = prof.nameAuto, manufacturer = prof.manufacturer,
           chemistry = prof.chemistry, capacityMah = prof.capacityMah, cells = prof.cells,
           warnPct = prof.warnPct, critPct = prof.critPct, packs = packs }
end

local function describeBatteries(M, list)
  local out = { broken = M.broken == true, list = {}, chemistries = M.CHEM_NAMES or {}, maxPacks = M.MAX_PACKS,
                textMax = { name = M.TEXT_MAX.name, manufacturer = M.TEXT_MAX.mfr } }
  if M.broken then return out end
  local cfg = lipo(list).cfg
  local L = M.LIMITS
  out.warnPct, out.critPct = cfg.warnPct, cfg.critPct
  out.limits = { capacityMah = L.capacityMah, cells = L.cells, wear = L.wear, warnPct = L.warnPct, critPct = L.critPct }
  for _, b in ipairs(M.sorted()) do
    M.open(b)
    local v = draftOf(M.prof)
    v.id = b.id
    v.models = {}
    for file, m in pairs(cfg.models or {}) do
      for _, bid in ipairs(m.batteryIds or {}) do
        if bid == b.id then v.models[#v.models + 1] = A.modelName(file); break end
      end
    end
    table.sort(v.models)
    out.list[#out.list + 1] = v
  end
  return out
end

local function text(v, max)
  if type(v) ~= "string" or #v > max then error("invalid:text", 0) end
  return v
end
local function whole(v)
  if math.type(v) ~= "integer" then error("invalid:number", 0) end
  return v
end
local function rule(msg) if msg then error("rule:" .. msg, 0) end end

local function freshPacks(M)
  local out = {}
  for _, inst in ipairs(M.prof.instances) do if not inst.id then out[#out + 1] = inst end end
  return out
end

-- Plays the dialog's battery into the page logic, step by step as on the radio, so its rules hold.
local function applyDraft(M, d, cfg)
  if type(d) ~= "table" then return end
  M.setText(2, text(d.manufacturer, M.TEXT_MAX.mfr))
  local chem
  for i, c in ipairs(M.CHEM_NAMES) do if c == d.chemistry then chem = i end end
  if not chem then error("invalid:chemistry", 0) end
  M.setChemistry(chem)
  M.setCapacity(whole(d.capacityMah))
  M.setCells(whole(d.cells))
  if d.nameAuto == true then M.resetName() else M.setText(1, text(d.name, M.TEXT_MAX.name)) end
  if d.warnPct ~= nil and d.critPct ~= nil then
    M.setPct("warnPct", whole(d.warnPct)); M.setPct("critPct", whole(d.critPct))
  else
    M.setPct("warnPct", cfg.warnPct); M.setPct("critPct", cfg.critPct)
  end
  local packs = type(d.packs) == "table" and d.packs or {}
  local keep, want = {}, {}
  for _, dp in ipairs(packs) do
    if type(dp) ~= "table" then error("invalid:pack", 0) end
    if dp.id then keep[dp.id] = true else want[#want + 1] = dp end
  end
  -- new packs first, so retiring the old ones never meets "last pack"
  while #freshPacks(M) < #want do rule(M.addPack()) end
  for i = #M.prof.instances, 1, -1 do
    local inst = M.prof.instances[i]
    if inst.id and not keep[inst.id] then rule(M.archiveLocked()); M.removePack(i) end
  end
  while #freshPacks(M) > #want do
    rule(M.archiveLocked())
    local f = freshPacks(M)
    for i, inst in ipairs(M.prof.instances) do if inst == f[#f] then M.removePack(i); break end end
  end
  local byId, fresh, k = {}, freshPacks(M), 0
  for _, inst in ipairs(M.prof.instances) do if inst.id then byId[inst.id] = inst end end
  for _, dp in ipairs(packs) do
    local inst
    if dp.id then
      inst = byId[dp.id]
      if not inst then error("invalid:pack", 0) end
    else
      k = k + 1
      inst = fresh[k]
    end
    M.setCycles(inst, whole(dp.cycles))
    M.setWear(inst, whole(dp.wear))
    if dp.buyDate ~= nil then
      local months = M.Buy.toMonths(text(dp.buyDate, 7))
      if not months then error("invalid:buyDate", 0) end
      M.setBuy(inst, months)
    end
  end
end

function fb_battery(id, draft, action)
  start()
  local M, list = open("batteries")
  if M.broken then error("invalid:broken", 0) end
  local existing
  if id then
    for _, b in ipairs(M.sorted()) do if b.id == id then existing = b end end
    if not existing then error("invalid:battery", 0) end
  end
  M.open(existing)
  applyDraft(M, draft, lipo(list).cfg)
  if action == "save" or action == "delete" then
    local why
    if action == "save" then why = M.invalid() else why = M.deleteBlocked() end
    if why then return { problem = why } end
    if action == "save" then M.commit() else M.delete() end
    if not M.write() then error("write", 0) end
    return { done = true }
  end
  return { draft = draftOf(M.prof), isNew = M.isNew, dirty = M.dirty(), invalid = M.invalid(),
           archiveLocked = M.archiveLocked(), deleteBlocked = (not M.isNew) and M.deleteBlocked() or nil,
           deleteQuestion = M.deleteQuestion(), full = #M.prof.instances >= M.MAX_PACKS }
end

-- ---------------------------------------------------------------------------
-- Models
-- ---------------------------------------------------------------------------

local function appOf(list, folder)
  for _, a in ipairs(list) do if a.folder == folder then return a end end
end

local function profile(cfg, id)
  for _, b in ipairs(cfg and cfg.batteries or {}) do if b.id == id then return b end end
end

local function lines(desc)
  return type(desc) == "table" and table.concat(desc, " ") or desc
end

local function modulesOf(M)
  local out = {}
  for _, k in ipairs(M.moduleKeys()) do
    local m = M.MODULES[k] or {}
    out[#out + 1] = { key = k, label = m.label or k, desc = lines(m.desc) }
  end
  return out
end

local function exists(path)
  local ok, st = pcall(fstat, path)
  return ok and st ~= nil
end

local function describeModels(M, list, current)
  local lip, wing = appOf(list, "LIPONY"), appOf(list, "WINGMAN")
  local out = { broken = M.broken == true, lipo = lip ~= nil and lip.cfg ~= nil, wingman = wing ~= nil and wing.cfg ~= nil,
                wingmanBroken = wing ~= nil and wing.cfg == nil, list = {}, modules = {} }
  if M.broken then return out end
  if out.wingman then out.modules = modulesOf(M) end
  active = current
  local keys = M.list()
  local seen = {}
  for _, k in ipairs(keys) do
    seen[k] = true
    M.open(k)
    local m = M.model
    local v = { file = k, name = M.name(k), configured = true, active = k == current, onCard = exists("/MODELS/" .. k) }
    if out.lipo then
      v.cells, v.parallel, v.customSensors = m.cells, m.parallel, M.sensorsAreCustom(m.sensors)
      v.batteries = {}
      for _, id in ipairs(m.batteryIds) do
        local p = profile(lip.cfg, id)
        if p then v.batteries[#v.batteries + 1] = p.name end
      end
    end
    if m.mods then v.mods = m.mods end
    out.list[#out.list + 1] = v
  end
  local ok, files = pcall(function()
    local f = {}
    for name in dir("/MODELS") do f[#f + 1] = name end
    return f
  end)
  for _, name in ipairs(ok and files or {}) do
    if string.match(name, "^[Mm][Oo][Dd][Ee][Ll]%d+%.[Yy][Mm][Ll]$") and not seen[name] then
      out.list[#out.list + 1] = { file = name, name = A.modelName(name), configured = false, active = name == current, onCard = true }
    end
  end
  return out
end

local function modelDraft(M)
  local m = M.model
  local ids = {}
  for i, id in ipairs(m.batteryIds or {}) do ids[i] = id end
  local sensors = {}
  for _, f in ipairs(M.SENSOR_FIELDS) do sensors[f.key] = m.sensors[f.key] end
  return { cells = m.cells, parallel = m.parallel, batteryIds = ids, sensors = sensors, mods = m.mods }
end

-- Plays the dialog's model into the page logic: the same steps as on the radio's battery, sensor and
-- module screens.
local function applyModel(M, d, lip)
  if type(d) ~= "table" then return end
  local m = M.model
  if lip then
    local L = M.LIMITS.cells
    local c = whole(d.cells)
    if c < L.min or c > L.max then error("invalid:cells", 0) end
    m.cells = c
    m.parallel = d.parallel == true
    local ids, seen = {}, {}
    for _, id in ipairs(type(d.batteryIds) == "table" and d.batteryIds or {}) do
      if type(id) ~= "string" or seen[id] or not profile(lip.cfg, id) then error("invalid:battery", 0) end
      seen[id] = true
      ids[#ids + 1] = id
    end
    m.batteryIds = ids
    local s = type(d.sensors) == "table" and d.sensors or {}
    for _, f in ipairs(M.SENSOR_FIELDS) do
      local v = s[f.key]
      if v == "" then v = nil end
      if v ~= m.sensors[f.key] then
        local labels = M.sensorChoices(f)
        local found
        if f.unit then
          if v == nil then found = 1 elseif v == "pct" then found = 2 end
        elseif v == nil then
          found = 1
        else
          for i = 2, #labels do if labels[i] == v then found = i end end
        end
        if not found then error("invalid:sensor", 0) end
        M.setSensor(f, found)
      end
    end
  end
  if m.mods and type(d.mods) == "table" then
    for _, k in ipairs(M.moduleKeys()) do
      if d.mods[k] ~= nil then m.mods[k] = d.mods[k] == true end
    end
  end
end

function fb_model(file, draft, action, names)
  start()
  local M, list = open("models")
  if M.broken then error("invalid:broken", 0) end
  if type(file) ~= "string" or not string.match(file, "^[%w_%-%.]+$") then error("invalid:model", 0) end
  local lip = appOf(list, "LIPONY")
  if lip and not lip.cfg then lip = nil end
  active, sensorNames = file, type(names) == "table" and names or {}
  M.open(file)
  M.openSensors()
  applyModel(M, draft, lip)
  if action == "save" then
    if lip then
      if M.otherCells() > 0 then M.dropOtherCells() end
      if M.smallProfiles() > 0 then M.dropSmallProfiles() end
      if M.parallelInvalid() then
        return { problem = langText("rules", "parallelNeedsTwo", "Parallel mode needs a profile with 2+ packs") }
      end
    end
    local l, w = M.commit()
    if l and not M.writeLipo() then error("write", 0) end
    if w and not M.writeWing() then error("write", 0) end
    return { done = true }
  elseif action == "delete" then
    if M.isNew then error("invalid:model", 0) end
    local l, w = M.delete()
    if l and not M.writeLipo() then error("write", 0) end
    if w and not M.writeWing() then error("write", 0) end
    return { done = true }
  end
  local v = { file = file, name = M.name(file), draft = modelDraft(M), isNew = M.isNew == true, dirty = M.dirty() }
  if lip then
    v.cellLimit = M.LIMITS.cells
    v.otherCells, v.smallProfiles, v.parallelInvalid = M.otherCells(), M.smallProfiles(), M.parallelInvalid()
    v.parallelProblem = langText("rules", "parallelNeedsTwo", "Parallel mode needs a profile with 2+ packs")
    v.assign = {}
    for i, it in ipairs(M.assignItems()) do
      local p = profile(lip.cfg, it.id)
      v.assign[i] = { id = it.id, name = it.name, checked = it.checked, selectable = it.selectable,
                      packs = p and #(p.instances or {}) or 0 }
    end
    v.sensors = {}
    for _, f in ipairs(M.SENSOR_FIELDS) do
      local labels = M.sensorChoices(f)
      local options = {}
      if not f.unit then for i = 2, #labels do options[#options + 1] = labels[i] end end
      v.sensors[#v.sensors + 1] = { key = f.key, label = f.label, desc = lines(f.desc), unit = f.unit ~= nil,
                                    default = lip.core.DEFAULT_SENSORS and lip.core.DEFAULT_SENSORS[f.key],
                                    options = options }
    end
    v.customSensors = M.sensorsAreCustom(M.model.sensors)
  end
  if M.model.mods then v.modules = modulesOf(M) end
  return v
end

-- ---------------------------------------------------------------------------
-- Last flights
-- ---------------------------------------------------------------------------

local function describeFlights(M)
  local out = {}
  for i, e in ipairs(M.flights) do
    out[i] = { date = e.date, time = e.time, model = e.model, lat = e.lat, lon = e.lon,
               latText = M.coord(e.lat), lonText = M.coord(e.lon), url = M.url(e) }
  end
  return out
end

function fb_view(id, edits, current)
  start()
  local M, list = open(id)
  if id == "batteries" then
    local v = describe({ rows = {} }, list, id)
    v.batteries = describeBatteries(M, list)
    return v
  end
  if id == "models" then
    local v = describe({ rows = {} }, list, id)
    v.models = describeModels(M, list, current)
    return v
  end
  if id == "flights" then
    local v = describe({ rows = {} }, list, id)
    v.flights = describeFlights(M)
    return v
  end
  apply(M, edits or {})
  return describe(M, list, id)
end

function fb_save(id, edits)
  start()
  local M = open(id)
  apply(M, edits or {})
  return M.save()
end

-- The manifest's reset behind an action of the popup, which doesn't carry its id: the one that runs the same.
local function resetOf(app, act)
  for _, r in ipairs(app.man and app.man.resets or {}) do
    if r.run == act.run then return r end
  end
end

-- Every app as the popup shows it. The radio's active model counts for setup errors, with the sensors its
-- file lists as found (the radio keeps them there), so a sensor the radio knows isn't reported missing.
function fb_apps(current, names)
  start()
  active, sensorNames = current, type(names) == "table" and names or {}
  getFieldInfo = function(name)
    for _, n in ipairs(sensorNames) do if n == name then return { name = n } end end
  end
  local out = {}
  for _, app in ipairs(apps) do
    if app.ok then A.load(app) end
    local v = { folder = app.folder, name = app.name or app.folder, version = app.version, ok = app.ok == true,
                sign = A.needsSign(app) and true or false, icon = fstat(app.base .. "icon.png") ~= nil,
                url = app.man and app.man.url, about = {}, setupErrors = {}, files = {}, resets = {} }
    if not app.ok or app.loadError then v.problem = "update"
    elseif app.noConfig then v.problem = "noConfig"
    elseif app.err then v.problem = "damaged" end
    for i, l in ipairs(A.popupLines(app)) do
      if i > 1 and not l[2] and l[1] ~= v.url then v.about[#v.about + 1] = l[1] end
    end
    if not v.problem then
      for _, e in ipairs(app.setupErrs or {}) do v.setupErrors[#v.setupErrors + 1] = tostring(e) end
    end
    for _, act in ipairs(A.popupActions(app)) do
      if act.rows then
        for _, r in ipairs(act.rows) do v.files[#v.files + 1] = { label = r[1], path = r[2] } end
      elseif app.noConfig or app.err then
        v.fix, v.fixLabel, v.fixAsk = true, act.label, act.ask
      else
        -- a reset of the manifest, known only by its id: one without (older app versions) isn't offered
        local r = resetOf(app, act)
        if r and type(r.id) == "string" then v.resets[#v.resets + 1] = { id = r.id, label = act.label, ask = act.ask, desc = r.desc } end
      end
    end
    A.unload(apps)
    out[#out + 1] = v
  end
  return out
end

-- Runs one action of an app's popup: the reset with this id of its manifest, or without an id the action
-- for a missing or damaged settings file.
function fb_action(folder, id, current)
  start()
  active = current
  for _, app in ipairs(apps) do
    if app.folder == folder and app.ok and A.load(app) then
      for _, act in ipairs(A.popupActions(app)) do
        local r = act.run and resetOf(app, act)
        if act.run and (id == nil and not r and (app.noConfig or app.err) or id ~= nil and r and r.id == id) then
          if not A.runAction(apps, app, act) then error("rule:save failed, check SD card", 0) end
          return true
        end
      end
    end
  end
  error("invalid:action", 0)
end

function fb_fix(id, folder)
  start()
  local M = open(id)
  for _, r in ipairs(M.rows) do
    if r.kind == "fix" and r.block.app.folder == folder then
      if not M.fixWrite(r) then error("fix:" .. folder, 0) end
      return true
    end
  end
  error("invalid:fix:" .. tostring(folder), 0)
end
`;

// The radio's units and its active model, from its settings file.
async function radioSettings(card: string): Promise<{ imperial: boolean; current?: string }> {
  try {
    const y = readYaml(await readFile(join(card, ...RADIO_SETTINGS.split('/')), 'utf8'));
    const o = typeof y === 'object' && y !== null ? (y as Record<string, unknown>) : {};
    const current = typeof o.currModelFilename === 'string' && isModelFile(o.currModelFilename) ? o.currModelFilename : undefined;
    return { imperial: typeof o.imperial === 'number' && o.imperial !== 0, ...opt('current', current) };
  } catch {
    return { imperial: false };
  }
}

// lang: the language of the interface, for the texts the card's files give.
async function start(card: string, lang: string): Promise<{ run: LuaRun; current?: string }> {
  const r = await radioSettings(card);
  const run = luaRun({ card, imperial: r.imperial });
  run.exec(GLUE, 'flightbag');
  run.call('fb_lang', /^[a-z]{2}$/.test(lang) ? lang : 'en');
  return { run, ...opt('current', r.current) };
}

// Errors from Lua as the user's to fix where they are (Flight Bag missing, a value the page doesn't take),
// anything else as it is.
function call<T>(run: LuaRun, name: string, ...args: unknown[]): T {
  try {
    return run.call(name, ...args) as T;
  } catch (e) {
    const msg = e instanceof LuaError ? e.message.replace(/^[^:]+: /, '') : '';
    if (msg.startsWith('missing:/SCRIPTS/FLIGHTBAG/')) throw new AppError('flightBagMissing');
    if (msg === 'flightbag:old') throw new AppError('flightBagOld');
    if (msg === 'flightbag:new') throw new AppError('flightBagNew');
    if (msg.startsWith('invalid:')) throw new AppError('invalidRequest', { what: msg.slice(8) });
    if (msg.startsWith('rule:')) throw new AppError('flightBagRule', { detail: printable(msg.slice(5)) });
    if (e instanceof LuaError) throw new AppError('flightBagFailed', { detail: printable(msg).slice(0, 300) });
    throw e;
  }
}

const isEdits = (v: unknown): v is Edits =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).length <= 200 &&
  Object.entries(v).every(([k, x]) => k.length <= 100 && ['string', 'number', 'boolean'].includes(typeof x) && (typeof x !== 'string' || x.length <= 200));

export function checkEdits(v: unknown): Edits {
  if (v === undefined) return {};
  if (!isEdits(v)) throw new AppError('invalidRequest', { what: 'settings' });
  return v;
}

const t = (s: unknown) => (typeof s === 'string' ? printable(s) : undefined);
// an empty Lua table comes as an object
const arr = <T>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]) : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const opt = <K extends string, V>(k: K, v: V | undefined) => (v === undefined ? {} : ({ [k]: v } as Record<K, V>));

function cleanPack(p: PackDraft): PackDraft {
  return {
    ...opt('id', t(p.id)),
    label: num(p.label) ?? 0,
    cycles: num(p.cycles) ?? 0,
    wear: num(p.wear) ?? 0,
    ...opt('buyDate', t(p.buyDate)),
    ...opt('totalMah', num(p.totalMah)),
    ...opt('minVCell', num(p.minVCell)),
    ...opt('lastUsed', t(p.lastUsed)),
  };
}

function cleanDraft(d: BatteryDraft): BatteryDraft {
  return {
    name: t(d.name) ?? '',
    nameAuto: d.nameAuto === true,
    manufacturer: t(d.manufacturer) ?? '',
    chemistry: t(d.chemistry) ?? '',
    capacityMah: num(d.capacityMah) ?? 0,
    cells: num(d.cells) ?? 0,
    ...opt('warnPct', num(d.warnPct)),
    ...opt('critPct', num(d.critPct)),
    packs: arr<PackDraft>(d.packs).map(cleanPack),
  };
}

function cleanBatteries(b: BatteriesView): BatteriesView {
  return {
    ...b,
    broken: b.broken === true,
    chemistries: arr<string>(b.chemistries).map((c) => t(c) ?? ''),
    list: arr<BatteryView>(b.list).map((x) => ({ ...cleanDraft(x), id: t(x.id) ?? '', models: arr<string>(x.models).map((m) => t(m) ?? '') })),
  };
}

const bools = (v: unknown): Record<string, boolean> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) : undefined;
const cleanModules = (v: unknown): ModuleView[] => arr<ModuleView>(v).map((m) => ({ key: t(m.key) ?? '', label: t(m.label) ?? '', ...opt('desc', t(m.desc)) }));

function cleanModels(m: ModelsView): ModelsView {
  return {
    broken: m.broken === true,
    lipo: m.lipo === true,
    wingman: m.wingman === true,
    wingmanBroken: m.wingmanBroken === true,
    modules: cleanModules(m.modules),
    list: arr<ModelSummary>(m.list).map((x) => ({
      file: t(x.file) ?? '',
      name: t(x.name) || (t(x.file) ?? ''),
      configured: x.configured === true,
      active: x.active === true,
      onCard: x.onCard === true,
      ...opt('cells', num(x.cells)),
      ...(x.parallel !== undefined ? { parallel: x.parallel === true } : {}),
      ...(x.batteries !== undefined ? { batteries: arr<string>(x.batteries).map((b) => t(b) ?? '') } : {}),
      ...(x.customSensors !== undefined ? { customSensors: x.customSensors === true } : {}),
      ...opt('mods', bools(x.mods)),
    })),
  };
}

function cleanFlights(list: unknown): LastFlightView[] {
  return arr<LastFlightView>(list)
    .filter((f) => num(f.lat) !== undefined && num(f.lon) !== undefined)
    .map((f) => ({
      date: t(f.date) ?? '',
      time: t(f.time) ?? '',
      model: t(f.model) ?? '',
      lat: f.lat,
      lon: f.lon,
      latText: t(f.latText) ?? String(f.lat),
      lonText: t(f.lonText) ?? String(f.lon),
      url: /^https:\/\/[^\s"<>]+$/.test(f.url) ? f.url : '',
    }));
}

// Text from the card's files as it is shown: without control characters.
function cleanView(v: FlightBagView): FlightBagView {
  return {
    ...(v.batteries ? { batteries: cleanBatteries(v.batteries) } : {}),
    ...(v.models ? { models: cleanModels(v.models) } : {}),
    ...(v.flights ? { flights: cleanFlights(v.flights) } : {}),
    pages: arr<string>(v.pages).filter(isFlightBagPage),
    page: v.page,
    apps: arr<AppInfoView>(v.apps).map((a) => ({ folder: t(a.folder) ?? '', name: t(a.name) ?? '', ...(a.version ? { version: t(a.version) } : {}), ok: a.ok === true })),
    rows: arr<RowView>(v.rows).map((r) => ({
      ...r,
      ...(r.text !== undefined ? { text: t(r.text) } : {}),
      ...(r.hint !== undefined ? { hint: t(r.hint) } : {}),
      ...(r.button !== undefined ? { button: t(r.button) } : {}),
      ...(r.ask !== undefined ? { ask: t(r.ask) } : {}),
      ...(r.fix !== undefined ? { fix: r.fix === 'noConfig' ? ('noConfig' as const) : ('damaged' as const) } : {}),
      ...(r.apps !== undefined ? { apps: arr<string>(r.apps) } : {}),
      ...(r.field
        ? {
            field: {
              ...r.field,
              label: t(r.field.label) ?? r.field.key,
              ...(r.field.hint !== undefined ? { hint: t(r.field.hint) } : {}),
              ...(r.field.unit !== undefined ? { unit: t(r.field.unit) } : {}),
              ...(r.field.prefix !== undefined ? { prefix: t(r.field.prefix) } : {}),
              ...(r.field.labels !== undefined ? { labels: arr<string>(r.field.labels).map((l) => t(l) ?? '') } : {}),
              ...(r.field.choices !== undefined ? { choices: arr<string | number | boolean>(r.field.choices) } : {}),
            },
          }
        : {}),
      ...(r.sound
        ? {
            sound: {
              ...r.sound,
              label: t(r.sound.label) ?? r.sound.key,
              ...(r.sound.hint !== undefined ? { hint: t(r.sound.hint) } : {}),
              options: arr<SoundOptionView>(r.sound.options).map((o) => ({ id: t(o.id) ?? '', label: t(o.label) ?? '' })),
            },
          }
        : {}),
    })),
  };
}

// A page with the edits so far applied, as the page logic sees them (greyed rows, mixed values).
export async function flightBagView(card: string, page: FlightBagPage, edits: Edits = {}, lang = 'en'): Promise<FlightBagView> {
  const { run, current } = await start(card, lang);
  return cleanView(call<FlightBagView>(run, 'fb_view', page, edits, current ?? null));
}

export interface SaveResult {
  problems: string[]; // "<app>: <what>" in the interface's language; nothing was written when there are any
  written: string[]; // card paths
}

// Puts what the scripts wrote onto the card: each file written beside its old one and renamed over it, so
// pulling the cable mid-way leaves the old file or the new one, never half of one.
// macOS's "._" files next to them are removed right after.
async function commit(card: string, writes: Map<string, Uint8Array>): Promise<string[]> {
  const files = [...writes.keys()].sort();
  for (const path of files) {
    const p = path.split('/').filter((s) => s !== '');
    if (!p.every(isSafeName)) throw new AppError('invalidRequest', { what: 'path' });
    const to = join(card, ...p);
    const tmp = `${to}.new`;
    await mkdir(dirname(to), { recursive: true });
    await writeFile(tmp, writes.get(path)!);
    await rename(tmp, to);
    await dropAppleDouble(tmp);
    await dropAppleDouble(to);
    await dropAppleDouble(dirname(to));
  }
  return files;
}

// Saves a page with the user's edits through the page logic. Nothing is written while a value breaks a rule.
export async function saveFlightBag(card: string, page: FlightBagPage, edits: Edits, lang = 'en'): Promise<SaveResult> {
  const { run } = await start(card, lang);
  const problems = (call<unknown>(run, 'fb_save', page, edits) as unknown[] | undefined) ?? [];
  const list = Array.isArray(problems) ? problems.map((p) => printable(String(p))) : [];
  if (list.length > 0) return { problems: list, written: [] };
  return { problems: [], written: await commit(card, run.writes) };
}

// Creates a missing settings file or replaces a damaged one with factory settings.
export async function fixFlightBag(card: string, page: FlightBagPage, app: string, lang = 'en'): Promise<string[]> {
  if (!isSafeName(app)) throw new AppError('invalidRequest', { what: 'app' });
  const { run } = await start(card, lang);
  call(run, 'fb_fix', page, app);
  return commit(card, run.writes);
}

const PROBLEMS = ['update', 'noConfig', 'damaged'] as const;
const RESET_ID = /^[a-z][\w-]{0,31}$/i;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The apps on the card with what Flight Bag's popup shows for each.
export async function flightBagApps(card: string, lang = 'en'): Promise<AppDetailView[]> {
  const { run, current } = await start(card, lang);
  const names = current ? await sensorNames(card, current) : [];
  return arr<AppDetailView>(call<unknown>(run, 'fb_apps', current ?? null, names)).map((a) => {
    const url = t(a.url);
    return {
      folder: t(a.folder) ?? '',
      name: t(a.name) ?? '',
      ...opt('version', t(a.version)),
      ok: a.ok === true,
      sign: a.sign === true,
      icon: a.icon === true && isSafeName(a.folder),
      ...opt('url', url && /^github\.com\/[\w.-]+\/[\w.-]+$/.test(url) ? url : undefined),
      about: arr<string>(a.about).map((s) => t(s) ?? ''),
      ...opt('problem', PROBLEMS.find((p) => p === a.problem)),
      setupErrors: arr<string>(a.setupErrors).map((s) => t(s) ?? ''),
      files: arr<{ label: string; path: string }>(a.files).map((f) => ({ label: t(f.label) ?? '', path: t(f.path) ?? '' })),
      fix: a.fix === true,
      ...opt('fixLabel', t(a.fixLabel)),
      ...opt('fixAsk', t(a.fixAsk)),
      resets: arr<{ id: string; label: string; ask?: string; desc?: string }>(a.resets)
        .filter((r) => typeof r.id === 'string' && RESET_ID.test(r.id))
        .map((r) => ({ id: r.id, label: t(r.label) ?? '', ...opt('ask', t(r.ask)), ...opt('desc', t(r.desc)) })),
    };
  });
}

// Runs the reset of an app's manifest with this id, or without one the action for a missing or damaged
// settings file, and puts what it wrote on the card.
export async function flightBagAction(card: string, app: unknown, reset: unknown, lang = 'en'): Promise<string[]> {
  if (typeof app !== 'string' || !isSafeName(app)) throw new AppError('invalidRequest', { what: 'app' });
  if (reset !== undefined && (typeof reset !== 'string' || !RESET_ID.test(reset))) throw new AppError('invalidRequest', { what: 'reset' });
  const { run, current } = await start(card, lang);
  call(run, 'fb_action', app, reset ?? null, current ?? null);
  return commit(card, run.writes);
}

// An app's icon from the card: only /SCRIPTS/<app>/icon.png, small, and a PNG.
export async function readAppIcon(card: string, app: string): Promise<Buffer> {
  if (!isSafeName(app)) throw new AppError('invalidRequest', { what: 'app' });
  const data = await readFile(join(card, 'SCRIPTS', app, 'icon.png')).catch(() => undefined);
  if (!data || data.length > 256 * 1024 || !data.subarray(0, 8).equals(PNG)) throw new AppError('notFound');
  return data;
}

// The dialog's battery as the page logic sees it; id is missing for a new battery.
export async function batteryEdit(card: string, id: string | undefined, draft: unknown, lang = 'en'): Promise<BatteryEditView> {
  const { run } = await start(card, lang);
  const v = call<BatteryEditView>(run, 'fb_battery', id ?? null, draft ?? null, 'view');
  return {
    draft: cleanDraft(v.draft),
    isNew: v.isNew === true,
    dirty: v.dirty === true,
    deleteQuestion: t(v.deleteQuestion) ?? '',
    full: v.full === true,
    ...opt('invalid', t(v.invalid)),
    ...opt('archiveLocked', t(v.archiveLocked)),
    ...opt('deleteBlocked', t(v.deleteBlocked)),
  };
}

// Saves or deletes a battery through the page logic; problem (in the interface's language) when its rules don't allow it.
export async function changeBattery(card: string, id: string | undefined, draft: unknown, action: 'save' | 'delete', lang = 'en'): Promise<{ problem?: string }> {
  const { run } = await start(card, lang);
  const r = call<{ problem?: string }>(run, 'fb_battery', id ?? null, draft ?? null, action);
  if (r?.problem) return { problem: printable(String(r.problem)) };
  await commit(card, run.writes);
  return {};
}

// The telemetry sensors of a model file on the card, by name.
async function sensorNames(card: string, file: string): Promise<string[]> {
  try {
    return parseModelYml(file, await readFile(join(card, 'MODELS', file), 'utf8')).sensors.map((s) => s.label);
  } catch {
    return [];
  }
}

function checkModelFile(file: unknown): string {
  if (typeof file !== 'string' || !isModelFile(file)) throw new AppError('invalidRequest', { what: 'model' });
  return file;
}

function cleanModelDraft(d: ModelDraft): ModelDraft {
  const sensors = typeof d.sensors === 'object' && d.sensors !== null && !Array.isArray(d.sensors) ? d.sensors : {};
  return {
    ...opt('cells', num(d.cells)),
    ...(d.parallel !== undefined ? { parallel: d.parallel === true } : {}),
    ...(d.batteryIds !== undefined ? { batteryIds: arr<string>(d.batteryIds).map((id) => t(id) ?? '') } : {}),
    sensors: Object.fromEntries(Object.entries(sensors).flatMap(([k, v]) => (typeof v === 'string' ? [[k, printable(v)]] : []))),
    ...opt('mods', bools(d.mods)),
  };
}

// The dialog's model as the page logic sees it.
export async function modelEdit(card: string, file: unknown, draft: unknown, lang = 'en'): Promise<ModelEditView> {
  const f = checkModelFile(file);
  const { run } = await start(card, lang);
  const v = call<ModelEditView>(run, 'fb_model', f, draft ?? null, 'view', await sensorNames(card, f));
  return {
    file: f,
    name: t(v.name) || f,
    draft: cleanModelDraft(v.draft),
    isNew: v.isNew === true,
    dirty: v.dirty === true,
    ...(v.cellLimit ? { cellLimit: { min: num(v.cellLimit.min) ?? 1, max: num(v.cellLimit.max) ?? 30 } } : {}),
    ...(v.assign !== undefined
      ? {
          assign: arr<AssignView>(v.assign).map((a) => ({
            id: t(a.id) ?? '',
            name: t(a.name) ?? '',
            checked: a.checked === true,
            selectable: a.selectable === true,
            packs: num(a.packs) ?? 0,
          })),
        }
      : {}),
    ...opt('otherCells', num(v.otherCells)),
    ...opt('smallProfiles', num(v.smallProfiles)),
    ...(v.parallelInvalid !== undefined ? { parallelInvalid: v.parallelInvalid === true } : {}),
    ...opt('parallelProblem', t(v.parallelProblem)),
    ...(v.sensors !== undefined
      ? {
          sensors: arr<SensorFieldView>(v.sensors).map((s) => ({
            key: t(s.key) ?? '',
            label: t(s.label) ?? '',
            ...opt('desc', t(s.desc)),
            unit: s.unit === true,
            ...opt('default', t(s.default)),
            options: arr<string>(s.options).map((o) => t(o) ?? ''),
          })),
        }
      : {}),
    ...(v.customSensors !== undefined ? { customSensors: v.customSensors === true } : {}),
    ...(v.modules !== undefined ? { modules: cleanModules(v.modules) } : {}),
  };
}

// Saves or deletes a model's setup through the page logic; problem (in the interface's language) when its rules don't allow it.
export async function changeModel(card: string, file: unknown, draft: unknown, action: 'save' | 'delete', lang = 'en'): Promise<{ problem?: string }> {
  const f = checkModelFile(file);
  const { run } = await start(card, lang);
  const r = call<{ problem?: string }>(run, 'fb_model', f, draft ?? null, action, await sensorNames(card, f));
  if (r?.problem) return { problem: printable(String(r.problem)) };
  await commit(card, run.writes);
  return {};
}

// A battery or model from the page: plain values, a few KB at most.
export function checkDraft<T = BatteryDraft>(v: unknown): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v) || JSON.stringify(v).length > 20_000) throw new AppError('invalidRequest', { what: 'draft' });
  return v as T;
}

// A sound of an app to listen to: only .wav files below /SOUNDS/.
export async function readSound(card: string, path: string): Promise<Buffer> {
  const p = path.split('/').filter((s) => s !== '');
  if (!path.startsWith('/SOUNDS/') || !p.every(isSafeName) || !/\.wav$/i.test(path)) throw new AppError('invalidRequest', { what: 'sound' });
  return readFile(join(card, ...p)).catch(() => {
    throw new AppError('notFound');
  });
}
