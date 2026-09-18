/**
 * Подбор компрессоров: вычисление характеристик по полиномам AHRI/EN12900.
 *
 * Формат полинома (листы Refcomp_polynom / Xecom_polynom):
 *   Y = C1 + C2*S + C3*D + C4*S² + C5*S*D + C6*D² + C7*S³ + C8*D*S² + C9*S*D² + C10*D³
 *   S — температура кипения (°C), D — температура конденсации (°C)
 *   Результат делится на multiplier (1000 для Вт → кВт, 1 если уже кВт).
 */
'use strict';

const { db } = require('../db/database');

/** Вычисление полинома AHRI */
function evalPoly(coeffs, S, D) {
  const [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10] = coeffs;
  return c1 + c2 * S + c3 * D + c4 * S * S + c5 * S * D + c6 * D * D +
         c7 * S * S * S + c8 * D * S * S + c9 * S * D * D + c10 * D * D * D;
}

function parsePoly(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length === 10 ? arr : null;
  } catch (_) { return null; }
}

/**
 * Характеристики компрессора в точке (S, D).
 * Возвращает { q_kw, power_kw, current_a, volume_m3h, mass_flow_kgh } или null вне диапазона.
 */
function compressorPerformance(comp, tEvap, tCond) {
  if (tEvap < comp.min_tevap || tEvap > comp.max_tevap) return null;
  if (tCond < comp.min_tcond || tCond > comp.max_tcond) return null;

  const mult = comp.poly_multiplier || 1;
  const pCap = parsePoly(comp.poly_capacity);
  if (!pCap) return null;

  const qRaw = evalPoly(pCap, tEvap, tCond);
  const q_kw = qRaw / mult;
  if (!(q_kw > 0)) return null;

  const out = { q_kw: +q_kw.toFixed(3) };

  const pPow = parsePoly(comp.poly_power);
  if (pPow) out.power_kw = +(evalPoly(pPow, tEvap, tCond) / mult).toFixed(3);

  const pCur = parsePoly(comp.poly_current);
  if (pCur) out.current_a = +evalPoly(pCur, tEvap, tCond).toFixed(2);

  const pVol = parsePoly(comp.poly_volume);
  if (pVol) out.volume_m3h = +evalPoly(pVol, tEvap, tCond).toFixed(2);

  const pMas = parsePoly(comp.poly_mass);
  if (pMas) out.mass_flow_kgh = +evalPoly(pMas, tEvap, tCond).toFixed(2);

  // Если массовый расход не задан полиномом — оценка через q и энтальпии
  if (!out.mass_flow_kgh) {
    const refr = require('./refrigerants');
    const q0 = refr.hVaporSuperheated(comp.refrigerant_code, tEvap, tEvap + 10) -
               refr.hLiquid(comp.refrigerant_code, tCond);
    if (q0 > 20) out.mass_flow_kgh = +(q_kw * 3600 / q0).toFixed(2);
  }
  return out;
}

/** Список компрессоров под хладагент (с фильтрами) */
function findCompressors({ refrigerant, type, manufacturerId, tEvap }) {
  let sql = `
    SELECT c.*, m.name AS manufacturer
    FROM compressors c JOIN manufacturers m ON m.id = c.manufacturer_id
    WHERE c.active = 1 AND LOWER(c.refrigerant_code) = LOWER(?)`;
  const args = [refrigerant];
  if (type && type !== 'any') { sql += ' AND c.type = ?'; args.push(type); }
  if (manufacturerId && manufacturerId !== 'any') { sql += ' AND c.manufacturer_id = ?'; args.push(manufacturerId); }
  if (tEvap != null) { sql += ' AND c.min_tevap <= ?'; args.push(tEvap); }
  return db.prepare(sql).all(...args);
}

/** Допуск попадания в требуемую мощность по умолчанию, % */
const DEFAULT_TOLERANCE_PCT = 10;

/** Минимальная суммарная мощность, % от требуемой (ниже — вариант не рассматривается) */
const MIN_CAPACITY_PCT = 98;

/** Максимальный избыток мощности, % (выше — вариант не рассматривается) */
const MAX_OVERSIZE_PCT = 60;

/** Допуск приводим к числу в диапазоне 0…100 %; пустое значение — допуск по умолчанию */
function normalizeTolerancePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TOLERANCE_PCT;
  return Math.min(Math.max(n, 0), 100);
}

/**
 * Автоподбор: перебор моделей и количества 1..maxQty.
 *
 * Варианты, попавшие в допуск по мощности (требуемая ±tolerancePct %), идут
 * первыми — из них выбирается ближайший к требуемой мощности, затем самый
 * дешёвый. Если в допуск не попал никто, дальше идут остальные варианты,
 * тоже по близости к требуемой мощности: подбор всегда что-то предложит.
 */
function autoSelect({ refrigerant, tEvap, tCond, requiredKw, type, manufacturerId,
                      maxQty = 3, topN = 5, tolerancePct = DEFAULT_TOLERANCE_PCT }) {
  const tol = normalizeTolerancePct(tolerancePct) / 100;
  const minKw = requiredKw * (1 - tol);
  const maxKw = requiredKw * (1 + tol);

  const candidates = findCompressors({ refrigerant, type, manufacturerId, tEvap });
  const inTolerance = [];
  const outside = [];
  for (const c of candidates) {
    const perf = compressorPerformance(c, tEvap, tCond);
    if (!perf || !perf.q_kw || perf.q_kw <= 0) continue;
    for (let qty = 1; qty <= maxQty; qty++) {
      const total = perf.q_kw * qty;
      if (total < requiredKw * (MIN_CAPACITY_PCT / 100)) continue;
      const oversize = (total / requiredKw - 1) * 100;
      if (oversize > MAX_OVERSIZE_PCT) continue;
      const withinTolerance = total >= minKw && total <= maxKw;
      const variant = {
        compressor: c, perf, qty,
        totalKw: total, oversizePct: oversize, withinTolerance,
        priceEur: c.price_eur * qty,
        powerKw: (perf.power_kw || 0) * qty
      };
      (withinTolerance ? inTolerance : outside).push(variant);
    }
  }

  // Близость к требуемой мощности важнее цены: сначала отклонение, потом цена
  const byDeviation = (a, b) =>
    (Math.abs(a.oversizePct) - Math.abs(b.oversizePct)) || (a.priceEur - b.priceEur);
  inTolerance.sort(byDeviation);
  outside.sort(byDeviation);

  return [...inTolerance, ...outside].slice(0, topN);
}

/**
 * Пересчет характеристик системы для выбранного набора компрессоров.
 * items: [{ compressorId, qty }]
 */
function evaluateSelection({ refrigerant, tEvap, tCond, items }) {
  const detail = [];
  let totalQ = 0, totalPower = 0, totalMass = 0, totalCurrent = 0, totalPrice = 0, totalVolume = 0;
  for (const it of items) {
    const c = db.prepare(`
      SELECT c.*, m.name AS manufacturer FROM compressors c
      JOIN manufacturers m ON m.id = c.manufacturer_id WHERE c.id = ?`).get(it.compressorId);
    if (!c) throw new Error('Компрессор не найден');
    const perf = compressorPerformance(c, tEvap, tCond);
    if (!perf) throw new Error(`Модель ${c.model}: режим вне диапазона полинома`);
    const qty = Math.max(1, it.qty | 0);
    totalQ += (perf.q_kw || 0) * qty;
    totalPower += (perf.power_kw || 0) * qty;
    totalMass += (perf.mass_flow_kgh || 0) * qty;
    totalCurrent += (perf.current_a || 0) * qty;
    totalVolume += (perf.volume_m3h || 0) * qty;
    totalPrice += c.price_eur * qty;
    detail.push({
      compressorId: c.id, manufacturer: c.manufacturer, model: c.model,
      type: c.type, refrigerant: c.refrigerant_code, qty,
      q_kw: perf.q_kw, power_kw: perf.power_kw, current_a: perf.current_a,
      mass_flow_kgh: perf.mass_flow_kgh, volume_m3h: perf.volume_m3h,
      suction_d_in: c.suction_d_in, discharge_d_in: c.discharge_d_in,
      max_current_a: c.max_current_a,
      price_eur: c.price_eur, total_price_eur: c.price_eur * qty,
      displacement_m3h: c.displacement_m3h
    });
  }
  return {
    items: detail,
    totals: {
      q_kw: +totalQ.toFixed(2),
      power_kw: +totalPower.toFixed(2),
      cop: totalPower > 0 ? +(totalQ / totalPower).toFixed(3) : null,
      heat_kw: +(totalQ + totalPower).toFixed(2),
      mass_flow_kgh: +totalMass.toFixed(2),
      current_a: +totalCurrent.toFixed(2),
      volume_m3h: +totalVolume.toFixed(2),
      compressors_price_eur: +totalPrice.toFixed(2)
    }
  };
}

module.exports = {
  evalPoly, compressorPerformance, findCompressors, autoSelect, evaluateSelection,
  normalizeTolerancePct, DEFAULT_TOLERANCE_PCT
};
