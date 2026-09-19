/**
 * Гидравлическая схема агрегата.
 *
 * Схема повторяет принцип построения производственной гидравлической схемы
 * (см. ЗП24.2102.000.00.00.Г): контур рисуется ортогональными линиями, каждая
 * позиция получает обозначение (OS1, LR1, DF1, SG1, V1, CV1, PSH1, GP1 …),
 * приборы выводятся отдельными знаками на линиях, а размеры линий подписаны
 * в дюймовой «трубной» записи.
 *
 * Состав схемы не рисуется вручную: он собирается из спецификации расчёта,
 * поэтому на контуре оказываются ровно те позиции, которые входят в агрегат
 * (обязательные, автоматические и отмеченные пользователем).
 *
 * Модуль отдаёт только модель (геометрия, символы, обозначения): разметку
 * рисует views/partials/schematic.ejs, поэтому значения из базы проходят
 * обычное экранирование EJS.
 *
 * Система координат — миллиметры схемы: ось X вправо, ось Y вниз. Символы
 * описаны в локальных координатах вокруг точки врезки в трубу (0,0) при
 * горизонтальной трубе; поле rot поворачивает символ вместе с трубой
 * (-90 — поток вверх, 90 — вниз, 180 — влево).
 */
'use strict';

// ============================ Геометрия схемы =============================

const CANVAS = { width: 1420, height: 960 };

// Компрессорный отсек
const COMP = { firstX: 320, stepX: 170, limit: 4, centerY: 800, radius: 34 };
const HEADER_Y = 640;        // коллектор нагнетания
const SUCTION_Y = 890;       // коллектор всасывания
const RISER_X = 1200;        // подъём нагнетания к конденсатору
const LIQUID_Y = 430;        // жидкостная линия
const SUCTION_X = 120;       // вертикаль всасывания (от испарителя)
const OIL_RETURN_Y = 730;    // линия возврата масла к компрессорам
const CONDENSER = { cx: 1120, cy: 190, w: 340, h: 130 };
const EVAPORATOR = { cx: 200, cy: 175, w: 250, h: 120 };
const TXV = { x: 400 };                    // ТРВ на жидкостной линии
const BYPASS = { x: 1360, y: 320, code: 'winter_diff' };
const SAFETY = { x: 1300, y: 404, code: 'safety_valve' };

// ===================== Обозначения позиций (теги) ==========================
// Буквенный код по виду оборудования — как в гидравлической схеме агрегата.
// Номер добавляется по порядку обхода контура.
const TAG_PREFIX = {
  compressor: 'COM',
  oil_separator: 'OS',
  oil_receiver: 'OR',
  oil_cooler: 'OC',
  orv_thermostat: 'ORV',
  oil_filter: 'OF',
  erum: 'ER',
  check_valves: 'CV',
  vibration: 'VD',
  liquid_receiver: 'LR',
  liquid_nrv: 'CV',
  filter_drier: 'DF',
  drier_insert: 'DFi',
  sight_glass: 'SG',
  solenoid: 'SOV',
  liquid_ball_valve: 'V',
  service_valve: 'V',
  discharge_valve: 'V',
  suction_ball_valve: 'V',
  safety_valve: 'SV',
  liquid_separator: 'ACC',
  suction_filter: 'SF',
  winter_kvr: 'KVR',
  winter_cpr: 'CPR',
  winter_nrv_drain: 'NRV',
  winter_diff: 'DIFF',
  receiver_heater: 'E',
  level_switch: 'LS',
  pressure_switch_hp: 'PSH',
  pressure_switch_lp: 'PSL',
  pressure_transmitter: 'PB',
  gauge_hp: 'GP',
  gauge_lp: 'GP',
  discharge_thermostat: 'T'
};

/** Опции, не относящиеся к холодильному контуру: показываются списком */
const NON_HYDRAULIC = new Set([
  'housing', 'noise', 'inverter', 'unloader', 'capacity_ctrl'
]);

// ============================== Примитивы =================================
const line = (x1, y1, x2, y2, dash) => ({ t: 'line', x1, y1, x2, y2, dash: !!dash });
const rect = (x, y, w, h, r) => ({ t: 'rect', x, y, w, h, r: r || 0 });
const circle = (cx, cy, r) => ({ t: 'circle', cx, cy, r });
const path = (d, dash) => ({ t: 'path', d, dash: !!dash });

/** Вырез под символ: по центру врезки или явным прямоугольником */
const maskC = (w, h) => ({ x: -w / 2, y: -h / 2, w, h });
const maskRect = (x, y, w, h) => ({ x, y, w, h });

/** Символ запорного вентиля: два треугольника + шар */
const bowtie = (half = 13, height = 12) => [
  path(`M ${-half} ${-height} L 0 0 L ${-half} ${height} Z`),
  path(`M ${half} ${-height} L 0 0 L ${half} ${height} Z`)
];

/** Змеевик теплообменника */
const serpentine = (left, right, top, step, turns) => {
  const parts = [`M ${left} ${top}`];
  let y = top;
  for (let i = 0; i < turns; i++) {
    parts.push(`H ${right}`, `V ${y + step}`, `H ${left}`, `V ${y + 2 * step}`);
    y += 2 * step;
  }
  return parts.join(' ');
};

/**
 * Знак прибора: линия связи с трубой и круг с обозначением внутри.
 * Применяется для реле давления, манометров, датчика, термостата, реле уровня.
 */
const instrument = () => ({
  mask: maskRect(-27, -76, 54, 80),
  tagInside: true,
  shapes: [line(0, 0, 0, -34), circle(0, -55, 21)]
});
// ============================ Библиотека знаков ============================
// Знаки выполнены по практике холодильных гидравлических схем: сосуды —
// цилиндры с обозначением внутри, вентили — два треугольника с ручкой,
// обратный клапан — треугольник с седлом, фильтры — корпус с перегородками,
// приборы — круг с линией связи с трубой.

const SYMBOLS = {
  /** Компрессор (COM) */
  compressor: {
    mask: maskC(92, 92),
    tagDx: -54, tagDy: 6, tagAnchor: 'end',
    shapes: [circle(0, 0, 32), path('M -14 -16 L 16 0 L -14 16 Z'), line(32, 0, 46, 0)]
  },

  /** Виброгаситель (VD) — гибкая вставка между фланцами */
  damper: {
    mask: maskC(84, 38),
    tagDx: 0, tagDy: -32,
    shapes: [
      line(-34, -17, -34, 17), line(34, -17, 34, 17),
      path('M -34 0 C -22 -15 -10 15 0 0 C 10 -15 22 15 34 0')
    ]
  },

  /** Обратный клапан (CV) — тарелка и седло */
  check_valve: {
    mask: maskC(62, 38),
    tagDx: 0, tagDy: -32,
    shapes: [
      line(-28, -16, -28, 16),
      path('M -14 -13 L 12 0 L -14 13 Z'),
      line(12, -16, 12, 16)
    ]
  },

  /** Шаровый вентиль (V) — два треугольника, шар и ручка */
  ball_valve: {
    mask: maskC(66, 48),
    tagDx: 0, tagDy: -36,
    shapes: [...bowtie(15, 13), circle(0, 0, 5), line(0, -13, 0, -27), line(-10, -27, 10, -27)]
  },

  /** Вентиль Rotalock (V) — треугольники с маховиком */
  rotalock_valve: {
    mask: maskC(66, 56),
    tagDx: 0, tagDy: -44,
    shapes: [...bowtie(15, 13), line(0, -13, 0, -26), path('M -11 -26 L 11 -26 L 0 -40 Z')]
  },

  /** Соленоидный вентиль (SOV) — вентиль с катушкой */
  solenoid: {
    mask: maskC(66, 66),
    tagDx: 0, tagDy: -50,
    shapes: [
      ...bowtie(15, 13), line(0, -13, 0, -22),
      rect(-12, -36, 24, 14, 2), line(-17, -43, 17, -43)
    ]
  },

  /** Предохранительный клапан (SV) — тарелка, пружина, выброс */
  safety_valve: {
    mask: maskC(60, 84),
    tagDx: 30, tagDy: 4, tagAnchor: 'start',
    shapes: [
      line(0, 0, 0, -22),
      path('M -13 -22 L 13 -22 L 0 -36 Z'),
      path('M -9 -38 L 9 -42 L -9 -46 L 9 -50 L -9 -54 L 9 -58'),
      path('M -9 -60 L 9 -60'),
      line(0, -60, 0, -72),
      path('M -9 -72 L 9 -72')
    ]
  },

  /** Смотровой глазок (SG) — круг с крестом */
  sight_glass: {
    mask: maskC(58, 58),
    tagDx: 0, tagDy: -38,
    shapes: [
      circle(0, 0, 16), line(-16, 0, 16, 0), line(0, -16, 0, 16),
      line(-26, 0, -16, 0), line(16, 0, 26, 0)
    ]
  },

  /** Фильтр-осушитель (DF) — корпус с перегородками */
  filter: {
    mask: maskC(96, 54),
    tagDx: 0, tagDy: -38,
    shapes: [
      line(-36, -19, -36, 19), line(36, -19, 36, 19),
      rect(-32, -19, 64, 38),
      path('M -20 -19 L 4 19'), path('M 8 -19 L 32 19')
    ]
  },

  /** Вставка осушительная (DFi) — рисуется внутри фильтра, не закрывая его */
  insert: {
    maskless: true,
    mask: maskC(44, 30),
    shapes: [
      rect(-20, -13, 40, 26, 2),
      path('M -12 -13 L 10 13', true), path('M -12 13 L 10 -13', true)
    ]
  },

  /** Масляный фильтр (OF) */
  oil_filter: {
    mask: maskC(72, 46),
    tagDx: 0, tagDy: -32,
    shapes: [
      line(-27, -17, -27, 17), line(27, -17, 27, 17),
      rect(-23, -17, 46, 34),
      path('M -14 -17 L 4 17'), path('M 6 -17 L 22 17')
    ]
  },

  /** Линейный ресивер (LR) — горизонтальный цилиндр с уровнем */
  receiver: {
    mask: maskC(194, 94),
    tagInside: true,
    tagDx: 0, tagDy: 6,
    shapes: [
      rect(-92, -38, 184, 76, 18),
      line(-76, 10, 76, 10),
      path('M -76 10 L -46 10 L -76 -20 Z')
    ]
  },

  /** Маслоотделитель (OS) — вертикальный цилиндр */
  oil_separator: {
    mask: maskC(80, 104),
    tagInside: true,
    tagDx: 0, tagDy: 6,
    shapes: [rect(-35, -48, 70, 96, 16), path('M -16 28 q 8 -10 16 0 q 8 10 16 0'), line(0, -48, 0, -60)]
  },

  /** Масляный ресивер (OR) — горизонтальный цилиндр */
  oil_receiver: {
    mask: maskC(112, 64),
    tagDx: 0, tagDy: 26,
    shapes: [rect(-51, -27, 102, 54, 14), line(-35, 8, 35, 8)]
  },

  /** Маслоохладитель (OC) — пластинчатый теплообменник */
  oil_cooler: {
    mask: maskC(102, 72),
    tagDx: 0, tagDy: -44,
    shapes: [rect(-45, -31, 90, 62, 4), path('M -28 -16 L -10 18 L 10 -18 L 28 14')]
  },

  /** Трёхходовой термостат ORV */
  three_way: {
    mask: maskC(70, 70),
    tagDx: 0, tagDy: -44,
    shapes: [
      circle(0, 0, 18),
      line(0, -18, 0, -32), line(-18, 0, -32, 0), line(18, 0, 32, 0),
      path('M -7 -7 L 7 0 L -7 7 Z')
    ]
  },

  /** Регулятор давления (KVR, CPR) */
  kvr: {
    mask: maskC(66, 72),
    tagDx: 0, tagDy: -54,
    shapes: [
      ...bowtie(15, 13), line(0, -13, 0, -24),
      rect(-13, -38, 26, 12, 2), path('M -8 -44 L 8 -44'), path('M -8 -48 L 8 -48')
    ]
  },

  /** Обратный дифференциальный клапан (DIFF) */
  diff_valve: {
    mask: maskC(64, 62),
    tagDx: 0, tagDy: -48,
    shapes: [...bowtie(14, 12), line(0, -12, 0, -22), path('M -10 -22 Q 0 -42 10 -22', true)]
  },

  /** ТЭН (E) */
  heater: {
    mask: maskRect(-37, -86, 74, 88),
    tagDx: 34, tagDy: 0, tagAnchor: 'start',
    shapes: [
      line(0, 0, 0, -30),
      rect(-26, -56, 52, 26, 3),
      path('M -16 -43 l 6 -9 l 6 18 l 6 -18 l 6 18 l 6 -9')
    ]
  },

  /** Прибор: реле давления, манометр, датчик, термостат, реле уровня */
  instrument: instrument(),

  /** ТРВ (EX) — вентиль с термоголовкой */
  txv: {
    mask: maskC(70, 92),
    tagDx: 0, tagDy: 32,
    shapes: [
      ...bowtie(15, 13), line(0, -13, 0, -28),
      rect(-17, -44, 34, 16, 3), path('M -9 -44 L 0 -58 L 9 -44 Z')
    ]
  },

  /** Испаритель (EV) — внешний теплообменник */
  evaporator: {
    mask: maskC(EVAPORATOR.w + 20, EVAPORATOR.h + 20),
    tagInside: true,
    tagDx: 0, tagDy: 8,
    shapes: [
      rect(-EVAPORATOR.w / 2, -EVAPORATOR.h / 2, EVAPORATOR.w, EVAPORATOR.h, 8),
      path(serpentine(-96, 96, -32, 16, 3))
    ]
  },

  /** Конденсатор (K) — внешний теплообменник с вентиляторами */
  condenser: {
    mask: maskC(CONDENSER.w + 20, CONDENSER.h + 20),
    tagInside: true,
    tagDx: 0, tagDy: 8,
    shapes: [
      rect(-CONDENSER.w / 2, -CONDENSER.h / 2, CONDENSER.w, CONDENSER.h, 8),
      path(serpentine(-130, 130, -34, 17, 3)),
      circle(-92, -30, 17), path('M -92 -47 L -92 -55 M -92 -30 L -76 -40 M -92 -30 L -108 -40'),
      circle(92, -30, 17), path('M 92 -47 L 92 -55 M 92 -30 L 108 -40 M 92 -30 L 76 -40')
    ]
  }
};
// ===================== Позиции на контуре (по потоку) ======================
// Порядок перечисления задаёт нумерацию обозначений: схема обходится от
// компрессоров по нагнетанию, через конденсатор и жидкостную линию, к
// испарителю и обратно по всасыванию.

// Коллектор нагнетания: маслоотделитель и масляная линия
const HEADER_SLOTS = [
  { code: 'oil_separator', symbol: 'oil_separator', x: 700 },
  { code: 'oil_receiver', symbol: 'oil_receiver', x: 860 },
  { code: 'oil_cooler', symbol: 'oil_cooler', x: 860 },
  { code: 'orv_thermostat', symbol: 'three_way', x: 960 }
];

// Линия возврата масла (от маслоотделителя к компрессорам)
const OIL_SLOTS = [
  { code: 'oil_filter', symbol: 'oil_filter', x: 560, y: OIL_RETURN_Y, tagDx: 0, tagDy: -32 },
  { code: 'erum', symbol: 'instrument', x: 430, y: OIL_RETURN_Y, rot: 0 }
];

// Подъём нагнетания к конденсатору (поток вверх)
const RISER_SLOTS = [
  { code: 'winter_kvr', symbol: 'kvr', y: 540, rot: -90, tagDx: 36, tagDy: 4, tagAnchor: 'start' },
  { code: 'discharge_valve', symbol: 'rotalock_valve', y: 300, rot: -90, tagDx: 36, tagDy: 4, tagAnchor: 'start' }
];

// Жидкостная линия (поток справа налево: ресивер, фильтр, глазок, вентили)
const LIQUID_SLOTS = [
  { code: 'winter_nrv_drain', symbol: 'check_valve', x: 1226, rot: 180 },
  { code: 'liquid_receiver', symbol: 'receiver', x: 1090, rot: 0 },
  { code: 'service_valve', symbol: 'rotalock_valve', x: 950, rot: 180 },
  { code: 'liquid_nrv', symbol: 'check_valve', x: 860, rot: 180 },
  { code: 'filter_drier', symbol: 'filter', x: 770, rot: 180 },
  { code: 'drier_insert', symbol: 'insert', x: 770, rot: 180, maskless: true, tagDx: -44, tagDy: 30 },
  { code: 'sight_glass', symbol: 'sight_glass', x: 680, rot: 0 },
  { code: 'solenoid', symbol: 'solenoid', x: 590, rot: 180 },
  { code: 'liquid_ball_valve', symbol: 'ball_valve', x: 500, rot: 180 }
];

// Всасывающая линия (поток вниз: отделитель жидкости, фильтр, вентиль)
const SUCTION_SLOTS = [
  { code: 'liquid_separator', symbol: 'oil_separator', y: 300, rot: 90, tagDx: 0, tagDy: -66 },
  { code: 'suction_filter', symbol: 'filter', y: 430, rot: 90, tagDx: 60, tagDy: 8, tagAnchor: 'start' },
  { code: 'suction_ball_valve', symbol: 'ball_valve', y: 560, rot: 90, tagDx: 34, tagDy: 8, tagAnchor: 'start' },
  { code: 'winter_cpr', symbol: 'kvr', y: 800, rot: 90, tagDx: 34, tagDy: 8, tagAnchor: 'start' }
];

// Приборы на всасывании (низкое давление) — слева направо от вертикали
const SUCTION_INSTRUMENTS = [
  { code: 'gauge_lp', x: SUCTION_X, y: 640, rot: 90 },
  { code: 'pressure_switch_lp', x: SUCTION_X, y: 740, rot: 90 },
  { code: 'pressure_transmitter', x: SUCTION_X, y: 830, rot: 90 }
];

// Приборы на нагнетании (высокое давление) — над коллектором
const HEADER_INSTRUMENTS = [
  { code: 'discharge_thermostat', x: 820, y: HEADER_Y, rot: 0 },
  { code: 'gauge_hp', x: 900, y: HEADER_Y, rot: 0 },
  { code: 'pressure_switch_hp', x: 980, y: HEADER_Y, rot: 0 }
];

// Навесное оборудование жидкостного ресивера (ТЭН и реле уровня)
const RECEIVER_ATTACH = [
  { code: 'receiver_heater', symbol: 'heater', x: 1030, y: 468, rot: 180, tagDx: 36, tagDy: 4, tagAnchor: 'start' },
  { code: 'level_switch', symbol: 'instrument', x: 1180, y: 468, rot: 180 }
];

/** Подписи линий контура: размер подставляется в шаблоне через inch() */
const LINE_LABELS = [
  { kind: 'discharge', x: 900, y: HEADER_Y + 26, caption: 'Нагнетание' },
  { kind: 'liquid', x: 1150, y: LIQUID_Y - 60, caption: 'Жидкость' },
  { kind: 'suction', x: SUCTION_X + 16, y: 500, caption: 'Всасывание', rot: -90 }
];

// ============================ Трубы контура ===============================

/** Стрелки направления потока */
function buildArrows(compressorXs) {
  const lastX = compressorXs[compressorXs.length - 1];
  const arrows = [
    { x: lastX + 50, y: HEADER_Y, rot: 0 },
    { x: RISER_X, y: 420, rot: -90 },
    { x: 1330, y: LIQUID_Y, rot: 180 },
    { x: 620, y: LIQUID_Y, rot: 180 },
    { x: SUCTION_X, y: 500, rot: 90 },
    { x: 420, y: SUCTION_Y, rot: 0 },
    { x: BYPASS.x, y: 360, rot: -90 },
    { x: 320, y: OIL_RETURN_Y, rot: 180 }
  ];
  compressorXs.forEach(x => {
    arrows.push({ x, y: 700, rot: -90 });
    arrows.push({ x, y: 862, rot: -90 });
    arrows.push({ x: x - 26, y: 760, rot: 90 });
  });
  return arrows;
}

/**
 * Трубы контура.
 * Холодильный контур: компрессоры → коллектор нагнетания → конденсатор →
 * жидкостная линия (ресивер, фильтр, вентили) → ТРВ → испаритель →
 * всасывающая линия → компрессоры.
 */
function buildWires(compressorXs) {
  const lastX = compressorXs[compressorXs.length - 1];
  const firstX = compressorXs[0];
  const wires = [
    // контур нагнетания: коллектор и подъём к конденсатору
    { kind: 'discharge', d: `M ${lastX} ${HEADER_Y} H ${RISER_X} V ${CONDENSER.cy + CONDENSER.h / 2}` },
    // конденсатор — жидкостная линия: выход справа и вниз
    { kind: 'liquid', d: `M ${CONDENSER.cx + CONDENSER.w / 2} ${CONDENSER.cy} H 1390 V ${LIQUID_Y} H ${TXV.x}` },
    // ТРВ — испаритель
    { kind: 'liquid', d: `M ${TXV.x} ${LIQUID_Y} H ${EVAPORATOR.cx + EVAPORATOR.w / 2} V ${EVAPORATOR.cy + EVAPORATOR.h / 2}` },
    // всасывание: испаритель → вертикаль → коллектор
    { kind: 'suction', d: `M ${SUCTION_X} ${EVAPORATOR.cy + EVAPORATOR.h / 2} V ${SUCTION_Y} H ${lastX}` },
    // возврат масла от маслоотделителя к компрессорам
    { kind: 'oil', d: `M 700 ${HEADER_Y} V ${OIL_RETURN_Y} H ${firstX - 26}` },
    // врезка предохранительного клапана в жидкостную линию
    { kind: 'branch', d: `M ${SAFETY.x} ${LIQUID_Y} V 404` },
    // перепуск дифференциального клапана с нагнетания в жидкостную линию
    { kind: 'diff', d: `M ${BYPASS.x} ${LIQUID_Y} V ${BYPASS.y} H ${RISER_X}` }
  ];

  compressorXs.forEach(x => {
    wires.push({ kind: 'suction', d: `M ${x} ${SUCTION_Y} V ${COMP.centerY + COMP.radius}` });
    wires.push({ kind: 'discharge', d: `M ${x} ${HEADER_Y} V ${COMP.centerY - COMP.radius}` });
    wires.push({ kind: 'oil', d: `M ${x - 26} ${OIL_RETURN_Y} V ${COMP.centerY - 10}` });
  });

  return wires;
}
// ========================= Сборка модели схемы ============================

/**
 * Модель гидравлической схемы по результату расчёта.
 * @param {Object} result — результат services/calc.js
 * @returns {Object|null} геометрия, знаки, обозначения позиций и подписи линий
 */
function buildSchematic(result) {
  if (!result || !Array.isArray(result.bom) || !result.bom.length) return null;

  // Позиции спецификации по коду опции: одна опция может давать несколько
  // позиций (виброгасители — на линии всасывания и на линии нагнетания).
  const byCode = new Map();
  result.bom.forEach(item => {
    const list = byCode.get(item.option_code);
    if (list) list.push(item);
    else byCode.set(item.option_code, [item]);
  });
  const rowOf = code => (byCode.get(code) || [])[0] || null;

  // По одному знаку на каждую машину: позиция «2 шт» рисуется двумя
  // компрессорами со своими ветками всасывания и нагнетания.
  const compressorRows = byCode.get('compressor') || [];
  const machines = [];
  (result.selection.items || []).forEach(sel => {
    const row = compressorRows.find(b => b.article === sel.model) || null;
    for (let i = 0; i < Math.max(1, sel.qty | 0); i++) machines.push({ sel, row });
  });
  const shown = machines.slice(0, COMP.limit);
  const compressorXs = shown.map((_, i) => COMP.firstX + i * COMP.stepX);

  // Виброгасители — одна опция, но позиции линий самостоятельные: линию
  // определяем по плану подбора (result.vibration). Старые коды принимаются
  // для спецификаций, сохранённых до объединения опции.
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

  const blocks = [];
  const legend = [];
  const notes = [];
  const counters = {};   // счётчики номеров по буквенным кодам
  const tags = new Map(); // позиция → обозначение (повторные знаки — один тег)

  /**
   * Обозначение позиции: буквенный код вида оборудования и номер по порядку
   * обхода контура. Повторные знаки одной позиции (виброгасители всех
   * компрессоров, компрессоры одной модели) получают одно обозначение.
   */
  function tagFor(item) {
    const key = `${item.option_code}|${item.article}|${item.name}`;
    if (tags.has(key)) return tags.get(key);
    const prefix = TAG_PREFIX[item.option_code];
    let tag = '';
    if (prefix) {
      counters[prefix] = (counters[prefix] || 0) + 1;
      tag = `${prefix}${counters[prefix]}`;
      legend.push({
        tag,
        name: item.name,
        article: item.article || '',
        qty: item.qty || 1
      });
    }
    tags.set(key, tag);
    return tag;
  }

  /**
   * Знак на схеме. Рисуется, только если позиция входит в спецификацию:
   * тогда у знака есть обозначение из легенды.
   */
  function placeRow(item, geometry) {
    if (!item) return;
    const shape = SYMBOLS[geometry.symbol];
    if (!shape) return;
    const rot = geometry.rot || 0;
    blocks.push({
      symbol: geometry.symbol,
      x: geometry.x,
      y: geometry.y,
      rot,
      mask: shape.mask,
      maskless: !!shape.maskless,
      shapes: shape.shapes,
      tag: tagFor(item),
      tagInside: !!shape.tagInside,
      tagDx: geometry.tagDx != null ? geometry.tagDx : (shape.tagDx != null ? shape.tagDx : 0),
      tagDy: geometry.tagDy != null ? geometry.tagDy : (shape.tagDy != null ? shape.tagDy : -32),
      tagAnchor: geometry.tagAnchor || shape.tagAnchor || 'middle'
    });
  }

  /** Знак по коду опции (первая позиция этого кода) */
  function placeOption(code, geometry) {
    placeRow(rowOf(code), geometry);
  }

  /** Знак внешнего элемента контура: он не позиция агрегата, но имеет код */
  function placeExternal(geometry) {
    const shape = SYMBOLS[geometry.symbol];
    if (!shape) return;
    blocks.push({
      symbol: geometry.symbol,
      x: geometry.x,
      y: geometry.y,
      rot: geometry.rot || 0,
      mask: shape.mask,
      maskless: false,
      shapes: shape.shapes,
      tag: geometry.tag,
      tagInside: !!shape.tagInside,
      tagDx: geometry.tagDx != null ? geometry.tagDx : (shape.tagDx != null ? shape.tagDx : 0),
      tagDy: geometry.tagDy != null ? geometry.tagDy : (shape.tagDy != null ? shape.tagDy : -32),
      tagAnchor: geometry.tagAnchor || shape.tagAnchor || 'middle'
    });
    notes.push(`${geometry.tag} — ${geometry.note}`);
  }

  // ---------- Компрессоры и их ветки ----------
  shown.forEach((machine, i) => {
    const x = compressorXs[i];
    if (machine.row) {
      placeRow(machine.row, { symbol: 'compressor', x, y: COMP.centerY });
    }
    // всасывающая ветка: виброгаситель
    placeRow(suctionDamperRow, { symbol: 'damper', x, y: SUCTION_Y - 92, rot: -90, tagDx: -58, tagDy: 6, tagAnchor: 'end' });
    // нагнетательная ветка: виброгаситель и обратный клапан
    placeRow(dischargeDamperRow, { symbol: 'damper', x, y: 700, rot: -90, tagDx: -58, tagDy: 6, tagAnchor: 'end' });
    placeOption('check_valves', { symbol: 'check_valve', x, y: 578, rot: -90, tagDx: 40, tagDy: 4, tagAnchor: 'start' });
  });

  if (machines.length > shown.length) {
    notes.push(`На схеме показаны ${shown.length} компрессора из ${machines.length}.`);
  }

  // ---------- Коллектор нагнетания и масляная линия ----------
  HEADER_SLOTS.forEach(slot => {
    placeOption(slot.code, { symbol: slot.symbol, x: slot.x, y: HEADER_Y });
  });
  OIL_SLOTS.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: slot.x, y: slot.y,
      rot: slot.rot, tagDx: slot.tagDx, tagDy: slot.tagDy
    });
  });

  // ---------- Подъём нагнетания ----------
  RISER_SLOTS.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: RISER_X, y: slot.y, rot: slot.rot,
      tagDx: slot.tagDx, tagDy: slot.tagDy, tagAnchor: slot.tagAnchor
    });
  });

  // ---------- Жидкостная линия ----------
  LIQUID_SLOTS.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: slot.x, y: LIQUID_Y, rot: slot.rot,
      tagDx: slot.tagDx, tagDy: slot.tagDy
    });
  });

  // ---------- Предохранительный клапан и навесное ресивера ----------
  placeOption(SAFETY.code, { symbol: 'safety_valve', x: SAFETY.x, y: 404 });
  RECEIVER_ATTACH.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: slot.x, y: slot.y, rot: slot.rot,
      tagDx: slot.tagDx, tagDy: slot.tagDy, tagAnchor: slot.tagAnchor
    });
  });

  // ---------- Всасывающая линия и приборы ----------
  SUCTION_SLOTS.forEach(slot => {
    placeOption(slot.code, {
      symbol: slot.symbol, x: SUCTION_X, y: slot.y, rot: slot.rot,
      tagDx: slot.tagDx, tagDy: slot.tagDy, tagAnchor: slot.tagAnchor
    });
  });
  SUCTION_INSTRUMENTS.forEach(slot => {
    placeOption(slot.code, { symbol: 'instrument', x: slot.x, y: slot.y, rot: slot.rot });
  });
  HEADER_INSTRUMENTS.forEach(slot => {
    placeOption(slot.code, { symbol: 'instrument', x: slot.x, y: slot.y, rot: slot.rot });
  });

  // ---------- Дифференциальный клапан (зимний комплект) ----------
  placeOption(BYPASS.code, { symbol: 'diff_valve', x: BYPASS.x, y: 374, rot: -90, tagDx: 40, tagDy: 4, tagAnchor: 'start' });

  // ---------- Внешние элементы контура ----------
  placeExternal({
    symbol: 'condenser', x: CONDENSER.cx, y: CONDENSER.cy, tag: 'K1',
    note: 'конденсатор (внешний)'
  });
  placeExternal({
    symbol: 'evaporator', x: EVAPORATOR.cx, y: EVAPORATOR.cy, tag: 'EV1',
    note: 'испаритель (внешний)'
  });
  placeExternal({
    symbol: 'txv', x: TXV.x, y: LIQUID_Y, rot: 180, tag: 'EX1', tagDy: 34,
    note: 'терморегулирующий вентиль (внешний)'
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
