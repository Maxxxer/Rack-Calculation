/**
 * Подбор виброгасителей.
 *
 * Виброгасители считаются ИНДИВИДУАЛЬНО на каждый компрессор, раздельно для
 * линии всасывания и линии нагнетания: в агрегате из трёх компрессоров должно
 * получиться три виброгасителя нагнетания и три виброгасителя всасывания.
 *
 * Требуемый размер присоединения определяется в таком порядке:
 *   1) по диаметру патрубка компрессора (suction_d_in / discharge_d_in), если
 *      он задан в базе данных;
 *   2) иначе — по скорости хладагента: по индивидуальной производительности
 *      компрессора вычисляется массовый расход, затем подбирается диаметр, при
 *      котором скорость попадает в рекомендованный диапазон (services/piping.js).
 * Из каталога берётся ближайший виброгаситель с присоединительным размером не
 * меньше требуемого.
 */
'use strict';

const { db } = require('../db/database');
const piping = require('./piping');
const refr = require('./refrigerants');
const { formatInch } = require('./inch');

const CATEGORY = 'vibration';

// Линии установки виброгасителей (русское название — в родительном падеже)
const LINE_NAMES = { suction: 'всасывания', discharge: 'нагнетания' };

// Основания подбора размера
const BASIS = { port: 'port', speed: 'speed', unknown: 'unknown' };

const MIN_LATENT_HEAT_KJKG = 20; // ниже этой величины оценка расхода недостоверна
const SIZE_EPS = 1e-9;

/** Каталог виброгасителей по возрастанию присоединительного размера */
function listComponents() {
  return db.prepare(
    'SELECT * FROM components WHERE category = ? AND active = 1 ORDER BY size_in'
  ).all(CATEGORY);
}

function toSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Ближайший виброгаситель с размером не меньше требуемого */
function pickComponent(catalog, sizeIn) {
  if (!catalog.length) return null;
  const fit = catalog.find(c => c.size_in != null && c.size_in >= sizeIn - SIZE_EPS);
  return fit || catalog[catalog.length - 1];
}

/** Присоединительный размер патрубка компрессора, дюймы (0 — нет данных) */
function portSizeIn(compressor, kind) {
  return toSize(kind === 'suction' ? compressor.suction_d_in : compressor.discharge_d_in);
}

/**
 * Массовый расход одного компрессора, кг/ч.
 * Если полином массового расхода отсутствует — оценка по холодопроизводительности.
 */
function compressorMassFlowKgh(compressor, { refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0 }) {
  const given = Number(compressor.mass_flow_kgh);
  if (Number.isFinite(given) && given > 0) return given;

  const qKw = Number(compressor.q_kw);
  const q0 = refr.hVaporSuperheated(refrigerant, tEvap, tEvap + dTsh) -
             refr.hLiquid(refrigerant, tCond - dTsc);
  if (!(qKw > 0) || !(q0 > MIN_LATENT_HEAT_KJKG)) return 0;
  return qKw * 3600 / q0;
}

/**
 * Требуемый размер присоединения виброгасителя и основание его выбора.
 * @returns {{ baseSizeIn: number, basis: string }}
 */
function resolveBaseSize({ kind, compressor, massFlowKgh, params }) {
  const port = portSizeIn(compressor, kind);
  if (port > 0) return { baseSizeIn: port, basis: BASIS.port };

  // Нет данных о патрубке — считаем по скорости: рекомендуемый диаметр линии
  // для индивидуального расхода компрессора.
  const recommended = piping.calcLine({ kind, ...params, massFlowKgh, minSizeIn: 0 }).recommended;
  if (massFlowKgh > 0) return { baseSizeIn: recommended.size_in, basis: BASIS.speed };
  return { baseSizeIn: 0, basis: BASIS.unknown };
}

/** Группировка подобранных виброгасителей по артикулу (одинаковые размеры — одна позиция) */
function aggregate(lines, lineName) {
  const byArticle = new Map();
  for (const item of lines) {
    let entry = byArticle.get(item.article);
    if (!entry) {
      entry = {
        article: item.article,
        size_in: item.sizeIn,
        price_eur: item.price_eur,
        qty: 0,
        name: `Виброгаситель ${lineName} ${item.article} (${formatInch(item.sizeIn)})`
      };
      byArticle.set(item.article, entry);
    }
    entry.qty += item.qty;
  }
  return [...byArticle.values()];
}

/**
 * Подбор виброгасителей одной линии — по одному на каждый компрессор.
 * @param {Object} p { kind, compressors, refrigerant, tEvap, tCond, dTsh, dTsc }
 * @returns {{ kind, label, lines, bomItems, warnings }}
 */
function planLine({ kind, compressors = [], refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0 }) {
  const lineName = LINE_NAMES[kind];
  if (!lineName) throw new Error(`Неизвестная линия виброгасителя: ${kind}`);

  const catalog = listComponents();
  const params = { refrigerant, tEvap, tCond, dTsh, dTsc };
  const vMax = piping.V_RANGE[kind].max;
  const lines = [];
  const warnings = [];

  for (const compressor of compressors) {
    const qty = Math.max(1, compressor.qty | 0);
    const massFlowKgh = compressorMassFlowKgh(compressor, params);
    const { baseSizeIn, basis } = resolveBaseSize({ kind, compressor, massFlowKgh, params });
    const component = pickComponent(catalog, baseSizeIn);
    if (!component) continue;

    const label = `${compressor.manufacturer} ${compressor.model}`;
    if (basis === BASIS.unknown) {
      warnings.push(`Виброгаситель ${lineName} для ${label}: нет данных о патрубке и расходе — принят минимальный размер ${component.code}.`);
    }
    const velocity = piping.velocityAt(component.size_in, kind, massFlowKgh, params);
    if (velocity != null && velocity > vMax) {
      warnings.push(`Виброгаситель ${lineName} для ${label}: скорость ${velocity} м/с выше допустимой ${vMax} м/с (${component.code}).`);
    }

    lines.push({
      kind,
      manufacturer: compressor.manufacturer,
      model: compressor.model,
      qty,
      portSizeIn: portSizeIn(compressor, kind) || null,
      massFlowKgh: +massFlowKgh.toFixed(1),
      baseSizeIn,
      basis,
      sizeIn: component.size_in,
      article: component.code,
      name: component.name,
      price_eur: component.price_eur,
      velocity,
      vRecommended: piping.V_RECOMMEND[kind],
      vMax
    });
  }

  return { kind, label: lineName, lines, bomItems: aggregate(lines, lineName), warnings };
}

/**
 * Подбор виброгасителей агрегата: индивидуально на каждый компрессор,
 * отдельно для всасывания и нагнетания.
 * @param {Object} p { compressors, refrigerant, tEvap, tCond, dTsh, dTsc }
 */
function planAll(params) {
  const suction = planLine({ ...params, kind: 'suction' });
  const discharge = planLine({ ...params, kind: 'discharge' });
  const sumQty = (plan) => plan.bomItems.reduce((s, i) => s + i.qty, 0);
  return {
    suction,
    discharge,
    totalSuctionQty: sumQty(suction),
    totalDischargeQty: sumQty(discharge),
    warnings: [...suction.warnings, ...discharge.warnings]
  };
}

module.exports = {
  planLine, planAll, listComponents, pickComponent,
  compressorMassFlowKgh, portSizeIn, LINE_NAMES, BASIS
};
