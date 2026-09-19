/**
 * Временная проверка моста: koffi → CoolProp.dll → PropsSI.
 * Контрольные значения из документации CoolProp (R134a, IIR-отсчёт:
 * при 0 °C энтальпия насыщенной жидкости = 200 кДж/кг).
 */
'use strict';

const path = require('path');
const koffi = require('koffi');

const DLL = path.join(__dirname, '..', 'vendor', 'coolprop', 'CoolProp.dll');
console.log('Библиотека:', DLL);
console.log('koffi:', koffi.version);

const lib = koffi.load(DLL);
const PropsSI = lib.func('double PropsSI(const char *Output, const char *Name1, double Prop1, const char *Name2, double Prop2, const char *FluidName)');
const Props1SI = lib.func('double Props1SI(const char *FluidName, const char *Output)');
const setRef = lib.func('int set_reference_stateS(const char *Ref, const char *reference_state)');
const globalParam = lib.func('long get_global_param_string(const char *param, _Out_ char *Output, int n)');

function errText() {
  const buf = Buffer.alloc(4096);
  globalParam('errstring', buf, buf.length);
  return buf.toString('utf8').replace(/\0.*$/, '');
}

const out = [];
function check(title, value, expected, tolerance) {
  const ok = Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
  out.push(`${ok ? 'OK  ' : 'FAIL'} ${title}: ${Number.isFinite(value) ? value.toPrecision(8) : value}` +
    (ok ? '' : ` (ожидалось ${expected} ±${tolerance})`));
  return ok;
}

let failed = 0;
try {
  console.log('Версия CoolProp:', Props1SI('Water', 'version') === null ? '?' : (() => {
    const buf = Buffer.alloc(128);
    globalParam('version', buf, buf.length);
    return buf.toString('utf8').replace(/\0.*$/, '');
  })());

  // IIR: h = 200 кДж/кг для насыщенной жидкости при 0 °C — как в прежней модели
  [['R404a'], ['R507a'], ['R410a'], ['R32'], ['R449b']].forEach(([f]) => {
    const rc = setRef(f, 'IIR');
    if (rc !== 0) { console.log('set_reference_stateS вернул', rc, 'для', f); }
  });

  // Контроль из документации CoolProp (без смены отсчёта не совпадёт, поэтому
  // проверяем физику: давление насыщения и плотности)
  const pH2O = PropsSI('P', 'T', 373.12429584766636, 'Q', 0, 'Water');
  failed += !check('p_sat воды при 100 °C, Па', pH2O, 101325, 20) ? 1 : 0;

  const hR134a = PropsSI('H', 'T', 273.15, 'Q', 0, 'R134a');
  failed += !check('h насыщенной жидкости R134a при 0 °C, Дж/кг (IIR)', hR134a, 200000, 5) ? 1 : 0;

  // R404a: давление кипения при −10 °C и 45 °C
  const pEvap = PropsSI('P', 'T', 263.15, 'Q', 0, 'R404a') / 1e5;
  const pCond = PropsSI('P', 'T', 318.15, 'Q', 0, 'R404a') / 1e5;
  failed += !check('R404a p_sat при −10 °C, бар', pEvap, 6.19, 0.15) ? 1 : 0;
  failed += !check('R404a p_sat при 45 °C, бар', pCond, 31.8, 0.6) ? 1 : 0;

  // Плотность перегретого пара на всасывании (0 °C, 6.19 бар) — ключевая правка
  const rhoSup = PropsSI('D', 'T', 273.15, 'P', pEvap * 1e5, 'R404a');
  const rhoSat = PropsSI('D', 'T', 263.15, 'Q', 1, 'R404a');
  failed += !check('плотность насыщенного пара R404a при −10 °C, кг/м³', rhoSat, 17.4, 0.6) ? 1 : 0;
  failed += !check('плотность перегретого пара (0 °C, p_кип), кг/м³', rhoSup, 16.8, 0.8) ? 1 : 0;
  out.push(`     контроль инварианта: перегретый < насыщенного → ${rhoSup < rhoSat ? 'да' : 'НЕТ'}`);
  if (!(rhoSup < rhoSat)) failed += 1;

  // Энтальпии точек цикла, кДж/кг
  const h1 = PropsSI('H', 'T', 273.15, 'P', pEvap * 1e5, 'R404a') / 1000;
  const h3 = PropsSI('H', 'T', 318.15, 'Q', 0, 'R404a') / 1000;
  out.push(`     т.1 (всасывание 0 °C, ${pEvap.toFixed(2)} бар): h = ${h1.toFixed(2)} кДж/кг`);
  out.push(`     т.3 (жидкость 45 °C, нас. линия): h = ${h3.toFixed(2)} кДж/кг`);
  out.push(`     q0 = h1 − h3 = ${(h1 - h3).toFixed(2)} кДж/кг`);

  // Изоэнтропа: s1 → h2s при давлении конденсации (для КПД)
  const s1 = PropsSI('S', 'T', 273.15, 'P', pEvap * 1e5, 'R404a');
  const h2s = PropsSI('H', 'P', pCond * 1e5, 'S', s1, 'R404a') / 1000;
  out.push(`     s1 = ${(s1 / 1000).toFixed(4)} кДж/(кг·К) → h2s = ${h2s.toFixed(2)} кДж/кг`);
  out.push(`     адиабатная работа w_s = ${(h2s - h1).toFixed(2)} кДж/кг`);
} catch (e) {
  failed += 1;
  out.push(`FAIL исключение: ${e.message}`);
  out.push(`     CoolProp errstring: ${errText()}`);
}

console.log('\n' + out.join('\n'));
console.log(failed ? `\nЕсть ошибки: ${failed}` : '\nВсе проверки пройдены');
process.exitCode = failed ? 1 : 0;
