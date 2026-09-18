/**
 * База данных приложения (SQLite через встроенный модуль node:sqlite).
 *
 * Схема по данным «База данных.xlsx» и «Калькулятор Ultima_Prime_DB.xlsx»:
 *  - компрессоры: полиномы AHRI/EN12900 (5 наборов × 10 коэффициентов)
 *  - каталог компонентов: корпуса, клапаны KVR/NRD/ICS, обратные клапаны,
 *    шаровые краны, виброгасители, фильтры, глазки, ресиверы, отделители,
 *    маслоотделители, масляные ресиверы
 *  - диаметры трубопроводов (дюймы, наружный Ø, толщина стенки)
 *  - опции с правилами автовключения
 *  - коммерческие предложения
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { OPTIONS } = require('./optionDefinitions');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'rack-calc.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
  -- ================= ПОЛЬЗОВАТЕЛИ =================
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'client',          -- admin | client
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | active | rejected
    discount_percent REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ================= ХЛАДАГЕНТЫ =================
  CREATE TABLE IF NOT EXISTS refrigerants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,                    -- R404a, R507a, R410a, R32, R449b
    name TEXT NOT NULL,
    safety_class TEXT DEFAULT '',
    glide_k REAL DEFAULT 0,
    gwp REAL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  -- ================= ПРОИЗВОДИТЕЛИ =================
  CREATE TABLE IF NOT EXISTS manufacturers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,                    -- Xecom, Invotech, Bitzer_EU, Bitzer_CH,
                                                  -- Copeland, Refcomp, Ridan_Scroll, Ridan_Piston
    country TEXT DEFAULT '',
    website TEXT DEFAULT ''
  );

  -- ================= КОМПРЕССОРЫ (полиномы AHRI/EN12900) =================
  -- Y = C1 + C2*S + C3*D + C4*S^2 + C5*S*D + C6*D^2 + C7*S^3 + C8*D*S^2 + C9*S*D^2 + C10*D^3
  -- S — температура кипения (°C), D — температура конденсации (°C)
  CREATE TABLE IF NOT EXISTS compressors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id),
    model TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'scroll',          -- scroll | recip | screw
    refrigerant_code TEXT NOT NULL REFERENCES refrigerants(code),
    frequency_hz INTEGER DEFAULT 50,
    voltage_v INTEGER DEFAULT 400,
    displacement_m3h REAL,                        -- объемная производительность, м3/ч
    suction_d_in REAL,                            -- диаметр всасывания, дюймы
    discharge_d_in REAL,                          -- диаметр нагнетания, дюймы
    max_current_a REAL,                           -- максимальный рабочий ток, А
    return_gas_temp_c REAL,                       -- температура возврата газа, °C
    min_tcond REAL DEFAULT 10,
    max_tcond REAL DEFAULT 65,
    min_tevap REAL DEFAULT -45,
    max_tevap REAL DEFAULT 15,
    price_eur REAL NOT NULL DEFAULT 0,
    poly_power TEXT,                              -- JSON [C1..C10], Вт
    poly_current TEXT,                            -- JSON [C1..C10], А
    poly_volume TEXT,                             -- JSON [C1..C10], м3/ч
    poly_mass TEXT,                               -- JSON [C1..C10], кг/ч
    poly_capacity TEXT,                           -- JSON [C1..C10], Вт (или кВт при multiplier=1)
    poly_multiplier REAL DEFAULT 1,               -- делитель для перевода в кВт (1000 для Вт)
    inverter_capable INTEGER NOT NULL DEFAULT 0,  -- модель рассчитана на работу с инвертором
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(manufacturer_id, model, refrigerant_code)
  );

  -- ================= КАТАЛОГ КОМПОНЕНТОВ =================
  -- category: housing | kvr_valve | check_valve | ball_valve | vibration |
  --           filter_drier | drier_insert | suction_filter | sight_glass |
  --           liquid_receiver | liquid_separator | oil_separator | oil_receiver |
  --           fixed | other
  CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,                    -- артикул: FP-BV-218, NRV 19s, SGP16s...
    name TEXT NOT NULL,
    size_in REAL,                                 -- присоединительный размер, дюймы
    capacity_kw REAL,                             -- референсная производительность, кВт
    capacity_kw2 REAL,                            -- вторая референсная (напр. при tкип -30), кВт
    volume_l REAL,                                -- объем, л (ресиверы)
    price_eur REAL NOT NULL DEFAULT 0,
    meta TEXT,                                    -- JSON доп. данные
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_comp_cat ON components(category, size_in);

  -- ================= ДИАМЕТРЫ ТРУБОПРОВОДОВ =================
  CREATE TABLE IF NOT EXISTS pipe_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    size_in REAL NOT NULL UNIQUE,                 -- размер в дюймах (0.375, 2.125, 4...)
    od_mm REAL NOT NULL,                          -- наружный диаметр, мм
    wall_mm REAL NOT NULL,                        -- толщина стенки, мм
    area_m2 REAL                                  -- площадь внутреннего сечения, м2
  );

  -- ================= ОПЦИИ =================
  -- Опция = позиция спецификации. component_category — из какого каталога
  -- подбирать артикул; sizing: 'pipe' (по диаметру линии) | 'capacity' (по мощности) | 'none'
  -- auto_rule — JSON правило автовключения (см. services/options.js)
  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    section TEXT NOT NULL,                        -- раздел спецификации: discharge | liquid | suction | other
    component_category TEXT,                      -- категория каталога компонентов
    sizing TEXT DEFAULT 'none',                   -- pipe | capacity | none
    pipe_line TEXT,                               -- suction | discharge | liquid (для sizing=pipe)
    description TEXT DEFAULT '',
    price_eur REAL DEFAULT 0,                     -- цена по умолчанию (если нет в каталоге)
    auto_rule TEXT DEFAULT '',                    -- JSON правило
    mandatory INTEGER NOT NULL DEFAULT 0,
    allowed_types TEXT DEFAULT '',                -- типы КМ, для которых опция существует ('' — любые)
    inverter_only INTEGER NOT NULL DEFAULT 0,     -- для спиральных требуется инверторная модель
    sort_order INTEGER DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  -- ================= КОММЕРЧЕСКИЕ ПРЕДЛОЖЕНИЯ =================
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,                  -- KP-2026-0001
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft',         -- draft | sent | approved | rejected
    input_json TEXT NOT NULL,                     -- исходные данные
    result_json TEXT NOT NULL,                    -- полный результат (BOM, трубы, цены)
    total_eur REAL NOT NULL DEFAULT 0,
    discount_percent REAL NOT NULL DEFAULT 0,
    total_after_discount_eur REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- ============ ПОСЛЕДНИЕ ВВЕДЁННЫЕ ЗНАЧЕНИЯ КАЛЬКУЛЯТОРА ============
  -- Одна запись на пользователя: окна 01 «Режим работы», 02 «Компрессоры» и
  -- 03 «Опции» восстанавливаются при следующем открытии калькулятора.
  CREATE TABLE IF NOT EXISTS calc_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    input_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);
}

/**
 * Синхронизация справочника опций с определениями в коде (`db/optionDefinitions.js`).
 * Нужна, чтобы правки правил подбора (например, раздельные виброгасители на
 * всасывание и нагнетание, индивидуально по каждому компрессору) применялись
 * к уже существующей базе данных без её пересоздания.
 */
function syncOptions() {
  if (!OPTIONS.length) return;
  const upsert = db.prepare(`
    INSERT INTO options
    (code, name, section, component_category, sizing, pipe_line, description, price_eur,
     auto_rule, mandatory, allowed_types, inverter_only, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, section=excluded.section,
      component_category=excluded.component_category, sizing=excluded.sizing,
      pipe_line=excluded.pipe_line, description=excluded.description,
      price_eur=excluded.price_eur, auto_rule=excluded.auto_rule,
      mandatory=excluded.mandatory, allowed_types=excluded.allowed_types,
      inverter_only=excluded.inverter_only, sort_order=excluded.sort_order, active=1`);
  for (const o of OPTIONS) {
    upsert.run(o.code, o.name, o.section, o.component_category || null, o.sizing || 'none',
      o.pipe_line || null, o.description || '', o.price_eur || 0, o.auto_rule || '',
      o.mandatory || 0, o.allowed_types || '', o.inverter_only || 0, o.sort_order || 0);
  }
  // Удаляем опции, которых больше нет в определениях (например, старая 'vibration')
  const codes = OPTIONS.map(o => o.code);
  db.prepare(`DELETE FROM options WHERE code NOT IN (${codes.map(() => '?').join(',')})`).run(...codes);
}

/**
 * Диаметр нагнетания всегда меньше диаметра всасывания: давление нагнетания
 * в 4–5 раз выше давления всасывания, поэтому линия нагнетания тоньше.
 * Если в исходных данных пара перепутана — возвращаем её в правильном порядке.
 */
function normalizePorts(suctionIn, dischargeIn) {
  if (suctionIn == null || dischargeIn == null) return [suctionIn, dischargeIn];
  return dischargeIn > suctionIn ? [dischargeIn, suctionIn] : [suctionIn, dischargeIn];
}

/**
 * Разовая починка справочника компрессоров при старте приложения:
 * в демонстрационных данных у серий Refcomp SP* и Xecom диаметры были
 * записаны в обратном порядке. Возвращает число исправленных моделей.
 */
function fixCompressorPorts() {
  const rows = db.prepare(`
    SELECT id, suction_d_in, discharge_d_in FROM compressors
    WHERE suction_d_in IS NOT NULL AND discharge_d_in IS NOT NULL
      AND discharge_d_in > suction_d_in`).all();
  if (!rows.length) return 0;
  const upd = db.prepare('UPDATE compressors SET suction_d_in = ?, discharge_d_in = ? WHERE id = ?');
  for (const r of rows) upd.run(r.discharge_d_in, r.suction_d_in, r.id);
  return rows.length;
}

/** Добавление колонки в существующую таблицу (в SQLite нет IF NOT EXISTS для ALTER) */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(c => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  return true;
}

/**
 * Миграция уже созданной базы: колонки, появившиеся в схеме позже.
 * `CREATE TABLE IF NOT EXISTS` их не добавляет, поэтому досоздаём явно —
 * иначе старт приложения на существующей базе упадёт на первом же запросе.
 */
function migrateSchema() {
  ensureColumn('compressors', 'inverter_capable', 'inverter_capable INTEGER NOT NULL DEFAULT 0');
  ensureColumn('options', 'allowed_types', "allowed_types TEXT DEFAULT ''");
  ensureColumn('options', 'inverter_only', 'inverter_only INTEGER NOT NULL DEFAULT 0');
}

initSchema();
migrateSchema();
syncOptions();

const fixedPorts = fixCompressorPorts();
if (fixedPorts) {
  console.log(`Патрубки компрессоров: порядок всасывание/нагнетание исправлен у ${fixedPorts} моделей.`);
}

module.exports = { db, DB_PATH, syncOptions, normalizePorts };
