/**
 * Временная проверка схемы после переработки по приложенной гидравлике
 * (удаляется после прогона): три штуцера ресивера, вход и выход
 * маслоотделителя сверху, зимняя обвязка KVR → NRV → NRD, уменьшенные
 * фильтры, подписи линий без испарителя.
 */
'use strict';

const BASE = 'http://localhost:3000';
const failures = [];

function check(title, ok, detail) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${title}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(title);
}

const body = fields => {
  const p = new URLSearchParams();
  Object.entries(fields).forEach(([k, v]) => p.append(k, v));
  return p;
};

/** Знаки схемы: координаты, поворот, масштаб, признак «обозначение внутри», обозначение */
function units(html) {
  const from = html.indexOf('schematic__units');
  const to = html.indexOf('schematic__line-labels');
  if (from < 0 || to < 0) return [];
  return [...html.slice(from, to).matchAll(
    /<g class="schematic__unit" transform="translate\(([\d.-]+) ([\d.-]+)\) rotate\((-?\d+)\)(?: scale\(([\d.]+)\))?">[\s\S]*?<\/g>\s*<text class="schematic__tag([^"]*)"[^>]*x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)</g
  )].map(m => ({
    x: Number(m[1]), y: Number(m[2]), rot: Number(m[3]),
    scale: m[4] ? Number(m[4]) : 1, inside: m[5].includes('inside'),
    tagX: Number(m[6]), tagY: Number(m[7]), tag: m[8]
  }));
}

/** Трубы схемы */
function wires(html) {
  const from = html.indexOf('schematic__pipes');
  const to = html.indexOf('schematic__arrows');
  if (from < 0 || to < 0) return [];
  return [...html.slice(from, to).matchAll(/class="schematic__pipe schematic__pipe--(\w+)" d="([^"]*)"/g)]
    .map(m => ({ kind: m[1], d: m[2] }));
}

const COMP_FIRST_X = 300;
const COMP_STEP_X = 190;
const HEADER_Y = 470;
const LIQUID_Y = 370;
const OIL_FEED_Y = 620;
const REGULATOR_DX = 95;
const REGULATOR_VALVE_Y = 700;
const OIL_HEADER_X = 1100;
const NRV_X = 1280;
const INLET_VALVE_X = 1220;
const RECEIVER_X = 1080;
const SAFETY_Y = 300;
const BYPASS = { x: 1250, y: 420 };
const RISER_X = 1290;

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

  const list = '/calc/api/compressors?refrigerant=R404a&type=scroll';
  const model = (await (await fetch(`${BASE}${list}`, { headers: { Cookie: cookie } })).json()).compressors[0];

  const params = body({
    refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '45',
    dTsh: '10', dTsc: '0', tolerancePct: '10', housingCode: '',
    mode: 'manual', manualType: 'any', manualManufacturer: 'any',
    compressorId: String(model.id), compressorQty: '2'
  });
  params.append('options', 'vibration');
  params.append('options', 'compressor_valve');
  params.append('options', 'suction_filter');

  const html = await (await fetch(`${BASE}/calc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params
  })).text();

  const all = units(html);
  const pipes = wires(html);
  const tags = all.map(u => u.tag);
  const at = (x, y) => all.find(u => u.x === x && u.y === y);
  const compressorXs = [COMP_FIRST_X, COMP_FIRST_X + COMP_STEP_X];

  // --- 1. Подписи линий ---------------------------------------------------
  check('подписей про испаритель и названий линий нет',
    !html.includes('вывод к испарителю') && !html.includes('вывод от испарителя')
    && !html.includes('Всасывающая линия') && !html.includes('Жидкостная линия')
    && !html.includes('испаритель (внешний)'));
  check('подпись «Нагнетание» с размером осталась',
    html.includes('Нагнетание') && html.includes('Ø'));

  // --- 2. Маслоотделитель: вход и выход сверху ---------------------------
  const separator = at(OIL_HEADER_X, HEADER_Y + 60);
  check('маслоотделитель висит под коллектором',
    !!separator && separator.tag === 'OS1', separator ? separator.tag : 'нет');
  check('вход и выход нагнетания подведены к верхнему днищу',
    pipes.some(p => p.d === `M ${OIL_HEADER_X - 20} ${HEADER_Y} V ${HEADER_Y + 14}`)
    && pipes.some(p => p.d === `M ${OIL_HEADER_X + 20} ${HEADER_Y + 14} V ${HEADER_Y}`),
    pipes.filter(p => p.d.includes(`${HEADER_Y + 14}`)).map(p => p.d).join(' | '));
  check('коллектор нагнетания разрезан маслоотделителем',
    pipes.some(p => p.d === `M ${compressorXs[0]} ${HEADER_Y} H ${OIL_HEADER_X - 20}`)
    && pipes.some(p => p.d === `M ${OIL_HEADER_X + 20} ${HEADER_Y} H ${RISER_X} V ${255}`));

  // --- 3. Три штуцера линейного ресивера ----------------------------------
  const receiver = at(RECEIVER_X, LIQUID_Y);
  check('линейный ресивер на жидкостной линии', !!receiver && receiver.tag === 'LR1');
  const inlet = at(INLET_VALVE_X, LIQUID_Y);
  check('вентиль на входе ресивера', !!inlet, inlet ? inlet.tag : 'нет');
  const nrv = at(NRV_X, LIQUID_Y);
  check('обратный клапан NRV на сливе из конденсатора',
    !!nrv && nrv.tag.startsWith('CV'), nrv ? nrv.tag : 'нет');
  check('NRV стоит перед вентилем входа в ресивер', NRV_X > INLET_VALVE_X && INLET_VALVE_X > RECEIVER_X);
  const safety = at(RECEIVER_X, SAFETY_Y);
  check('предохранительный клапан на штуцере ресивера',
    !!safety && safety.tag.startsWith('SV'), safety ? safety.tag : 'нет');
  check('штуцер предохранительного клапана соединён с ресивером',
    pipes.some(p => p.kind === 'branch' && p.d === `M ${RECEIVER_X} ${LIQUID_Y} V ${SAFETY_Y}`));

  // --- 4. Зимняя обвязка KVR → NRV → NRD ----------------------------------
  const winter = body({
    refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '20',
    dTsh: '10', dTsc: '0', tolerancePct: '10', housingCode: '',
    mode: 'manual', manualType: 'any', manualManufacturer: 'any',
    compressorId: String(model.id), compressorQty: '2'
  });
  winter.append('options', 'vibration');
  winter.append('options', 'suction_filter');
  const winterHtml = await (await fetch(`${BASE}/calc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: winter
  })).text();
  const winterUnits = units(winterHtml);
  const winterWires = wires(winterHtml);
  const kvr = winterUnits.find(u => u.x === RISER_X && u.y === 400);
  check('KVR стоит на нагнетании после маслоотделителя',
    !!kvr && kvr.tag.startsWith('V') && RISER_X > OIL_HEADER_X, kvr ? kvr.tag : 'нет');
  const nrd = winterUnits.find(u => u.x === BYPASS.x);
  check('NRD на байпасной линии с нагнетания в ресивер',
    !!nrd && nrd.tag.startsWith('DV'), nrd ? nrd.tag : 'нет');
  check('байпас входит между NRV и вентилем входа в ресивер',
    winterWires.some(p => p.kind === 'diff' && p.d === `M ${RISER_X} ${BYPASS.y} H ${BYPASS.x} V ${LIQUID_Y}`)
    && BYPASS.x < NRV_X && BYPASS.x > INLET_VALVE_X,
    `NRV ${NRV_X} > NRD ${BYPASS.x} > вентиль ${INLET_VALVE_X}`);
  const nrvWinter = winterUnits.find(u => u.x === NRV_X);
  check('NRV на сливе присутствует и в зимнем комплекте', !!nrvWinter,
    nrvWinter ? nrvWinter.tag : 'нет');

  // --- 5. Уменьшенные фильтры --------------------------------------------
  const filters = all.filter(u => ['DF1', 'DFi1', 'SF1', 'OF1'].includes(u.tag));
  check('фильтры уменьшены вдвое',
    filters.length === 4 && filters.every(u => u.scale === 0.5),
    filters.map(u => `${u.tag}:${u.scale}`).join(', '));

  // --- 6. Регуляторы уровня масла и вентили перед ними --------------------
  const regulatorXs = compressorXs.map(x => x + REGULATOR_DX);
  const regulators = all.filter(u => u.tag === 'OML1' || u.tag === 'ER1');
  check('регулятор уровня масла на каждый компрессор',
    regulators.length === 2 && regulators.every((u, i) => u.x === regulatorXs[i] && u.y === 780),
    regulators.map(u => `${u.tag}@${u.x},${u.y}`).join(' | '));
  check('обозначение регулятора вынесено под знак',
    regulators.length === 2 && regulators.every(u => !u.inside && u.tagY === u.y + 40),
    regulators.map(u => `tagY ${u.tagY}`).join(', '));
  check('вентиль Rotalock перед регулятором опущен к нему',
    regulatorXs.every(x => all.some(u => u.x === x && u.y === REGULATOR_VALVE_Y && u.scale === 0.5)),
    `y = ${REGULATOR_VALVE_Y}, регуляторы на 780`);

  // --- 7. Линия подачи масла ---------------------------------------------
  const oilValve = at(OIL_HEADER_X - 50, OIL_FEED_Y);
  check('вентиль на выходе масляного ресивера стоит на линии подачи',
    !!oilValve, oilValve ? `${oilValve.tag}@${oilValve.x}` : 'нет');
  check('обозначение вентиля смещено влево (text-anchor: end)',
    !!oilValve && /text-anchor="end"/.test(html.slice(html.indexOf('schematic__units'), html.indexOf('schematic__line-labels'))));
  const oilFilter = at(OIL_HEADER_X - 110, OIL_FEED_Y);
  check('масляный фильтр правее всех врезок регуляторов',
    !!oilFilter && oilFilter.x > regulatorXs[regulatorXs.length - 1],
    oilFilter ? `OF @${oilFilter.x}, врезка ${regulatorXs[regulatorXs.length - 1]}` : 'нет');
  const oilReceiver = at(OIL_HEADER_X, OIL_FEED_Y);
  check('масляный ресивер на линии подачи', !!oilReceiver && oilReceiver.tag === 'OR1');

  // --- 8. Обозначения из приложенной гидравлики ---------------------------
  const legendText = html.slice(html.indexOf('schematic__legend'));
  check('в графе «Марка» марки из приложенной схемы',
    ['FP-OF-038s', 'FP-RV-014 SAE', 'FP-ERL4', 'FP-SV-038'].every(a => legendText.includes(a)),
    ['FP-OF-038s', 'FP-RV-014 SAE', 'FP-ERL4', 'FP-SV-038'].filter(a => legendText.includes(a)).join(', '));

  // --- 9. Сохранённый КП --------------------------------------------------
  const save = await fetch(`${BASE}/quotes/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params,
    redirect: 'manual'
  });
  const savedUrl = save.headers.get('location') || '';
  console.log(`\nКП для просмотра: ${savedUrl || '(не сохранён)'}`);
  if (savedUrl) {
    const saved = await (await fetch(`${BASE}${savedUrl}`, { headers: { Cookie: cookie } })).text();
    check('в сохранённом КП схема отрисована и подписи без испарителя',
      saved.includes('schematic__svg') && !saved.includes('вывод к испарителю')
      && !saved.includes('Жидкостная линия') && saved.includes('Нагнетание'));
    const print = await (await fetch(`${BASE}${savedUrl}/print`, { headers: { Cookie: cookie } })).text();
    check('в печатной форме схема отрисована', print.includes('schematic__svg'));
    const prod = await (await fetch(`${BASE}${savedUrl}/production`, { headers: { Cookie: cookie } })).text();
    check('в производственном задании схема отрисована', prod.includes('schematic__svg'));
  }

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
