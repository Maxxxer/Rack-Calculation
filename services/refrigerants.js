/**
 * Термодинамические свойства хладагентов через CoolProp.
 *
 * Единицы публичного API сохранены прежними:
 * давление — бар абс., температура — °C, плотность — кг/м³,
 * энтальпия — кДж/кг.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const PYTHON = path.join(__dirname, '..', 'vendor', 'coolprop', 'python.exe');
const COOLPROP_SCRIPT = path.join(__dirname, '..', 'scripts', 'coolprop_query.py');
const COOLPROP_PATH = path.join(__dirname, '..', 'vendor', 'coolprop', 'extracted');
const FLUIDS = {
  R404a: { fluid: 'R404a', name: 'R404a', safety: 'A1', glide: 0.7, gwp: 3922 },
  R507a: { fluid: 'R507A', name: 'R507a', safety: 'A1', glide: 0.0, gwp: 3985 },
  R410a: { fluid: 'R410A', name: 'R410a', safety: 'A1', glide: 0.1, gwp: 2088 },
  R32: { fluid: 'R32', name: 'R32', safety: 'A2L', glide: 0.0, gwp: 675 },
  R449b: { fluid: 'R449A', name: 'R449b', safety: 'A1', glide: 4.5, gwp: 1397 }
};

function getFluid(code) {
  const key = Object.keys(FLUIDS).find(k => k.toLowerCase() === String(code).toLowerCase());
  if (!key) throw new Error(`Хладагент ${code} не поддерживается CoolProp`);
  return FLUIDS[key];
}

function call(output, name1, value1, name2, value2, code) {
  const fluid = getFluid(code);
  const result = execFileSync(PYTHON, [COOLPROP_SCRIPT, JSON.stringify({
    output, name1, value1, name2, value2, fluid: fluid.fluid
  })], {
    cwd: path.dirname(PYTHON),
    env: { ...process.env, PYTHONPATH: COOLPROP_PATH },
    encoding: 'utf8'
  }).trim();
  const value = Number(result);
  if (!Number.isFinite(value)) {
    throw new Error(`CoolProp не рассчитал ${output} для ${code}: ${result}`);
  }
  return value;
}

function saturationPressurePa(code, tC, quality) {
  return call('P', 'T', tC + 273.15, 'Q', quality, code);
}

/** Давление насыщения, бар (абс.). Для смеси используется паровая ветвь. */
function psatBar(code, tC) {
  return saturationPressurePa(code, tC, 1) / 1e5;
}

/** Плотность насыщенного пара, кг/м³. */
function rhoVaporSat(code, tC) {
  return call('D', 'T', tC + 273.15, 'Q', 1, code);
}

/** Плотность насыщенной жидкости, кг/м³. */
function rhoLiquid(code, tC) {
  return call('D', 'T', tC + 273.15, 'Q', 0, code);
}

/** Энтальпия насыщенной жидкости, кДж/кг. */
function hLiquid(code, tC) {
  return call('H', 'T', tC + 273.15, 'Q', 0, code) / 1000;
}

/** Энтальпия насыщенного пара, кДж/кг. */
function hVaporSat(code, tC) {
  return call('H', 'T', tC + 273.15, 'Q', 1, code) / 1000;
}

/** Энтальпия перегретого пара при температуре tSup и давлении насыщения tSat. */
function hVaporSuperheated(code, tSat, tSup) {
  const pressure = saturationPressurePa(code, tSat, 1);
  return call('H', 'T', tSup + 273.15, 'P', pressure, code) / 1000;
}

function rhoSuction(code, tEvap, dTsh) {
  const pressure = saturationPressurePa(code, tEvap, 1);
  return call('D', 'T', tEvap + dTsh + 273.15, 'P', pressure, code);
}

function rhoDischarge(code, tCond, tDisch) {
  const pressure = saturationPressurePa(code, tCond, 0);
  return call('D', 'T', tDisch + 273.15, 'P', pressure, code);
}

/**
 * Температура нагнетания из реального изоэнтропического сжатия:
 * h2 = h1 + (h2s - h1) / etaIs, затем CoolProp решает T(P,h2).
 */
function dischargeTemp(code, tEvap, tCond, etaIs = 0.75, dTsh = 10) {
  const suctionPressure = saturationPressurePa(code, tEvap, 1);
  const dischargePressure = saturationPressurePa(code, tCond, 0);
  const suctionTemperature = tEvap + dTsh + 273.15;
  const h1 = call('H', 'T', suctionTemperature, 'P', suctionPressure, code);
  const s1 = call('S', 'T', suctionTemperature, 'P', suctionPressure, code);
  const h2s = call('H', 'P', dischargePressure, 'S', s1, code);
  const h2 = h1 + (h2s - h1) / etaIs;
  return call('T', 'P', dischargePressure, 'H', h2, code) - 273.15;
}

/** ΔT насыщения, соответствующий перепаду давления dP (бар). */
function dTfromdP(code, tRef, dPbar) {
  const p1 = psatBar(code, tRef - 0.5);
  const p2 = psatBar(code, tRef + 0.5);
  return dPbar / Math.max(p2 - p1, 0.01);
}

function stateAtTP(code, temperatureC, pressureBar) {
  const pressure = pressureBar * 1e5;
  return {
    t: temperatureC,
    p: pressureBar,
    rho: call('D', 'T', temperatureC + 273.15, 'P', pressure, code),
    h: call('H', 'T', temperatureC + 273.15, 'P', pressure, code) / 1000
  };
}

/** Четыре характерные точки холодильного цикла. */
function cyclePoints(code, tEvap, tCond, dTsh = 10, dTsc = 0) {
  const suctionPressure = saturationPressurePa(code, tEvap, 1);
  const dischargePressure = saturationPressurePa(code, tCond, 0);
  const suctionTemperature = tEvap + dTsh + 273.15;
  const liquidTemperature = tCond - dTsc + 273.15;
  const h1 = call('H', 'T', suctionTemperature, 'P', suctionPressure, code);
  const s1 = call('S', 'T', suctionTemperature, 'P', suctionPressure, code);
  const h2s = call('H', 'P', dischargePressure, 'S', s1, code);
  const h2 = h1 + (h2s - h1) / 0.75;
  const t2 = call('T', 'P', dischargePressure, 'H', h2, code) - 273.15;
  const h3 = dTsc > 0
    ? call('H', 'T', liquidTemperature, 'P', dischargePressure, code)
    : call('H', 'T', tCond + 273.15, 'Q', 0, code);
  const h4 = h3;
  const t4 = call('T', 'P', suctionPressure, 'H', h4, code) - 273.15;

  return {
    suction: {
      label: 'Перегретый пар', t: +(tEvap + dTsh).toFixed(1),
      p: +(suctionPressure / 1e5).toFixed(2), rho: +call('D', 'T', suctionTemperature, 'P', suctionPressure, code).toFixed(2),
      h: +(h1 / 1000).toFixed(2)
    },
    discharge: {
      label: 'Конец сжатия', t: +t2.toFixed(1),
      p: +(dischargePressure / 1e5).toFixed(2), rho: +call('D', 'P', dischargePressure, 'H', h2, code).toFixed(2),
      h: +(h2 / 1000).toFixed(2)
    },
    liquid: {
      label: 'Переохлажденная жидкость', t: +(tCond - dTsc).toFixed(1),
      p: +(dischargePressure / 1e5).toFixed(2),
      rho: +(dTsc > 0
        ? call('D', 'T', liquidTemperature, 'P', dischargePressure, code)
        : call('D', 'T', tCond + 273.15, 'Q', 0, code)).toFixed(2),
      h: +(h3 / 1000).toFixed(2)
    },
    throttle: {
      label: 'Точка дросселирования', t: +t4.toFixed(1),
      p: +(suctionPressure / 1e5).toFixed(2), rho: +call('D', 'P', suctionPressure, 'H', h4, code).toFixed(2),
      h: +(h4 / 1000).toFixed(2)
    }
  };
}

function listSupported() {
  return Object.keys(FLUIDS).map(code => ({
    code, name: FLUIDS[code].name, safety: FLUIDS[code].safety,
    glide: FLUIDS[code].glide, gwp: FLUIDS[code].gwp
  }));
}

module.exports = {
  PROPS: FLUIDS, psatBar, rhoVaporSat, rhoLiquid, hLiquid, hVaporSat,
  hVaporSuperheated, rhoSuction, rhoDischarge, dischargeTemp, dTfromdP,
  cyclePoints, listSupported
};
