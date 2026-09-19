/**
 * Временный сбор фактических чисел из расчёта (удаляется после прогона):
 * печатает блок «точки цикла», COP, массовый расход и трубопроводы, а также
 * считает проверки согласованности — чтобы зафиксировать ошибки модели
 * холодильного цикла на реальных значениях приложения.
 */
'use strict';

const BASE = 'http://localhost:3000';
const refr = require('../services/refrigerants');

const body = fields => {
  const p = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => p.append(k, v));
  return p;
};

const num = s => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/** Значения из таблицы «Свойства хладагента — точки цикла» */
function cycleTable(html) {
  const head = html.indexOf('Свойства хладагента');
  if (head < 0) return [];
  const rows = [...html.slice(head).matchAll(
    /<tr>\s*<td>([^<]+)<\/td>\s*<td class="num">([\d.-]+)<\/td>\s*<td class="num">([\d.-]+)<\/td>\s*<td class="num">([\d.-]+)<\/td>\s*<td class="num">([\d.-]+)<\/td>/g
  )];
  return rows.map(m => ({ label: m[1], t: num(m[2]), p: num(m[3]), rho: num(m[4]), h: num(m[5]) }));
}

/** Таблица магистральных линий */
function pipeTable(html) {
  const head = html.indexOf('магистральные линии');
  if (head < 0) return [];
  return [...html.slice(head).matchAll(
    /<tr>\s*<td>([^<]+)<\/td>\s*<td class="num">([\d.]+)<\/td>\s*<td class="num">([\d.]+)<\/td>\s*<td class="num num--strong">([^<]+)<\/td>\s*<td class="num">Ø([\d.]+)×([\d.]+)<\/td>\s*<td class="num">([\d.]+)<\/td>/g
  )].map(m => ({
    line: m[1], mass: num(m[2]), vdot: num(m[3]), sizeIn: m[4],
    od: num(m[5]), wall: num(m[6]), v: num(m[7])
  }));
}

/** Показатели KPI и характеристик агрегата */
function kpis(html) {
  const grab = label => {
    const i = html.indexOf(label);
    if (i < 0) return null;
    const chunk = html.slice(i, i + 400);
    const m = chunk.match(/class="stat__value">([\d.,-]+)/) || chunk.match(/<td>([\d.,-]+) кВт<\/td>/) || chunk.match(/<td>([\d.,-]+)<\/td>/);
    return m ? num(m[1]) : null;
  };
  const kv = label => {
    const i = html.indexOf(`<td>${label}</td>`);
    if (i < 0) return null;
    const m = html.slice(i).match(/<td>([\d.,-]+)<\/td>/);
    return m ? num(m[1]) : null;
  };
  return {
    q: grab('Холодопроизводительность'),
    power: grab('Потребляемая мощность'),
    cop: grab('COP'),
    massFlow: grab('Массовый расход'),
    heat: kv('Теплопроизводительность'),
    current: kv('Суммарный ток')
  };
}

async function main() {
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body({ email: 'admin@local', password: 'admin123' }),
    redirect: 'manual'
  });
  const cookies = typeof login.headers.getSetCookie === 'function'
    ? login.headers.getSetCookie()
    : [login.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');

  const model = (await (await fetch(`${BASE}/calc/api/compressors?refrigerant=R404a&type=scroll`,
    { headers: { Cookie: cookie } })).json()).compressors.find(c => c.poly_mass) ||
    (await (await fetch(`${BASE}/calc/api/compressors?refrigerant=R404a&type=scroll`,
      { headers: { Cookie: cookie } })).json()).compressors[0];

  const mode = { refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '45', dTsh: '10', dTsc: '0' };
  const params = body({
    ...mode, tolerancePct: '10', housingCode: '',
    mode: 'manual', manualType: 'any', manualManufacturer: 'any',
    compressorId: String(model.id), compressorQty: '2'
  });

  const html = await (await fetch(`${BASE}/calc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params
  })).text();

  const cyc = cycleTable(html);
  const pipes = pipeTable(html);
  const k = kpis(html);

  console.log('=== Режим: R404a, tEvap -10, tCond 45, dTsh 10, dTsc 0, компрессор', model.model, '× 2 ===\n');
  console.log('Точки цикла, как их показывает приложение:');
  cyc.forEach(p => console.log(`  ${p.label.padEnd(28)} t=${p.t} °C  P=${p.p} бар  ρ=${p.rho} кг/м³  h=${p.h} кДж/кг`));

  console.log('\nПоказатели агрегата (из полиномов компрессоров):');
  console.log(`  Q = ${k.q} кВт, N = ${k.power} кВт, COP = ${k.cop}, ṁ = ${k.massFlow} кг/ч, тепло = ${k.heat} кВт`);

  console.log('\nМагистральные линии:');
  pipes.forEach(p => console.log(`  ${p.line.padEnd(12)} ṁ=${p.mass} кг/ч  V̇=${p.vdot} м³/ч  Ø${p.sizeIn}" (${p.od}×${p.wall})  v=${p.v} м/с`));

  if (cyc.length === 4 && k.cop) {
    const [s, d, l, t] = cyc;
    const q0 = +(s.h - t.h).toFixed(2);
    const w = +(d.h - s.h).toFixed(2);
    console.log('\n=== Проверки согласованности ===');
    console.log(`  удельная холодопроизводительность q0 = h1 - h4 = ${q0} кДж/кг`);
    console.log(`  удельная работа сжатия w = h2 - h1 = ${w} кДж/кг`);
    console.log(`  COP по циклу = q0 / w = ${(q0 / w).toFixed(2)}  ← против COP = ${k.cop} по полиномам компрессоров`);
    console.log(`  массовый расход по циклу = Q·3600/q0 = ${(k.q * 3600 / q0).toFixed(1)} кг/ч  ← против ${k.massFlow} кг/ч в приложении`);
    const tDisch = refr.dischargeTemp('R404a', -10, 45);
    console.log(`  температура нагнетания (функция dischargeTemp) = ${tDisch.toFixed(1)} °C`);
    const rhoS = refr.rhoSuction('R404a', -10, 10);
    const rhoV = refr.rhoVaporSat('R404a', -10);
    console.log(`  плотность всасывания (формула) = ${rhoS.toFixed(2)} кг/м³, а плотность НАСЫЩЕННОГО пара при -10 °C (таблица) = ${rhoV} кг/м³`);
    console.log(`  → перегретый пар получился ПЛОТНЕЕ насыщенного на ${((rhoS / rhoV - 1) * 100).toFixed(0)} % при том же давлении (физически невозможно)`);
    const rhoD = refr.rhoDischarge('R404a', 45, tDisch);
    console.log(`  плотность нагнетания = ${rhoD.toFixed(2)} кг/м³ при t нагнетания ${tDisch.toFixed(1)} °C`);
    console.log(`  давление всасывания в расчёте = ${refr.psatBar('R404a', -10).toFixed(2)} бар (это давление КИПЕНИЯ, перепад во всасывающей линии не учтён)`);
    console.log(`  давление нагнетания в расчёте = ${refr.psatBar('R404a', 45).toFixed(2)} бар (бар абс.; на манометре было бы ${(refr.psatBar('R404a', 45) - 1.013).toFixed(2)} бар изб.)`);
  }
}

main().catch(e => { console.error('Ошибка:', e); process.exitCode = 1; });
