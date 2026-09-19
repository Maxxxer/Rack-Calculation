д/**
 * Временная сводная проверка после переработки схемы (удаляется после прогона):
 * обозначения и легенда, внешние элементы, подписи линий, страницы КП и
 * основные требования по комплектации, опциям и вариантам подбора.
 */
'use strict';

const BASE = 'http://localhost:3000';
const failures = [];

function check(title, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${title}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(title);
}

function formBody(fields) {
  const params = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(item => params.append(k, item));
    else params.append(k, v);
  });
  return params;
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
}

async function post(path, cookie, params) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params
  });
}

function legendRows(html) {
  const from = html.indexOf('schematic__legend');
  if (from < 0) return [];
  return [...html.slice(from).matchAll(
    /legend-tag">([^<]*)<\/td>\s*<td class="schematic__legend-name">([^<]*)<\/td>\s*<td class="schematic__legend-article">([^<]*)<\/td>\s*<td class="schematic__legend-qty">(\d+)<\/td>/g
  )].map(m => ({ tag: m[1], name: m[2], article: m[3], qty: Number(m[4]) }));
}

function drawnTags(html) {
  const from = html.indexOf('schematic__units');
  const to = html.indexOf('schematic__line-labels');
  if (from < 0 || to < 0) return [];
  return [...html.slice(from, to).matchAll(/class="schematic__tag[^"]*"[^>]*>([^<]*)</g)].map(m => m[1]);
}

function standardNames(html) {
  const from = html.indexOf('std-list');
  const to = html.indexOf('variantPinned', from);
  return [...html.slice(from, to).matchAll(/std-list__name">([^<]*)</g)].map(m => m[1]);
}

function manualBody(compressorId, qty) {
  return {
    refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '45',
    dTsh: '10', dTsc: '0', tolerancePct: '10', housingCode: '',
    mode: 'manual', manualType: 'any', manualManufacturer: 'any',
    compressorId: String(compressorId), compressorQty: String(qty)
  };
}

const SELECTED = [
  'vibration', 'compressor_valve', 'safety_valve', 'oil_filter', 'liquid_separator', 'suction_filter',
  'pressure_switch_hp', 'pressure_switch_lp', 'pressure_transmitter',
  'gauge_hp', 'gauge_lp', 'discharge_thermostat'
];

async function main() {
  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ email: 'admin@local', password: 'admin123' }),
    redirect: 'manual'
  });
  const cookies = typeof login.headers.getSetCookie === 'function'
    ? login.headers.getSetCookie()
    : [login.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');

  const compressors = async type =>
    (await (await get(`/calc/api/compressors?refrigerant=R404a&type=${type}`, cookie)).json()).compressors;
  const scroll = (await compressors('scroll'))[0];
  const screw = (await compressors('screw'))[0];
  const recip = (await compressors('recip'))[0];

  // --- Схема: обозначения, легенда, приборы ------------------------------
  const params = formBody(manualBody(scroll.id, 2));
  SELECTED.forEach(code => params.append('options', code));
  const html = await (await post('/calc', cookie, params)).text();

  check('схема построена', html.includes('schematic__svg'));
  check('легенда — таблица с обозначениями',
    html.includes('<th>Обозначение</th>') && html.includes('<th>Марка</th>'));

  const rows = legendRows(html);
  const tags = rows.map(r => r.tag);
  ['COM1', 'OS1', 'LR1', 'DF1', 'SG1', 'SV1', 'OF1', 'VD1', 'VD2', 'CV1',
    'ACC1', 'SF1', 'T1', 'PB1', 'PSH1', 'PSL1', 'GP1', 'GP2']
    .forEach(tag => check(`обозначение ${tag}`, tags.includes(tag)));

  const valves = tags.filter(t => /^V\d+$/.test(t));
  check('вентили пронумерованы по порядку обхода контура',
    valves.length >= 3 && valves.every((v, i) => v === `V${i + 1}`), valves.join(', '));

  const drawn = drawnTags(html);
  check('все обозначения нанесены на чертёж',
    tags.every(tag => drawn.includes(tag)));
  check('внешние элементы контура подписаны', ['K1', 'EV1', 'EX1'].every(t => drawn.includes(t)));
  check('подписи линий с дюймовыми диаметрами',
    /Нагнетание Ø \d/.test(html) && /Жидкость Ø \d/.test(html) && /Всасывание Ø \d/.test(html));

  // --- Страницы КП --------------------------------------------------------
  const save = await fetch(`${BASE}/quotes/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params,
    redirect: 'manual'
  });
  const quoteUrl = save.headers.get('location') || '';
  check('КП сохранён', save.status === 302 && quoteUrl.includes('/quotes/KP-'), quoteUrl);
  const viewHtml = await (await get(quoteUrl, cookie)).text();
  check('просмотр КП: схема и обозначения',
    viewHtml.includes('schematic__svg') && legendRows(viewHtml).length === rows.length);
  const printHtml = await (await get(quoteUrl + '/print', cookie)).text();
  check('печатная форма: схема и легенда',
    printHtml.includes('schematic__svg') && printHtml.includes('schematic__legend-tag'));
  await post(quoteUrl + '/status', cookie, formBody({ status: 'approved' }));
  const prodHtml = await (await get(quoteUrl + '/production', cookie)).text();
  check('производственная спецификация: схема и обозначения',
    prodHtml.includes('schematic__svg') && prodHtml.includes('Обозначение'));
  const csv = await get(quoteUrl + '/production.csv', cookie);
  check('экспорт CSV', csv.status === 200, `HTTP ${csv.status}`);

  // --- Комплектация и опции ----------------------------------------------
  const twoHtml = await (await post('/calc', cookie, formBody(manualBody(scroll.id, 2)))).text();
  const twoStandard = standardNames(twoHtml);
  check('2×спиральный: масляная линия в базовом составе',
    ['Маслоотделитель', 'Масляный ресивер', 'ЭРУМ'].every(p => twoStandard.some(n => n.includes(p))));
  const oneHtml = await (await post('/calc', cookie, formBody(manualBody(scroll.id, 1)))).text();
  check('1×спиральный: маслоотделитель только опцией',
    !standardNames(oneHtml).some(n => /Маслоотделитель|Масляный ресивер/.test(n)) &&
    oneHtml.includes('name="options" value="oil_separator"'));

  const screwHtml = await (await post('/calc', cookie, formBody(manualBody(screw.id, 1)))).text();
  check('винтовой: маслоохладитель и ORV вместо масляной линии',
    screwHtml.includes('value="oil_cooler"') && screwHtml.includes('value="orv_thermostat"') &&
    !screwHtml.includes('value="erum"'));
  const recipHtml = await (await post('/calc', cookie, formBody(manualBody(recip.id, 1)))).text();
  check('поршневой: доступен отжим клапанов', recipHtml.includes('value="unloader"'));

  check('в окне опций есть запорный вентиль нагнетания компрессора',
    oneHtml.includes('value="compressor_valve"'));

  // --- Линии, варианты, вход ---------------------------------------------
  const pipesFrom = twoHtml.indexOf('Трубопроводы — магистральные линии');
  const pipesBlock = twoHtml.slice(pipesFrom, twoHtml.indexOf('Гидравлическая схема', pipesFrom));
  const order = ['Нагнетание', 'Жидкость', 'Всасывание'].map(l => pipesBlock.indexOf(l));
  check('порядок линий: нагнетание → жидкость → всасывание',
    order[0] >= 0 && order[0] < order[1] && order[1] < order[2]);
  const QUOT = String.fromCharCode(38) + '#34;';
  check('дюймовые размеры вида «2 1/8"»',
    new RegExp('\\d+ \\d+\\/\\d+' + QUOT).test(pipesBlock));

  const autoHtml = await (await post('/calc', cookie, formBody({
    refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '45', dTsh: '10', dTsc: '0',
    tolerancePct: '10', housingCode: '', mode: 'auto', autoType: 'any',
    autoManufacturer: 'any', autoMaxQty: '3'
  }))).text();
  const prices = [...autoHtml.matchAll(/variant-card__price"[\s\S]*?<b class="num">([\d.]+)<\/b>/g)].map(m => Number(m[1]));
  check('пять вариантов автоподбора по возрастанию цены',
    prices.length === 5 && prices.every((p, i) => i === 0 || p >= prices[i - 1]), prices.join(' → '));

  const remembered = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ email: 'admin@local', password: 'admin123', remember: 'on' }),
    redirect: 'manual'
  });
  const setCookie = (typeof remembered.headers.getSetCookie === 'function'
    ? remembered.headers.getSetCookie() : [remembered.headers.get('set-cookie')])
    .filter(Boolean).find(c => c.startsWith('connect.sid')) || '';
  const expires = /Expires=([^;]+)/i.exec(setCookie);
  const days = expires ? Math.round((new Date(expires[1]).getTime() - Date.now()) / 86400000) : 0;
  check('«Запомнить меня» — 30 дней', days >= 28 && days <= 31, `${days} дн.`);

  // --- Ранее сохранённые КП ----------------------------------------------
  const oldHtml = await (await get('/quotes/KP-2026-0011', cookie)).text();
  check('ранее сохранённый КП: схема и обозначения',
    oldHtml.includes('schematic__svg') && legendRows(oldHtml).length > 5);

  console.log(`\nИтог: ${failures.length ? 'есть ошибки' : 'все проверки пройдены'}`);
  if (failures.length) {
    console.log('Не прошли: ' + failures.join('; '));
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error('Ошибка проверки:', e);
  process.exitCode = 1;
});
