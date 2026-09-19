/**
 * Временная проверка схемы после правок (удаляется после прогона):
 *  - линии нагнетания и слива не пересекаются;
 *  - предохранительный клапан подключён к ресиверу;
 *  - сразу после ресивера стоит запорный Rotalock;
 *  - размеры линий вынесены на свободные места;
 *  - зазор под обозначением регулятора масла увеличен.
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

const RISER_X = 1390;
const DROP_X = 1300;
const HEADER_Y = 470;
const LIQUID_Y = 370;
const COND_BOTTOM = 255;
const RECEIVER_X = 1000;
const OUTLET_VALVE_X = 860;
const SAFETY = { x: 1000, y: 280 };
const COMP = { firstX: 300, stepX: 190, centerY: 780 };
const REGULATOR_DX = 95;

/** Знаки схемы */
function units(html) {
  const from = html.indexOf('schematic__units');
  const to = html.indexOf('schematic__line-labels');
  if (from < 0 || to < 0) return [];
  return [...html.slice(from, to).matchAll(
    /<g class="schematic__unit" transform="translate\(([\d.-]+) ([\d.-]+)\) rotate\((-?\d+)\)(?: scale\(([\d.]+)\))?">([\s\S]*?)<\/g>\s*<text class="schematic__tag([^"]*)"[^>]*x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)</g
  )].map(m => ({
    x: Number(m[1]), y: Number(m[2]), rot: Number(m[3]),
    scale: m[4] ? Number(m[4]) : 1, body: m[5], inside: m[6].includes('inside'),
    tagX: Number(m[7]), tagY: Number(m[8]), tag: m[9]
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

/** Подписи линий */
function labels(html) {
  const from = html.indexOf('schematic__line-labels');
  if (from < 0) return [];
  return [...html.slice(from).matchAll(
    /<text class="schematic__line-label[^"]*"[^>]*x="([\d.-]+)"[^>]*y="([\d.-]+)"[^>]*>([^<]*)</g
  )].map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
}

/** Пересекаются ли два отрезка (только ортогональные, в разных линиях) */
function crosses(a, b) {
  const vert = s => s.x1 === s.x2;
  const horz = s => s.y1 === s.y2;
  const inside = (v, a1, a2) => v >= Math.min(a1, a2) && v <= Math.max(a1, a2);
  if (vert(a) && horz(b)) {
    return inside(a.x1, b.x1, b.x2) && inside(b.y1, a.y1, a.y2)
      && !(a.x1 === b.x1 && (b.y1 === a.y1 || b.y1 === a.y2))
      && !((a.y1 === b.y1 || a.y1 === b.y2) && false);
  }
  if (vert(b) && horz(a)) return crosses(b, a);
  return false;
}

/** Отрезки одной трубы в виде примитивов */
function segments(d) {
  const out = [];
  let cur = null;
  const tokens = d.match(/[MHV]|-?[\d.]+/g) || [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'M') {
      cur = { x: Number(tokens[i + 1]), y: Number(tokens[i + 2]) };
      i += 2;
    } else if (t === 'H') {
      const x = Number(tokens[i + 1]); i += 1;
      out.push({ x1: cur.x, y1: cur.y, x2: x, y2: cur.y });
      cur = { x, y: cur.y };
    } else if (t === 'V') {
      const y = Number(tokens[i + 1]); i += 1;
      out.push({ x1: cur.x, y1: cur.y, x2: cur.x, y2: y });
      cur = { x: cur.x, y };
    }
  }
  return out;
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
    { headers: { Cookie: cookie } })).json()).compressors[0];

  const params = body({
    refrigerant: 'R404a', requiredKw: '90', tEvap: '-10', tCond: '45',
    dTsh: '10', dTsc: '0', tolerancePct: '10', housingCode: '',
    mode: 'manual', manualType: 'any', manualManufacturer: 'any',
    compressorId: String(model.id), compressorQty: '2'
  });
  ['vibration', 'compressor_valve', 'suction_filter'].forEach(o => params.append('options', o));

  const html = await (await fetch(`${BASE}/calc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params
  })).text();

  const all = units(html);
  const pipes = wires(html);
  const tags = all.map(u => u.tag);
  const at = (x, y) => all.find(u => u.x === x && u.y === y);

  // --- 1. Линии нагнетания и слива не пересекаются -------------------------
  const discharge = pipes.filter(p => p.kind === 'discharge').flatMap(p => segments(p.d));
  const liquid = pipes.filter(p => p.kind === 'liquid').flatMap(p => segments(p.d));
  const crossings = [];
  discharge.forEach(d => liquid.forEach(l => { if (crosses(d, l)) crossings.push(`${d.x1},${d.y1}→${d.x2},${d.y2} × ${l.x1},${l.y1}→${l.x2},${l.y2}`); }));
  check('линия нагнетания и линия слива не пересекаются', crossings.length === 0, crossings.join(' | '));
  check('подъём нагнетания идёт правее опуска слива',
    pipes.some(p => p.kind === 'discharge' && p.d.includes(`H ${RISER_X} V ${COND_BOTTOM}`))
    && pipes.some(p => p.kind === 'liquid' && p.d === `M ${DROP_X} ${COND_BOTTOM} V ${LIQUID_Y} H 420`),
    `нагнетание x=${RISER_X}, слив x=${DROP_X}`);

  // --- 2. Предохранительный клапан подключён к ресиверу --------------------
  const safety = at(SAFETY.x, SAFETY.y);
  check('предохранительный клапан на штуцере ресивера',
    !!safety && safety.tag.startsWith('SV'), safety ? safety.tag : 'нет');
  check('штуцер соединяет клапан с ресивером',
    pipes.some(p => p.kind === 'branch' && p.d === `M ${SAFETY.x} ${LIQUID_Y} V ${SAFETY.y}`));
  const svMask = safety ? safety.body.match(/<rect class="schematic__mask"[^>]*y="(-?[\d.]+)"[^>]*height="([\d.]+)"/) : null;
  check('вырез клапана не съедает штуцер (не заходит ниже врезки)',
    !!svMask && Number(svMask[1]) + Number(svMask[2]) <= 0,
    svMask ? `маска y=${svMask[1]} h=${svMask[2]}` : 'маска не найдена');

  // --- 3. Запорный Rotalock сразу после ресивера ---------------------------
  const outlet = at(OUTLET_VALVE_X, LIQUID_Y);
  // поток идёт справа налево: «после ресивера» — левее его левой стенки,
  // и между ресивером и вентилем нет других позиций
  check('запорный вентиль сразу после ресивера',
    !!outlet && outlet.x < RECEIVER_X - 90 && outlet.body.includes('L 0 -40 Z'),
    outlet ? `${outlet.tag}@${outlet.x} (роталок), ресивер ${RECEIVER_X}` : 'нет');
  const between = all.filter(u => u.x > OUTLET_VALVE_X && u.x < RECEIVER_X - 90);
  check('между ресивером и вентилем нет других позиций',
    between.length === 0, between.map(u => `${u.tag}@${u.x}`).join(', '));

  // --- 4. Размеры линий на свободных местах -------------------------------
  const lines = labels(html);
  const lineText = lines.map(l => `${l.x},${l.y}`).join(' | ');
  check('подписи размеров вынесены на свободные места',
    lines.length === 3 && lines.every(l => !all.some(u => Math.abs(u.x - l.x) < 55 && Math.abs(u.y - l.y) < 40)),
    lineText || 'подписей нет');
  check('подпись нагнетания не над приборами и не над ветками КМ',
    lines.some(l => l.x === 480 && l.y === HEADER_Y - 20),
    lineText);

  // --- 5. Зазор под обозначением регулятора масла --------------------------
  const regulators = all.filter(u => u.tag === 'OML1');
  check('зазор под обозначением регулятора увеличен на 10 % высоты шрифта',
    regulators.length === 2 && regulators.every(u => u.tagY - u.y === 42),
    regulators.map(u => `зазор ${u.tagY - u.y}`).join(', '));

  // --- 6. Прежние требования остались выполненными ------------------------
  check('фильтры по-прежнему уменьшены вдвое',
    all.filter(u => ['DF1', 'DFi1', 'SF1', 'OF1'].includes(u.tag)).every(u => u.scale === 0.5));
  check('вентиль Rotalock есть перед каждым регулятором уровня',
    [1, 2].every(i => all.some(u => u.x === COMP.firstX + (i - 1) * COMP.stepX + REGULATOR_DX && u.body.includes('L 0 -40 Z'))));
  check('испаритель и ТРВ в схеме отсутствуют',
    !html.includes('вывод к испарителю') && !html.includes('испаритель (внешний)'));
  check('три штуцера ресивера: вход, выход и предохранительный клапан',
    !!at(1150, LIQUID_Y) && !!outlet && !!safety);

  // --- 7. Свежий КП для визуального контроля ------------------------------
  const save = await fetch(`${BASE}/quotes/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: params,
    redirect: 'manual'
  });
  const savedUrl = save.headers.get('location') || '';
  console.log(`\nКП для визуального контроля: ${savedUrl || '(не сохранён)'}`);

  console.log(`\nВсего знаков: ${all.length}; обозначения: ${tags.join(' ')}`);
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
