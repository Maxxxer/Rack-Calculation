/**
 * Гидравлическая схема агрегата.
 *
 * Схема не рисуется вручную: она собирается из результата расчёта. Каждая
 * позиция спецификации (обязательная, автоматическая или отмеченная
 * пользователем) занимает своё место на контуре, и если позиции в спецификации
 * нет — её символ не выводится, а труба остаётся непрерывной. Поэтому при
 * задании опций (маслоотделитель, масляный ресивер, маслоохладитель, ORV,
 * зимний комплект, соленоид и т. д.) компоненты появляются на схеме
 * автоматически, а количество компрессоров определяет число веток.
 *
 * Модуль отдаёт только модель (геометрия, подписи, номера позиций): разметку
 * рисует views/partials/schematic.ejs. Так значения из базы (наименования и
 * артикулы) проходят через обычное экранирование EJS.
 *
 * Система координат — миллиметры схемы: ось X вправо, ось Y вниз. Символы
 * описаны в локальных координатах вокруг точки врезки в трубу (0,0) при
 * горизонтальной трубе; поле rot поворачивает символ вместе с трубой
 * (-90 — поток вверх, 90 — вниз, 180 — влево).
 */
'use strict';

// ============================ Геометрия схемы =============================

const CANVAS = { width: 1240, height: 830 };

const COMP = { firstX: 250, stepX: 120, limit: 4, centerY: 610, radius: 30 };
const HEADER_Y = 430;        // коллектор нагнетания
const RISER_X = 1180;        // подъём нагнетания к конденсатору
const LIQUID_Y = 210;        // жидкостная линия
const SUCTION_Y = 730;       // коллектор всасывания
const SUCTION_X = 100;       // вертикаль всасывания (от испарителя)
const OIL_RETURN_Y = 520;    // линия возврата масла к компрессорам
const EVAPORATOR = { cx: 180, cy: 90, w: 240, h: 110 };
const CONDENSER = { cx: 1030, cy: 90, w: 320, h: 120 };
const TXV = { x: 400 };
const BYPASS = { y: 150, fromX: 900, toX: 1020, code: 'winter_diff' };

// Позиции на коллекторе нагнетания (слева направо)
const HEADER_SLOTS = [
  { code: 'oil_separator', symbol: 'oil_separator', x: 700 },
  { code: 'oil_receiver', symbol: 'oil_receiver', x: 820 },
  { code: 'oil_cooler', symbol: 'oil_cooler', x: 820 },
  { code: 'orv_thermostat', symbol: 'three_way', x: 940 }
];

// Подъём к конденсатору: поток вверх, символы повёрнуты на -90°
const RISER_SLOTS = [
  { code: 'winter_kvr', symbol: 'kvr', y: 380, rot: -90 },
  { code: 'discharge_valve', symbol: 'ball_valve', y: 290, rot: -90 }
];

// Жидкостная линия: движение справа налево
const LIQUID_SLOTS = [
  { code: 'winter_nrv_drain', symbol: 'check_valve', x: 1120, rot: 180 },
  { code: 'liquid_receiver', symbol: 'receiver', x: 1000, rot: 0, fixed: true },
  { code: 'service_valve', symbol: 'ball_valve', x: 900, rot: 180 },
  { code: 'liquid_nrv', symbol: 'check_valve', x: 820, rot: 180 },
  { code: 'liquid_ball_valve', symbol: 'ball_valve', x: 740, rot: 180 },
  { code: 'solenoid', symbol: 'solenoid', x: 660, rot: 180 },
  { code: 'sight_glass', symbol: 'sight_glass', x: 580, rot: 0 },
  { code: 'filter_drier', symbol: 'filter', x: 490, rot: 180 }
];

// Всасывающая вертикаль: поток вниз, символы повёрнуты на 90°
const SUCTION_SLOTS = [
  { code: 'liquid_separator', symbol: 'liquid_separator', y: 250, rot: 90 },
  { code: 'suction_filter', symbol: 'filter', y: 400, rot: 90 },
  { code: 'suction_ball_valve', symbol: 'ball_valve', y: 550, rot: 90 },
  { code: 'winter_cpr', symbol: 'kvr', y: 670, rot: 90 }
];

// Навесное оборудование жидкостного ресивера
const RECEIVER_ATTACH = [
  { code: 'receiver_heater', symbol: 'heater', x: 940, y: 268, numDx: 0, numDy: 26 },
  { code: 'level_switch', symbol: 'level_switch', x: 1060, y: 272, numDx: 30, numDy: 10 }
];

/** Символы: контур рисуется в локальных координатах, mask — вырез под символ */
const line = (x1, y1, x2, y2, dash) => ({ t: 'line', x1, y1, x2, y2, dash: !!dash });
const rect = (x, y, w, h, r) => ({ t: 'rect', x, y, w, h, r: r || 0 });
const circle = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
const path = (d, dash) => ({ t: 'path', d, dash: !!dash });

const bowtie = [path('M -10 -9 L 0 0 L -10 9 Z'), path('M 10 -9 L 0 0 L 10 9 Z')];
const serpentine = (left, right, top, step) => {
  const parts = [`M ${left} ${top}`];
  let y = top;
  for (let i = 0; i < 3; i++) {
    parts.push(`H ${right}`, `V ${y + step}`, `H ${left}`, `V ${y + 2 * step}`);
    y += 2 * step;
  }
  return parts.join(' ');
};

const SYMBOLS = {
  compressor: {
    mask: { w: 78, h: 78 },
    shapes: [circle(0, 0, 30), path('M -13 -14 L 14 0 L -13 14 Z'), line(30, 0, 40, 0)]
  },
  damper: {
    mask: { w: 60, h: 30 },
    shapes: [
      rect(-26, -12, 52, 24, 10),
      path('M -20 0 q 5 -8 10 0 q 5 8 10 0 q 5 -8 10 0 q 5 8 10 0'),
      line(-26, -14, -26, 14), line(26, -14, 26, 14)
    ]
  },
  check_valve: {
    mask: { w: 44, h: 30 },
    shapes: [path('M -9 -9 L 6 0 L -9 9 Z'), line(8, -11, 8, 11)]
  },
  ball_valve: {
    mask: { w: 48, h: 34 },
    shapes: [...bowtie, line(0, -9, 0, -16), line(-8, -16, 8, -16)]
  },
  solenoid: {
    mask: { w: 48, h: 52 },
    shapes: [...bowtie, rect(-9, -28, 18, 11, 2), line(0, -17, 0, -9)]
  },
  oil_separator: {
    mask: { w: 64, h: 64 },
    shapes: [circle(0, 0, 26), path('M -16 11 q 8 -9 16 0 q 8 9 16 0'), line(0, 26, 0, 32)]
  },
  oil_receiver: {
    mask: { w: 68, h: 46 },
    shapes: [
      rect(-30, -20, 60, 40, 4), line(-20, 8, 20, 8),
      path('M -14 2 L -6 10'), path('M -6 2 L 2 10'), line(0, -20, 0, -26)
    ]
  },
  oil_cooler: {
    mask: { w: 72, h: 50 },
    shapes: [rect(-32, -22, 64, 44, 4), path('M -22 -12 L -8 12 L 8 -12 L 22 12'), line(0, -22, 0, -28)]
  },
  three_way: {
    mask: { w: 60, h: 60 },
    shapes: [
      circle(0, 0, 15), line(0, -15, 0, -26), line(-15, 0, -26, 0), line(15, 0, 26, 0),
      path('M -6 -6 L 6 0 L -6 6 Z')
    ]
  },
  kvr: {
    mask: { w: 52, h: 58 },
    shapes: [...bowtie, rect(-10, -30, 20, 11, 2), line(0, -19, 0, -10)]
  },
  receiver: {
    mask: { w: 140, h: 66 },
    shapes: [
      rect(-60, -24, 120, 48, 10), line(-46, 8, 46, 8),
      path('M -46 8 L -26 8 L -46 -12 Z')
    ]
  },
  filter: {
    mask: { w: 76, h: 44 },
    shapes: [
      rect(-32, -17, 64, 34, 3),
      path('M -22 -11 L 0 11'), path('M 0 -11 L 22 11'), path('M 22 -11 L 22 11')
    ]
  },
  insert: {
    mask: { w: 56, h: 30 },
    shapes: [rect(-22, -11, 44, 22, 2), path('M -12 -11 L 12 11', true), path('M -12 11 L 12 -11', true)]
  },
  sight_glass: {
    mask: { w: 44, h: 44 },
    shapes: [circle(0, 0, 13), circle(0, 0, 3), line(-20, 0, -13, 0), line(13, 0, 20, 0)]
  },
  txv: {
    mask: { w: 60, h: 60 },
    shapes: [...bowtie, line(0, -9, -16, -24), rect(-22, -31, 12, 9, 2), line(-16, -24, -16, -31)]
  },
  evaporator: {
    mask: { w: EVAPORATOR.w + 16, h: EVAPORATOR.h + 16 },
    shapes: [
      rect(-EVAPORATOR.w / 2, -EVAPORATOR.h / 2, EVAPORATOR.w, EVAPORATOR.h, 6),
      path(serpentine(-92, 92, -30, 15)),
      circle(62, -26, 15), path('M 62 -26 L 62 -41'), path('M 62 -26 L 74 -33'), path('M 62 -26 L 50 -33')
    ]
  },
  condenser: {
    mask: { w: CONDENSER.w + 16, h: CONDENSER.h + 16 },
    shapes: [
      rect(-CONDENSER.w / 2, -CONDENSER.h / 2, CONDENSER.w, CONDENSER.h, 6),
      path(serpentine(-124, 124, -32, 16)),
      circle(-86, -28, 15), path('M -86 -28 L -86 -43'), path('M -86 -28 L -74 -35'), path('M -86 -28 L -98 -35'),
      circle(86, -28, 15), path('M 86 -28 L 86 -43'), path('M 86 -28 L 98 -35'), path('M 86 -28 L 74 -35')
    ]
  },
  liquid_separator: {
    mask: { w: 64, h: 64 },
    shapes: [circle(0, 0, 24), path('M -14 12 q 7 -16 14 0'), path('M -6 -6 L 0 -17 L 6 -6')]
  },
  level_switch: {
    mask: { w: 44, h: 66 },
    shapes: [rect(-14, -22, 28, 20, 2), line(0, -2, 0, 18), circle(0, 24, 6), line(-6, 24, 6, 24)]
  },
  heater: {
    mask: { w: 52, h: 28 },
    shapes: [rect(-20, -9, 40, 18, 2), path('M -12 0 l 4 -6 l 4 12 l 4 -12 l 4 12 l 4 -6')]
  },
  diff_valve: {
    mask: { w: 60, h: 60 },
    shapes: [
      path('M -9 -9 L 6 0 L -9 9 Z'), line(8, -11, 8, 11),
      path('M -16 -14 Q 0 -32 16 -14', true)
    ]
  }
};

/** Обозначения внешнего контура — рисуются всегда, это не позиции агрегата */
const EXTERNAL_BLOCKS = [
  { key: 'condenser', symbol: 'condenser', x: CONDENSER.cx, y: CONDENSER.cy, label: 'Конденсатор (внешний)' },
  { key: 'evaporator', symbol: 'evaporator', x: EVAPORATOR.cx, y: EVAPORATOR.cy, label: 'Испаритель (внешний)' },
  { key: 'txv', symbol: 'txv', x: TXV.x, y: LIQUID_Y, rot: 180, label: 'ТРВ' }
];

/** Опции, которые не относятся к холодильному контуру: показываются списком */
const NON_HYDRAULIC = new Set([
  'housing', 'noise', 'inverter', 'unloader', 'capacity_ctrl'
]);

/** Подписи линий контура (размеры подставляются в шаблоне через inch) */
const LINE_LABELS = [
  { kind: 'discharge', x: 660, y: HEADER_Y - 74, caption: 'Нагнетание' },
  { kind: 'liquid', x: 700, y: LIQUID_Y - 30, caption: 'Жидкость' },
  { kind: 'suction', x: SUCTION_X + 12, y: 620, caption: 'Всасывание', rot: -90 }
];

/** Стрелки направления потока */
function buildArrows(compressorXs) {
  const arrows = [
    { x: 640, y: HEADER_Y, rot: 0 },
    { x: RISER_X, y: 200, rot: -90 },
    { x: 700, y: LIQUID_Y, rot: 180 },
    { x: SUCTION_X, y: 620, rot: 90 },
    { x: 400, y: SUCTION_Y, rot: 0 }
  ];
  compressorXs.forEach(x => arrows.push({ x, y: 500, rot: -90 }));
  return arrows;
}

/** Трубы контура */
function buildWires(compressorXs) {
  const lastX = compressorXs[compressorXs.length - 1];
  const wires = [
    // контур нагнетания
    { kind: 'discharge', d: `M ${lastX} ${HEADER_Y} H ${RISER_X} V ${CONDENSER.cy + CONDENSER.h / 2}` },
    // конденсатор — ресивер: переохлаждённая жидкость идёт по жидкостной линии
    { kind: 'liquid', d: `M ${RISER_X} ${LIQUID_Y} H ${TXV.x}` },
    // ресивер соединён с конденсатором вертикальным участком
    { kind: 'liquid', d: `M ${RISER_X} ${LIQUID_Y} V ${LIQUID_Y}` },
    // ТРВ — испаритель
    { kind: 'liquid', d: `M ${TXV.x} ${LIQUID_Y} H ${EVAPORATOR.cx + EVAPORATOR.w / 2}` },
    // всасывание: испаритель → вертикаль → коллектор
    { kind: 'suction', d: `M ${SUCTION_X} ${EVAPORATOR.cy + EVAPORATOR.h / 2} V ${SUCTION_Y} H ${lastX}` },
    // линия возврата масла к компрессорам
    { kind: 'oil', d: `M ${compressorXs[0]} ${OIL_RETURN_Y} H 700` },
    { kind: 'oil', d: `M 700 ${HEADER_Y} V ${OIL_RETURN_Y}` }
  ];

  compressorXs.forEach(x => {
    wires.push({ kind: 'suction', d: `M ${x} ${SUCTION_Y} V ${COMP.centerY + COMP.radius}` });
    wires.push({ kind: 'discharge', d: `M ${x} ${HEADER_Y} V ${COMP.centerY - COMP.radius}` });
  });

  wires.push({ kind: 'diff', d: `M ${BYPASS.fromX} ${LIQUID_Y} V ${BYPASS.y} H ${BYPASS.toX} V ${LIQUID_Y}` });
  return wires;
}
// ========================= Сборка модели схемы ============================

/**
 * Модель гидравлической схемы по результату расчёта.
 * @param {Object} result — результат services/calc.js
 * @returns {Object|null} геометрия, символы, легенда и подписи линий
 */
function buildSchematic(result) {
  if (!result || !Array.isArray(result.bom) || !result.bom.length) return null;

  // Позиции спецификации по коду опции: опция может давать несколько позиций
  // (виброгасители — отдельно на линии всасывания и на линии нагнетания).
  const byCode = new Map();
  result.bom.forEach(item => {
    const list = byCode.get(item.option_code);
    if (list) list.push(item);
    else byCode.set(item.option_code, [item]);
  });

  /** Первая позиция по коду — для опций с единственной позицией */
  const rowOf = code => (byCode.get(code) || [])[0] || null;

  // По одному обозначению на каждую машину: позиция «2 шт» рисуется двумя
  // компрессорами со своими ветками всасывания и нагнетания.
  const compressorRows = byCode.get('compressor') || [];
  const machines = [];
  (result.selection.items || []).forEach(sel => {
    const row = compressorRows.find(b => b.article === sel.model) || null;
    for (let i = 0; i < Math.max(1, sel.qty | 0); i++) machines.push({ sel, row });
  });

  // Виброгасители — одна опция, но позиции линий самостоятельные: у каждой
  // свой номер. Линию определяем по плану подбора (result.vibration), поэтому
  // схема верна и для спецификаций, где виброгасители были двумя опциями.
  const VIBRATION_CODES = ['vibration', 'vibration_suction', 'vibration_discharge'];
  const vibrationRows = VIBRATION_CODES.flatMap(code => byCode.get(code) || []);
  const vibrationRow = line => {
    const plan = result.vibration && result.vibration[line];
    const article = plan && plan.bomItems.length ? plan.bomItems[0].article : null;
    if (article) {
      const byArticle = vibrationRows.find(row => row.article === article);
      if (byArticle) return byArticle;
    }
    const hint = line === 'suction' ? 'всасыван' : 'нагнетания';
    return vibrationRows.find(row => String(row.name).toLowerCase().includes(hint)) || null;
  };
  const suctionDamperRow = vibrationRow('suction');
  const dischargeDamperRow = vibrationRow('discharge');
  const shown = machines.slice(0, COMP.limit);
  const compressorXs = shown.map((_, i) => COMP.firstX + i * COMP.stepX);

  const blocks = [];
  const legend = [];
  const notes = [];
  const numbers = new Map();
  let num = 0;

  /**
   * Номер позиции спецификации: одинаковые позиции (та же опция, артикул и
   * наименование) получают один номер — например, виброгасители всех
   * компрессоров одной линии, а разные линии — свои номера.
   */
  function numberFor(item) {
    const key = `${item.option_code}|${item.article}|${item.name}`;
    const known = numbers.get(key);
    if (known) return known;
    num += 1;
    numbers.set(key, num);
    legend.push({
      num,
      name: item.name,
      article: item.article || '',
      qty: item.qty || 1,
      section: item.section || ''
    });
    return num;
  }

  function place(spec) {
    const shape = SYMBOLS[spec.symbol];
    if (!shape) return null;
    const rot = spec.rot || 0;
    const block = {
      symbol: spec.symbol,
      x: spec.x,
      y: spec.y,
      rot,
      mask: shape.mask,
      maskless: !!spec.maskless,
      shapes: shape.shapes,
      external: !!spec.external,
      label: spec.label || null,
      labelX: spec.labelX != null ? spec.labelX : spec.x,
      labelY: spec.labelY != null ? spec.labelY : spec.y + shape.mask.h / 2 + 22,
      num: spec.num || 0,
      numDx: spec.numDx != null ? spec.numDx : (rot === 0 ? 0 : shape.mask.w / 2 + 16),
      numDy: spec.numDy != null ? spec.numDy : (rot === 0 ? -(shape.mask.h / 2 + 15) : 0)
    };
    blocks.push(block);
    return block;
  }

  /** Позиция спецификации на схеме: рисуется, только если она входит в BOM */
  function placeRow(item, geometry) {
    if (!item) return;
    const block = place({ ...geometry });
    if (block) block.num = numberFor(item);
  }

  /** То же по коду опции (первая позиция этого кода) */
  function placeOption(code, geometry) {
    placeRow(rowOf(code), geometry);
  }

  // ---------- Компрессоры и их ветки ----------
  shown.forEach((machine, i) => {
    const x = compressorXs[i];
    if (machine.row) {
      const block = place({ symbol: 'compressor', x, y: COMP.centerY, numDx: 0, numDy: COMP.radius + 34 });
      if (block) block.num = numberFor(machine.row);
    }

    // всасывающая ветка: виброгаситель
    placeRow(suctionDamperRow, { symbol: 'damper', x, y: SUCTION_Y - 55, rot: -90 });
    // нагнетательная ветка: виброгаситель и обратный клапан
    placeRow(dischargeDamperRow, { symbol: 'damper', x, y: 545, rot: -90 });
    placeOption('check_valves', { symbol: 'check_valve', x, y: 490, rot: -90 });
  });

  if (machines.length > shown.length) {
    notes.push(`На схеме показаны ${shown.length} компрессора из ${machines.length}.`);
  }

  // ---------- Коллектор нагнетания ----------
  HEADER_SLOTS.forEach(slot => {
    placeOption(slot.code, { symbol: slot.symbol, x: slot.x, y: HEADER_Y });
  });

  // ---------- Линия возврата масла ----------
  placeOption('erum', { symbol: 'three_way', x: 700, y: 480, rot: 90, numDx: 34, numDy: 0 });

  // ---------- Подъём к конденсатору ----------
  RISER_SLOTS.forEach(slot => {
    placeOption(slot.code, { symbol: slot.symbol, x: RISER_X, y: slot.y, rot: slot.rot });
  });

  // ---------- Жидкостная линия ----------
  LIQUID_SLOTS.forEach(slot => {
    placeOption(slot.code, { symbol: slot.symbol, x: slot.x, y: LIQUID_Y, rot: slot.rot });
  });

  // Вставка осушительная рисуется внутри фильтра-осушителя, не закрывая его
  if (byCode.has('drier_insert') && byCode.has('filter_drier')) {
    const filter = LIQUID_SLOTS.find(s => s.code === 'filter_drier');
    placeRow(rowOf('drier_insert'), {
      symbol: 'insert', x: filter.x, y: LIQUID_Y, rot: 180, maskless: true,
      numDx: -38, numDy: 24
    });
  }

  // ---------- Навесное оборудование ресивера ----------
  RECEIVER_ATTACH.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: slot.x, y: slot.y, numDx: slot.numDx, numDy: slot.numDy
    });
  });

  // ---------- Обратный дифференциальный клапан ----------
  placeOption(BYPASS.code, { symbol: 'diff_valve', x: 960, y: BYPASS.y });

  // ---------- Всасывающая линия ----------
  SUCTION_SLOTS.forEach(slot => {
    placeOption(slot.code, { symbol: slot.symbol, x: SUCTION_X, y: slot.y, rot: slot.rot });
  });

  // ---------- Внешний контур ----------
  EXTERNAL_BLOCKS.forEach(spec => {
    place({
      symbol: spec.symbol, x: spec.x, y: spec.y, rot: spec.rot || 0,
      external: true, label: spec.label,
      labelX: spec.x,
      labelY: spec.key === 'txv' ? spec.y + 46 : spec.y + CONDENSER.h / 2 + 24
    });
  });

  // ---------- Позиции вне холодильного контура ----------
  const otherItems = result.bom
    .filter(item => NON_HYDRAULIC.has(item.option_code) || String(item.option_code).startsWith('FIX-'))
    .map(item => ({ name: item.name, qty: item.qty }));

  // ---------- Размеры трубопроводов для подписей ----------
  const common = (result.piping && result.piping.common) || {};
  const pipes = {
    discharge: common.discharge ? common.discharge.recommended.size_in : null,
    liquid: common.liquid ? common.liquid.recommended.size_in : null,
    suction: common.suction ? common.suction.recommended.size_in : null
  };

  return {
    width: CANVAS.width,
    height: CANVAS.height,
    wires: buildWires(compressorXs),
    arrows: buildArrows(compressorXs),
    blocks,
    legend,
    otherItems,
    lineLabels: LINE_LABELS,
    pipes,
    notes
  };
}

module.exports = { buildSchematic };
