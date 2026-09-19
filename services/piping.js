/**
 * Расчет трубопроводов: всасывание, нагнетание, жидкость.
 * Диаметры — из таблицы pipe_sizes (дюймы, как в «База данных.xlsx»).
 * Рекомендуемые скорости (лист «Подбор»): всасывание 12 м/с, нагнетание 12 м/с,
 * жидкость 1.2 м/с. Скорость v = V̇ / A, V̇ = ṁ / ρ.
 */
'use strict';

const refr = require('./refrigerants');
const { db } = require('../db/database');

// Рекомендуемые скорости, м/с
const V_RECOMMEND = { suction: 12, discharge: 12, liquid: 1.2 };
// Допустимые диапазоны
const V_RANGE = {
  suction:   { min: 6, max: 15 },
  discharge: { min: 6, max: 18 },
  liquid:    { min: 0.4, max: 1.5 }
};

function getPipeSizes() {
  return db.prepare('SELECT * FROM pipe_sizes ORDER BY size_in').all();
}

function pipeArea(size) {
  const p = db.prepare('SELECT * FROM pipe_sizes WHERE size_in = ?').get(size);
  if (!p) return null;
  if (p.area_m2) return p.area_m2;
  const dIn = p.od_mm - 2 * p.wall_mm;
  return +(Math.PI * (dIn / 1000) ** 2 / 4).toFixed(8);
}

/**
 * Средняя плотность среды в линии, кг/м³.
 * @param {string} kind — suction | discharge | liquid
 */
function lineDensity(kind, { refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0 }) {
  if (kind === 'suction') return refr.rhoSuction(refrigerant, tEvap, dTsh);
  if (kind === 'discharge') {
    const tDisch = refr.dischargeTemp(refrigerant, tEvap, tCond, 0.75, dTsh);
    return refr.rhoDischarge(refrigerant, tCond, tDisch);
  }
  return refr.rhoLiquid(refrigerant, tCond - dTsc);
}

/**
 * Скорость среды, м/с, в трубе заданного дюймового размера.
 * Используется при индивидуальном подборе арматуры (виброгасители и т. п.).
 */
function velocityAt(sizeIn, kind, massFlowKgh, params) {
  const area = pipeArea(sizeIn);
  if (!area || !(massFlowKgh > 0)) return null;
  const rho = lineDensity(kind, params);
  if (!(rho > 0)) return null;
  const vdot = (massFlowKgh / 3600) / rho; // м³/с
  return +(vdot / area).toFixed(2);
}

/**
 * Расчет одной линии.
 * @param {string} kind — suction | discharge | liquid
 * @param {number} massFlowKgh — массовый расход, кг/ч
 * @param {number} minSizeIn — минимальный диаметр (патрубок компрессора), дюймы
 */
function calcLine({ kind, refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0, massFlowKgh, minSizeIn = 0 }) {
  const mdot = massFlowKgh / 3600; // кг/с
  const rho = lineDensity(kind, { refrigerant, tEvap, tCond, dTsh, dTsc });

  const Vdot = mdot / rho; // м³/с
  const vRec = V_RECOMMEND[kind];
  const vRange = V_RANGE[kind];

  const sizes = getPipeSizes().filter(p => p.size_in >= Math.max(minSizeIn, 0.25));
  const table = [];
  for (const p of sizes) {
    const A = pipeArea(p.size_in);
    const v = Vdot / A;
    const status = v < vRange.min ? 'small_v' : v > vRange.max ? 'large_v' : 'ok';
    table.push({
      size_in: p.size_in, od_mm: p.od_mm, wall_mm: p.wall_mm,
      v: +v.toFixed(2), status
    });
  }

  // Рекомендация: минимальный диаметр со скоростью <= рекомендуемой
  let recommended = table.find(t => t.v <= vRec && t.status === 'ok');
  if (!recommended) recommended = table.find(t => t.v <= vRange.max) || table[table.length - 1];

  return {
    kind, massFlowKgh: +massFlowKgh.toFixed(1),
    rho: +rho.toFixed(2), vdot_m3h: +(Vdot * 3600).toFixed(2),
    v_recommended: vRec, v_min: vRange.min, v_max: vRange.max,
    table, recommended
  };
}

/**
 * Полный расчет трубопроводов агрегата.
 * items — компрессоры из selection.evaluateSelection.
 * Индивидуальные линии — по одному компрессору; магистральные — суммарный расход.
 */
function calcPiping({ refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0, items }) {
  const individual = [];
  for (const c of items) {
    const mOne = c.mass_flow_kgh || 0;
    if (mOne <= 0) continue;
    individual.push({
      label: `${c.manufacturer} ${c.model} × ${c.qty}`,
      suction: calcLine({ kind: 'suction', refrigerant, tEvap, tCond, dTsh, massFlowKgh: mOne, minSizeIn: c.suction_d_in || 0 }),
      discharge: calcLine({ kind: 'discharge', refrigerant, tEvap, tCond, dTsh, massFlowKgh: mOne, minSizeIn: c.discharge_d_in || 0 })
    });
  }

  const totalMass = items.reduce((s, c) => s + (c.mass_flow_kgh || 0) * c.qty, 0);
  const common = {
    suction: calcLine({
      kind: 'suction', refrigerant, tEvap, tCond, dTsh,
      massFlowKgh: totalMass,
      minSizeIn: Math.max(...items.map(c => c.suction_d_in || 0), 0)
    }),
    discharge: calcLine({
      kind: 'discharge', refrigerant, tEvap, tCond, dTsh,
      massFlowKgh: totalMass,
      minSizeIn: Math.max(...items.map(c => c.discharge_d_in || 0), 0)
    }),
    liquid: calcLine({
      kind: 'liquid', refrigerant, tEvap, tCond, dTsh, dTsc,
      massFlowKgh: totalMass,
      minSizeIn: 0.375
    })
  };

  return { individual, common, totalMassFlowKgh: +totalMass.toFixed(1) };
}

module.exports = {
  calcLine, calcPiping, getPipeSizes, pipeArea,
  lineDensity, velocityAt, V_RECOMMEND, V_RANGE
};
