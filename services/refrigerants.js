/**
 * Свойства хладагентов: R404a, R507a, R410a, R32, R449b.
 * Табличные данные с линейной интерполяцией:
 *  - давление насыщения P_sat (бар абс.)
 *  - плотность насыщенного пара / жидкости
 *  - энтальпии (упрощенная линейная модель, кДж/кг)
 * Расчет 4 характерных точек цикла (как в «Калькулятор Ultima_Prime_DB.xlsx»):
 *  перегретый пар (всасывание), конец сжатия (нагнетание),
 *  переохлажденная жидкость, точка дросселирования.
 */
'use strict';

// Температурная сетка, °C
const T_GRID = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];

const PROPS = {
  R404a: {
    name: 'R404a', safety: 'A1', glide: 0.7, gwp: 3922, M: 97.6,
    psat:  [0.86, 1.60, 2.64, 4.12, 6.18, 8.90, 12.4, 16.7, 22.0, 28.4, 36.0, 44.8],
    rho_v: [3.2, 5.6, 8.5, 12.4, 17.4, 23.8, 31.8, 41.6, 53.5, 68.0, 85.5, 106],
    rho_l: [950, 925, 900, 875, 848, 820, 790, 758, 722, 682, 635, 580],
    cp_v: 0.88, cp_l: 1.45, k_ex: 1.13, h_f0: 200, latent0: 185
  },
  R507a: {
    name: 'R507a', safety: 'A1', glide: 0.0, gwp: 3985, M: 98.9,
    psat:  [0.90, 1.66, 2.74, 4.26, 6.36, 9.13, 12.7, 17.1, 22.4, 28.9, 36.6, 45.5],
    rho_v: [3.3, 5.8, 8.8, 12.8, 18.0, 24.6, 32.9, 43.0, 55.3, 70.2, 88.2, 109],
    rho_l: [955, 930, 905, 880, 852, 824, 793, 760, 723, 682, 634, 578],
    cp_v: 0.89, cp_l: 1.45, k_ex: 1.13, h_f0: 200, latent0: 183
  },
  R410a: {
    name: 'R410a', safety: 'A1', glide: 0.1, gwp: 2088, M: 72.6,
    psat:  [0.82, 1.79, 3.06, 4.90, 7.47, 10.97, 15.6, 21.5, 28.9, 37.8, 48.5, 61.2],
    rho_v: [2.7, 5.6, 9.6, 15.2, 23.0, 33.6, 47.5, 65.4, 88.0, 116, 150, 192],
    rho_l: [1190, 1155, 1120, 1082, 1043, 1000, 953, 900, 840, 770, 685, 570],
    cp_v: 0.85, cp_l: 1.65, k_ex: 1.18, h_f0: 200, latent0: 225
  },
  R32: {
    name: 'R32', safety: 'A2L', glide: 0.0, gwp: 675, M: 52.0,
    psat:  [0.81, 1.83, 3.19, 5.16, 7.90, 11.55, 16.3, 22.4, 30.0, 39.3, 50.6, 64.2],
    rho_v: [2.1, 4.4, 7.7, 12.5, 19.4, 29.0, 41.8, 58.5, 79.7, 106, 139, 179],
    rho_l: [1140, 1105, 1068, 1028, 985, 940, 890, 835, 773, 702, 615, 505],
    cp_v: 0.95, cp_l: 1.85, k_ex: 1.24, h_f0: 210, latent0: 330
  },
  R449b: {
    name: 'R449b', safety: 'A1', glide: 4.5, gwp: 1397, M: 87.5,
    psat:  [0.84, 1.55, 2.56, 4.00, 6.00, 8.65, 12.1, 16.3, 21.4, 27.7, 35.1, 43.7],
    rho_v: [3.1, 5.4, 8.2, 12.0, 16.9, 23.2, 31.1, 40.8, 52.6, 67.0, 84.4, 105],
    rho_l: [960, 936, 911, 886, 858, 830, 799, 766, 729, 688, 640, 583],
    cp_v: 0.90, cp_l: 1.45, k_ex: 1.12, h_f0: 200, latent0: 190
  }
};

function interp(table, t) {
  if (t <= T_GRID[0]) return table[0];
  if (t >= T_GRID[T_GRID.length - 1]) return table[table.length - 1];
  for (let i = 0; i < T_GRID.length - 1; i++) {
    if (t >= T_GRID[i] && t <= T_GRID[i + 1]) {
      const f = (t - T_GRID[i]) / (T_GRID[i + 1] - T_GRID[i]);
      return table[i] + f * (table[i + 1] - table[i]);
    }
  }
  return table[0];
}

function getProps(code) {
  const key = Object.keys(PROPS).find(k => k.toLowerCase() === String(code).toLowerCase());
  if (!key) throw new Error(`Хладагент ${code} не поддерживается`);
  return PROPS[key];
}

/** Давление насыщения, бар (абс.) */
function psatBar(code, tC) { return interp(getProps(code).psat, tC); }

/** Плотность насыщенного пара, кг/м³ */
function rhoVaporSat(code, tC) { return interp(getProps(code).rho_v, tC); }

/** Плотность жидкости, кг/м³ */
function rhoLiquid(code, tC) { return interp(getProps(code).rho_l, tC); }

/** Энтальпия жидкости, кДж/кг: h = h_f0 + cp_l*T */
function hLiquid(code, tC) {
  const p = getProps(code);
  return p.h_f0 + p.cp_l * tC;
}

/** Энтальпия насыщенного пара, кДж/кг */
function hVaporSat(code, tC) {
  const p = getProps(code);
  return p.h_f0 + p.cp_l * tC + (p.latent0 - 0.35 * tC);
}

/** Энтальпия перегретого пара при давлении насыщения tSat и температуре tSup, кДж/кг */
function hVaporSuperheated(code, tSat, tSup) {
  const p = getProps(code);
  return hVaporSat(code, tSat) + p.cp_v * Math.max(tSup - tSat, 0);
}

/**
 * Плотность всасываемого пара (перегрев dTsh относительно t_evap).
 * Идеальный газ с поправкой на сжимаемость.
 */
function rhoSuction(code, tEvap, dTsh) {
  const p = getProps(code);
  const P = psatBar(code, tEvap) * 1e5; // Па
  const T = tEvap + dTsh + 273.15;
  const R = 8314 / p.M;
  return (P * 0.92) / (R * T);
}

/** Плотность пара нагнетания (при P_cond, температуре tDisch) */
function rhoDischarge(code, tCond, tDisch) {
  const p = getProps(code);
  const P = psatBar(code, tCond) * 1e5;
  const T = tDisch + 273.15;
  const R = 8314 / p.M;
  return (P * 0.95) / (R * T);
}

/** Оценка температуры нагнетания (конец сжатия), °C */
function dischargeTemp(code, tEvap, tCond, etaIs = 0.75) {
  const p = getProps(code);
  const pe = psatBar(code, tEvap), pc = psatBar(code, tCond);
  const r = Math.max(pc / pe, 1.01);
  const dT = (tEvap + 273.15) * (Math.pow(r, (p.k_ex - 1) / p.k_ex) - 1) * (1 / etaIs - 1) * p.cp_v;
  return tCond + Math.max(dT, 10);
}

/** ΔT насыщения, соответствующий перепаду давления dP (бар) */
function dTfromdP(code, tRef, dPbar) {
  const p1 = psatBar(code, tRef - 0.5), p2 = psatBar(code, tRef + 0.5);
  const dpdT = Math.max(p2 - p1, 0.01); // бар/К
  return dPbar / dpdT;
}

/**
 * 4 характерные точки цикла (структура листа «Подбор»):
 *  1. Перегретый пар (всасывание): t = tEvap + dTsh
 *  2. Конец сжатия (нагнетание): t = tDisch
 *  3. Переохлажденная жидкость: t = tCond - dTsc
 *  4. Точка дросселирования: t = tEvap (h = h жидкости)
 */
function cyclePoints(code, tEvap, tCond, dTsh = 10, dTsc = 0) {
  const tDisch = dischargeTemp(code, tEvap, tCond);
  const h1 = hVaporSuperheated(code, tEvap, tEvap + dTsh);   // всасывание
  const h2 = h1 + (hVaporSuperheated(code, tCond, tDisch) - hVaporSat(code, tCond)); // конец сжатия (упрощ.)
  const h3 = hLiquid(code, tCond - dTsc);                     // переохлажденная жидкость
  const h4 = h3;                                              // дросселирование: h = const
  return {
    suction:   { label: 'Перегретый пар', t: +(tEvap + dTsh).toFixed(1), p: +psatBar(code, tEvap).toFixed(2), rho: +rhoSuction(code, tEvap, dTsh).toFixed(2), h: +h1.toFixed(2) },
    discharge: { label: 'Конец сжатия', t: +tDisch.toFixed(1), p: +psatBar(code, tCond).toFixed(2), rho: +rhoDischarge(code, tCond, tDisch).toFixed(2), h: +h2.toFixed(2) },
    liquid:    { label: 'Переохлажденная жидкость', t: +(tCond - dTsc).toFixed(1), p: +psatBar(code, tCond).toFixed(2), rho: +rhoLiquid(code, tCond - dTsc).toFixed(2), h: +h3.toFixed(2) },
    throttle:  { label: 'Точка дросселирования', t: +tEvap.toFixed(1), p: +psatBar(code, tEvap).toFixed(2), rho: +rhoLiquid(code, tEvap).toFixed(2), h: +h4.toFixed(2) }
  };
}

function listSupported() {
  return Object.keys(PROPS).map(code => ({
    code, name: PROPS[code].name, safety: PROPS[code].safety,
    glide: PROPS[code].glide, gwp: PROPS[code].gwp
  }));
}

module.exports = {
  PROPS, psatBar, rhoVaporSat, rhoLiquid, hLiquid, hVaporSat, hVaporSuperheated,
  rhoSuction, rhoDischarge, dischargeTemp, dTfromdP, cyclePoints, listSupported, getProps
};