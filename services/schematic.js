/**
 * Гидравлическая схема агрегата.
 *
 * Схема повторяет принцип построения производственной гидравлической схемы
 * (см. ЗП24.2158.000.00.00.Г): контур рисуется ортогональными линиями, каждая
 * позиция получает обозначение (OS1, OR1, OML1, DF1, SG1, V1, CV1, PSH1, GP1 …),
 * приборы и сосуды выводятся отдельными знаками, а размеры линий подписаны
 * в дюймовой «трубной» записи.
 *
 * Границы схемы — границы агрегата: компрессоры, общий коллектор нагнетания
 * с маслоотделителем, масляная линия, конденсатор, жидкостная линия с линейным
 * ресивером и всасывающая линия. Испаритель и терморегулирующий вентиль в
 * состав агрегата не входят, поэтому жидкостная и всасывающая линии просто
 * заканчиваются патрубками в сторону испарителя.
 *
 * Особенности обвязки, повторённые по приложенной гидравлике:
 *  - маслоотделитель висит под коллектором нагнетания, вход и выход
 *    нагнетания подведены к его верхнему днищу;
 *  - линейный ресивер имеет три штуцера: вход, выход и штуцер
 *    предохранительного клапана;
 *  - зимняя обвязка: KVR на нагнетании после маслоотделителя, NRV на линии
 *    слива из конденсатора в ресивер перед вентилем входа в ресивер и NRD на
 *    байпасной линии от нагнетания в ресивер между NRV и вентилем входа;
 *  - регуляторы уровня масла установлены по одному на компрессор справа от
 *    машины, масло к ним идёт от масляного ресивера через масляный фильтр и
 *    вентиль Rotalock перед каждым регулятором.
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
 * (-90 — поток вверх, 90 — вниз, 180 — влево), поле scale уменьшает знак.
 */
'use strict';

// ============================ Геометрия схемы =============================

const CANVAS = { width: 1500, height: 1050 };

// Компрессорный отсек. Компрессор рисуется выходом вверх: поток идёт от
// всасывания (снизу) к нагнетанию (сверху), поэтому нагнетательная ветка
// идёт от компрессора к общему коллектору нагнетания, а всасывающая — от
// коллектора всасывания к компрессору.
const COMP = { firstX: 300, stepX: 190, centerY: 780, radius: 32 };
const HEADER_Y = 470;        // общий коллектор нагнетания
const SUCTION_Y = 910;       // коллектор всасывания
const RISER_X = 1390;        // подъём нагнетания к конденсатору
const LIQUID_Y = 370;        // жидкостная линия
const SUCTION_X = 120;       // вертикаль всасывания
const SUCTION_TOP_Y = 260;   // верхний конец всасывающей линии
const TXV_X = 420;           // свободный конец жидкостной линии
const OIL_FEED_Y = 620;      // линия подачи масла к регуляторам уровня
const REGULATOR_DX = 95;     // смещение регулятора уровня от компрессора
const REGULATOR_VALVE_Y = 700; // вентиль Rotalock перед регулятором
const CONDENSER = { cx: 1250, cy: 190, w: 320, h: 130 };

// Жидкостная линия: конденсатор → обратный клапан на сливе (NRV) → вентиль
// входа в ресивер → линейный ресивер (три штуцера) → запорный вентиль
// Rotalock → фильтр-осушитель → смотровой глазок → вентили. Порядок
// перечисления — по потоку, справа налево. Опуск от конденсатора идёт левее
// подъёма нагнетания, поэтому линии не пересекаются.
const LIQUID = {
  condenserDropX: 1300,   // опуск от конденсатора к жидкостной линии
  nrvX: 1240,             // CV: обратный клапан на сливе из конденсатора
  inletValveX: 1150,      // V: вентиль на входе в линейный ресивер
  receiverX: 1000,        // LR: линейный ресивер
  safetyX: 1000,          // SV: предохранительный клапан на штуцере ресивера
  safetyY: 280,
  outletValveX: 860,      // V: запорный вентиль Rotalock сразу после ресивера
  filterX: 780,           // DF: фильтр-осушитель
  insertX: 780,           // DFi: вставка осушительная
  sightX: 680,            // SG: смотровой глазок
  solenoidX: 580,         // SOV: соленоидный вентиль
  ballValveX: 500         // V: шаровый кран на выходе агрегата
};

// Байпас зимнего комплекта (NRD): с нагнетания в ресивер между обратным
// клапаном слива и вентилем входа в ресивер.
const BYPASS = { x: 1200, y: 420, code: 'winter_diff' };

// Арматура (вентили, обратные клапаны, виброгасители, фильтры) рисуется
// уменьшенной: знаки меньше по масштабу, чтобы контур выглядел компактно.
const FITTING_SCALE = 0.5;

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
  oil_receiver_valve: 'V',
  oil_regulator_valve: 'V',
  level_regulator: 'OML',
  erum: 'OML',
  check_valves: 'CV',
  vibration: 'VA',
  compressor_valve: 'V',
  liquid_receiver: 'LR',
  liquid_nrv: 'CV',
  receiver_outlet_valve: 'V',
  receiver_inlet_valve: 'V',
  filter_drier: 'DF',
  drier_insert: 'DFi',
  sight_glass: 'SG',
  solenoid: 'SOV',
  liquid_ball_valve: 'V',
  service_valve: 'V',
  discharge_valve: 'V',
  suction_ball_valve: 'V',
  safety_valve: 'SV',
  liquid_separator: 'AS',
  suction_filter: 'SF',
  winter_kvr: 'V',
  winter_cpr: 'CPR',
  winter_nrv_drain: 'CV',
  winter_diff: 'DV',
  receiver_heater: 'E',
  level_switch: 'LS',
  pressure_switch_hp: 'PSLH',
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
  mask: maskRect(-30, -80, 60, 84),
  tagInside: true,
  tagDx: 0, tagDy: -55,
  shapes: [line(0, 0, 0, -34), circle(0, -55, 21)]
});

/**
 * Знак регулятора уровня масла (OML): поплавковая камера на картере
 * компрессора. Один регулятор на компрессор, справа от машины; масло
 * подводится сверху, в картер — слева. Обозначение вынесено под знак, чтобы
 * не перекрывать вентиль на линии подачи масла.
 */
const levelRegulator = () => ({
  mask: maskRect(-34, -36, 68, 72),
  tagInside: false,
  tagDx: 0, tagDy: 42,
  shapes: [
    rect(-18, -30, 36, 60, 10),
    line(-18, 0, -24, 0),
    line(18, 0, 24, 0),
    path('M -12 -8 H 12'),
    circle(0, 10, 5)
  ]
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

  /** Виброгаситель (VA) — гибкая вставка между фланцами */
  damper: {
    scale: FITTING_SCALE,
    mask: maskC(84, 38),
    tagDx: 0, tagDy: -22,
    shapes: [
      line(-34, -17, -34, 17), line(34, -17, 34, 17),
      path('M -34 0 C -22 -15 -10 15 0 0 C 10 -15 22 15 34 0')
    ]
  },

  /** Обратный клапан (CV) — тарелка и седло */
  check_valve: {
    scale: FITTING_SCALE,
    mask: maskC(62, 38),
    tagDx: 0, tagDy: -22,
    shapes: [
      line(-28, -16, -28, 16),
      path('M -14 -13 L 12 0 L -14 13 Z'),
      line(12, -16, 12, 16)
    ]
  },

  /** Шаровый вентиль (V) — два треугольника, шар и ручка */
  ball_valve: {
    scale: FITTING_SCALE,
    mask: maskC(66, 48),
    tagDx: 0, tagDy: -24,
    shapes: [...bowtie(15, 13), circle(0, 0, 5), line(0, -13, 0, -27), line(-10, -27, 10, -27)]
  },

  /** Вентиль Rotalock (V) — треугольники с маховиком */
  rotalock_valve: {
    scale: FITTING_SCALE,
    mask: maskC(66, 56),
    tagDx: 0, tagDy: -28,
    shapes: [...bowtie(15, 13), line(0, -13, 0, -26), path('M -11 -26 L 11 -26 L 0 -40 Z')]
  },

  /** Мембранный вентиль (V) — вентиль с мембраной */
  membrane_valve: {
    scale: FITTING_SCALE,
    mask: maskC(66, 52),
    tagDx: 0, tagDy: -26,
    shapes: [...bowtie(15, 13), line(0, -13, 0, -24), path('M -13 -24 H 13 A 13 13 0 0 1 -13 -24 Z')]
  },

  /** Соленоидный вентиль (SOV) — вентиль с катушкой */
  solenoid: {
    scale: FITTING_SCALE,
    mask: maskC(66, 66),
    tagDx: 0, tagDy: -34,
    shapes: [
      ...bowtie(15, 13), line(0, -13, 0, -22),
      rect(-12, -36, 24, 14, 2), line(-17, -43, 17, -43)
    ]
  },

  /** Предохранительный клапан (SV) — тарелка, пружина, выброс */
  safety_valve: {
    scale: FITTING_SCALE,
    // вырез не заходит ниже точки врезки, поэтому штуцер ресивера остаётся
    // видимым и клапан читается подключённым к сосуду
    mask: maskRect(-22, -80, 44, 80),
    tagDx: 20, tagDy: 4, tagAnchor: 'start',
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
    scale: FITTING_SCALE,
    mask: maskC(58, 58),
    tagDx: 0, tagDy: -24,
    shapes: [
      circle(0, 0, 16), line(-16, 0, 16, 0), line(0, -16, 0, 16),
      line(-26, 0, -16, 0), line(16, 0, 26, 0)
    ]
  },

  /** Фильтр со сменным сердечником (DF, SF) — корпус с перегородками */
  filter: {
    scale: FITTING_SCALE,
    mask: maskC(96, 54),
    tagDx: 0, tagDy: -22,
    shapes: [
      line(-36, -19, -36, 19), line(36, -19, 36, 19),
      rect(-32, -19, 64, 38),
      path('M -20 -19 L 4 19'), path('M 8 -19 L 32 19')
    ]
  },

  /** Вставка осушительная (DFi) — рисуется внутри фильтра, не закрывая его */
  insert: {
    scale: FITTING_SCALE,
    maskless: true,
    mask: maskC(44, 30),
    shapes: [
      rect(-20, -13, 40, 26, 2),
      path('M -12 -13 L 10 13', true), path('M -12 13 L 10 -13', true)
    ]
  },

  /** Масляный фильтр (OF) */
  oil_filter: {
    scale: FITTING_SCALE,
    mask: maskC(72, 46),
    tagDx: 0, tagDy: -22,
    shapes: [
      line(-27, -17, -27, 17), line(27, -17, 27, 17),
      rect(-23, -17, 46, 34),
      path('M -14 -17 L 4 17'), path('M 6 -17 L 22 17')
    ]
  },

  /** Линейный ресивер (LR) — горизонтальный цилиндр с уровнем и тремя штуцерами */
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

  /** Маслоотделитель (OS) — вертикальный цилиндр, вход и выход сверху */
  oil_separator: {
    mask: maskC(84, 104),
    tagInside: true,
    tagDx: 0, tagDy: 6,
    shapes: [
      rect(-35, -48, 70, 96, 16),
        // Убран патрубок вверху в центре (была горизонтальная линия M -25 -48 H 25)
      line(-20, -48, -20, -58), line(20, -48, 20, -58),
      path('M -16 28 q 8 -10 16 0 q 8 10 16 0')
    ]
  },

  /** Масляный ресивер (OR) — вертикальный цилиндр с уровнем */
  oil_receiver: {
    scale: 0.7,
    mask: maskC(76, 96),
    tagInside: true,
    tagDx: 0, tagDy: 4,
    shapes: [rect(-32, -44, 64, 88, 16), line(-20, 22, 20, 22)]
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

  /** Клапан регулирования давления KVR (на нагнетании после маслоотделителя) */
  kvr: {
    scale: FITTING_SCALE,
    mask: maskC(66, 72),
    tagDx: 0, tagDy: -28,
    shapes: [
      ...bowtie(15, 13), line(0, -13, 0, -24),
      rect(-13, -38, 26, 12, 2), path('M -8 -44 L 8 -44'), path('M -8 -48 L 8 -48')
    ]
  },

  /** Обратный клапан байпаса NRD (с нагнетания в ресивер) */
  diff_valve: {
    scale: FITTING_SCALE,
    mask: maskC(64, 62),
    tagDx: 0, tagDy: -32,
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

  /** Регулятор уровня масла (OML) — по одному на компрессор */
  level_regulator: levelRegulator(),

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
// компрессоров по нагнетанию, по масляной линии, по зимней обвязке, через
// конденсатор и жидкостную линию, к всасывающей линии.

// Подъём нагнетания: KVR на нагнетании после маслоотделителя, выше — вентиль
// на выходе из агрегата (поток вверх).
const RISER_SLOTS = [
  { code: 'winter_kvr', symbol: 'kvr', y: 400, rot: -90, tagDx: 26, tagDy: 4, tagAnchor: 'start' },
  { code: 'discharge_valve', symbol: 'rotalock_valve', y: 300, rot: -90, tagDx: 26, tagDy: 4, tagAnchor: 'start' }
];

// Жидкостная линия (поток справа налево): NRV на сливе из конденсатора,
// вентиль входа в ресивер, линейный ресивер, фильтр-осушитель, глазок, вентили.
const LIQUID_SLOTS = [
  { code: 'winter_nrv_drain', symbol: 'check_valve', x: LIQUID.nrvX + 60, rot: 180 },
  { code: 'liquid_nrv', symbol: 'check_valve', x: LIQUID.nrvX, rot: 180 },
  { code: 'service_valve', symbol: 'membrane_valve', x: LIQUID.inletValveX, rot: 180 },
  { code: 'liquid_receiver', symbol: 'receiver', x: LIQUID.receiverX, rot: 0 },
  // сразу после ресивера — запорный вентиль Rotalock
  { code: 'receiver_outlet_valve', symbol: 'rotalock_valve', x: LIQUID.outletValveX, rot: 180 },
  { code: 'filter_drier', symbol: 'filter', x: LIQUID.filterX, rot: 180 },
  { code: 'drier_insert', symbol: 'insert', x: LIQUID.insertX, rot: 180, maskless: true, tagDx: -34, tagDy: 22 },
  { code: 'sight_glass', symbol: 'sight_glass', x: LIQUID.sightX, rot: 0 },
  { code: 'solenoid', symbol: 'solenoid', x: LIQUID.solenoidX, rot: 180 },
  { code: 'liquid_ball_valve', symbol: 'ball_valve', x: LIQUID.ballValveX, rot: 180 }
];

// Всасывающая линия (поток вниз: отделитель жидкости, фильтр, вентиль)
const SUCTION_SLOTS = [
  { code: 'liquid_separator', symbol: 'oil_separator', y: 380, rot: 90, tagDx: 0, tagDy: -66 },
  { code: 'suction_filter', symbol: 'filter', y: 500, rot: 90, tagDx: 42, tagDy: 8, tagAnchor: 'start' },
  { code: 'suction_ball_valve', symbol: 'ball_valve', y: 600, rot: 90, tagDx: 26, tagDy: 8, tagAnchor: 'start' },
  { code: 'winter_cpr', symbol: 'kvr', y: 800, rot: 90, tagDx: 26, tagDy: 8, tagAnchor: 'start' }
];

// Приборы на всасывании (низкое давление) — справа от вертикали
const SUCTION_INSTRUMENTS = [
  { code: 'gauge_lp', x: SUCTION_X, y: 650, rot: 90 },
  { code: 'pressure_switch_lp', x: SUCTION_X, y: 750, rot: 90 },
  { code: 'pressure_transmitter', x: SUCTION_X, y: 840, rot: 90 }
];

// Приборы на нагнетании (высокое давление) — над коллектором
const HEADER_INSTRUMENTS = [
  { code: 'discharge_thermostat', x: 700, y: HEADER_Y, rot: 0 },
  { code: 'gauge_hp', x: 790, y: HEADER_Y, rot: 0 },
  { code: 'pressure_switch_hp', x: 880, y: HEADER_Y, rot: 0 }
];

// Навесное оборудование жидкостного ресивера (ТЭН и реле уровня)
const RECEIVER_ATTACH = [
  { code: 'receiver_heater', symbol: 'heater', x: 930, y: LIQUID_Y + 38, rot: 180, tagDx: 36, tagDy: 4, tagAnchor: 'start' },
  { code: 'level_switch', symbol: 'instrument', x: 1070, y: LIQUID_Y + 38, rot: 180, tagDx: 0, tagDy: 55 }
];

// Подписи линий: название и размер подставляются в шаблоне. Испаритель и ТРВ
// в состав агрегата не входят, поэтому линии подписаны только размером.
const LINE_LABELS = [
  // подписи вынесены на свободные участки линий, чтобы не перекрывать знаки
  { kind: 'discharge', x: 480, y: HEADER_Y - 20, caption: 'Нагнетание' },
  { kind: 'liquid', x: 560, y: LIQUID_Y + 28, caption: '' },
  { kind: 'suction', x: SUCTION_X - 28, y: 720, caption: '', rot: -90 }
];

// ============================ Трубы контура ===============================

/**
 * Раскладка позиций на вертикальной ветке компрессора.
 * Позиции перечислены в порядке движения хладагента (от компрессора к
 * магистрали), поэтому раскладка идёт от магистрали вниз — с конца списка.
 * @returns {number[]} координаты центров знаков, в порядке перечисления
 */
function stubLayout(fromY, toY, items) {
  if (!items.length) return [];
  const total = items.reduce((sum, item) => sum + item.len, 0);
  const gap = Math.max(6, (Math.abs(toY - fromY) - total) / (items.length + 1));
  const places = new Array(items.length);
  let cursor = fromY;
  for (let i = items.length - 1; i >= 0; i--) {
    cursor += gap + items[i].len;
    places[i] = cursor - items[i].len / 2;
  }
  return places;
}

/**
 * Производные координаты схемы: ось маслоотделителя и масляного ресивера,
 * место масляного фильтра и вентиля на выходе масляного ресивера, точки
 * врезки регуляторов уровня масла (по одному на компрессор справа от машины).
 */
function layoutOf(compressorXs) {
  const firstX = compressorXs[0];
  const lastX = compressorXs[compressorXs.length - 1];
  const regulatorXs = compressorXs.map(x => x + REGULATOR_DX);
  // Правая часть отведена под маслоотделитель с масляным ресивером; вентиль и
  // фильтр стоят на линии подачи правее всех врезок регуляторов уровня.
  const oilHeaderX = Math.max(1100, regulatorXs[regulatorXs.length - 1] + 135);
  const oilValveX = oilHeaderX - 50;
  const oilFilterX = oilHeaderX - 110;
  return {
    firstX,
    lastX,
    regulatorXs,
    oilHeaderX,
    oilValveX,
    oilFilterX,
    oilLeftX: regulatorXs[0]
  };
}

/** Стрелки направления потока */
function buildArrows(compressorXs, hasOilSeparator, hasWinterBypass) {
  const { lastX, regulatorXs, oilHeaderX, oilFilterX } = layoutOf(compressorXs);
  const arrows = [
    // коллектор нагнетания → подъём к конденсатору
    { x: lastX + 40, y: HEADER_Y, rot: 0 },
    { x: RISER_X, y: 330, rot: -90 },
    // жидкостная линия: опуск от конденсатора и движение влево к патрубку
    { x: LIQUID.condenserDropX, y: 300, rot: 90 },
    { x: LIQUID.outletValveX - 45, y: LIQUID_Y, rot: 180 },
    { x: LIQUID.sightX - 50, y: LIQUID_Y, rot: 180 },
    { x: TXV_X + 30, y: LIQUID_Y, rot: 180 },
    // всасывание: от патрубка испарителя к компрессорам
    { x: SUCTION_X, y: SUCTION_TOP_Y + 34, rot: 90 },
    { x: SUCTION_X, y: 520, rot: 90 },
    { x: SUCTION_X + 120, y: SUCTION_Y, rot: 0 },
  ];
  if (hasWinterBypass) {
    // байпас зимнего комплекта: с нагнетания в ресивер
    arrows.push({ x: BYPASS.x, y: 395, rot: -90 });
  }
  if (hasOilSeparator) {
    arrows.push(
      // масляная линия: от масляного ресивера вниз и к регуляторам уровня
      { x: oilHeaderX, y: 560, rot: 90 },
      { x: oilFilterX + 45, y: OIL_FEED_Y, rot: 180 }
    );
  }

  if (hasOilSeparator) regulatorXs.forEach((x, i) => {
    // масло к регулятору уровня — сверху вниз
    arrows.push({ x, y: OIL_FEED_Y + 26, rot: 90 });
    // масло от регулятора в картер компрессора
    arrows.push({ x: x - 50, y: COMP.centerY, rot: 180 });
    // нагнетательная ветка: поток вверх, к общему коллектору нагнетания
    arrows.push({ x: compressorXs[i], y: HEADER_Y + 16, rot: -90 });
    // всасывающая ветка: поток вверх, в компрессор
    arrows.push({ x: compressorXs[i], y: SUCTION_Y - 16, rot: -90 });
  });
  
    // Стрелка на линии сброса давления масляного ресивера (от ресивера к всасыванию)
    if (hasOilSeparator) {
      arrows.push({ x: oilHeaderX, y: OIL_FEED_Y + 100, rot: 90 });
    }

  return arrows;
}

/**
 * Трубы контура.
 * Холодильный контур агрегата: компрессоры → общий коллектор нагнетания →
 * маслоотделитель (вход и выход сверху сосуда) → подъём нагнетания с KVR →
 * конденсатор → линия слива с обратным клапаном NRV и вентилем входа →
 * линейный ресивер (вход, выход и штуцер предохранительного клапана) →
 * фильтр-осушитель, глазок, вентили → патрубок в сторону испарителя;
 * всасывание — от патрубка испарителя через отделитель жидкости, фильтр и
 * вентиль к компрессорам. Масляная линия: маслоотделитель → масляный ресивер
 * → вентиль на выходе → масляный фильтр → вентили Rotalock → регуляторы
 * уровня масла на каждом компрессоре. Зимний комплект: KVR на нагнетании,
 * NRV на линии слива, NRD на байпасе с нагнетания в ресивер между NRV и
 * вентилем входа в ресивер.
 */
function buildWires(compressorXs, hasOilSeparator, hasWinterBypass) {
  const { lastX, regulatorXs, oilHeaderX, oilValveX, oilFilterX, oilLeftX } = layoutOf(compressorXs);

  const wires = [
    // Без маслоотделителя нагнетание идёт напрямую к подъёму, без
    // искусственной петли входа/выхода аппарата.
    { kind: 'discharge', d: hasOilSeparator
      ? `M ${compressorXs[0]} ${HEADER_Y} H ${oilHeaderX - 20}`
      : `M ${compressorXs[0]} ${HEADER_Y} H ${RISER_X} V ${CONDENSER.cy + CONDENSER.h / 2}` },
    // конденсатор — линия слива: опуск идёт левее подъёма нагнетания, поэтому
    // линии нагнетания и слива не пересекаются
    { kind: 'liquid', d: `M ${LIQUID.condenserDropX} ${CONDENSER.cy + CONDENSER.h / 2} V ${LIQUID_Y} H ${TXV_X}` },
    // свободный патрубок жидкостной линии в сторону испарителя
    { kind: 'liquid', d: `M ${TXV_X + 24} ${LIQUID_Y} H ${TXV_X}` },
    // штуцер предохранительного клапана на линейном ресивере
    { kind: 'branch', d: `M ${LIQUID.safetyX} ${LIQUID_Y} V ${LIQUID.safetyY}` },
    // всасывание: патрубок от испарителя, вертикаль и коллектор всасывания
    { kind: 'suction', d: `M ${SUCTION_X} ${SUCTION_TOP_Y} V ${SUCTION_Y} H ${lastX}` },
  ];
  if (hasWinterBypass) {
    // байпас зимнего комплекта: с нагнетания в ресивер между NRV и вентилем входа
    wires.push({ kind: 'diff', d: `M ${RISER_X} ${BYPASS.y} H ${BYPASS.x} V ${LIQUID_Y}` });
  }
  if (hasOilSeparator) {
    wires.push(
      // Вход и выход нагнетания проходят через верхние штуцеры
      // маслоотделителя, после чего отдельным участком идут к конденсатору.
      { kind: 'discharge', d: `M ${oilHeaderX - 20} ${HEADER_Y} V ${HEADER_Y + 14}` },
      { kind: 'discharge', d: `M ${oilHeaderX + 20} ${HEADER_Y + 14} V ${HEADER_Y}` },
      { kind: 'discharge', d: `M ${oilHeaderX + 20} ${HEADER_Y} H ${RISER_X} V ${CONDENSER.cy + CONDENSER.h / 2}` },
      // масляная линия: маслоотделитель → масляный ресивер → вентиль на выходе
      { kind: 'oil', d: `M ${oilHeaderX} ${HEADER_Y} V ${OIL_FEED_Y}` },
      // линия подачи масла: масляный фильтр → вентили Rotalock → регуляторы
        { kind: 'oil', d: `M ${oilHeaderX} ${OIL_FEED_Y} H ${oilLeftX}` },
        // линия сброса давления масляного ресивера: от ресивера вниз к всасыванию
        // с дифференциальным клапаном (3-3,5 бар), пунктирная вспомогательная линия
        { kind: 'oil', dash: true, d: `M ${oilHeaderX} ${OIL_FEED_Y} V ${OIL_FEED_Y + 230} H ${SUCTION_X} V ${SUCTION_Y}` }
      );
    }

  compressorXs.forEach((x, i) => {
    const regulatorX = regulatorXs[i];
    // нагнетание: из компрессора вверх в общий коллектор нагнетания
    wires.push({ kind: 'discharge', d: `M ${x} ${COMP.centerY - COMP.radius} V ${HEADER_Y}` });
    // всасывание: из коллектора всасывания в компрессор (снизу)
    wires.push({ kind: 'suction', d: `M ${x} ${SUCTION_Y} V ${COMP.centerY + COMP.radius}` });
    // масло: от линии подачи к регулятору уровня
    if (hasOilSeparator) {
      wires.push({ kind: 'oil', d: `M ${regulatorX} ${OIL_FEED_Y} V ${COMP.centerY}` });
      // масло: от регулятора уровня в картер компрессора
      wires.push({ kind: 'oil', d: `M ${regulatorX} ${COMP.centerY} H ${x + 30}` });
    }
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
    // The BOM can contain a normalized/display article while selection keeps
    // the catalog model. Keep a synthetic row as a fallback so a compressor
    // is never silently dropped from the hydraulic scheme.
    const row = compressorRows.find(b => b.article === sel.model) || {
      option_code: 'compressor',
      article: sel.model,
      name: `Компрессор ${sel.manufacturer || ''} ${sel.model}`.trim(),
      qty: sel.qty || 1
    };
    const quantity = Math.max(1, Number(sel.qty) || Number(row.qty) || 1);
    for (let i = 0; i < quantity; i++) machines.push({ sel, row });
  });
  const shown = machines;
  const compressorXs = shown.map((_, i) => COMP.firstX + i * COMP.stepX);
  const { regulatorXs, oilHeaderX, oilValveX, oilFilterX } = layoutOf(compressorXs);
  const hasOilSeparator = !!rowOf('oil_separator');
  const hasWinterBypass = !!rowOf('winter_kvr') &&
    !!rowOf('winter_nrv_drain') &&
    !!rowOf('winter_diff');

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

  /** Знак на схеме: рисуется, только если позиция входит в спецификацию */
  function placeRow(item, geometry) {
    if (!item) return;
    const shape = SYMBOLS[geometry.symbol];
    if (!shape) return;
    blocks.push({
      symbol: geometry.symbol,
      x: geometry.x,
      y: geometry.y,
      rot: geometry.rot || 0,
      scale: geometry.scale != null ? geometry.scale : (shape.scale != null ? shape.scale : 1),
      mask: shape.mask,
      maskless: !!shape.maskless,
      shapes: shape.shapes,
      tag: tagFor(item),
      tagInside: !!shape.tagInside,
      tagDx: geometry.tagDx != null ? geometry.tagDx : (shape.tagDx != null ? shape.tagDx : 0),
      tagDy: geometry.tagDy != null ? geometry.tagDy : (shape.tagDy != null ? shape.tagDy : -22),
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
      scale: 1,
      mask: shape.mask,
      maskless: false,
      shapes: shape.shapes,
      tag: geometry.tag,
      tagInside: !!shape.tagInside,
      tagDx: geometry.tagDx != null ? geometry.tagDx : (shape.tagDx != null ? shape.tagDx : 0),
      tagDy: geometry.tagDy != null ? geometry.tagDy : (shape.tagDy != null ? shape.tagDy : -22),
      tagAnchor: geometry.tagAnchor || shape.tagAnchor || 'middle'
    });
    notes.push(`${geometry.tag} — ${geometry.note}`);
  }

  // ---------- Компрессоры и их ветки ----------
  // Компрессор рисуется выходом вверх: поток идёт от всасывания к нагнетанию,
  // поэтому вершина треугольника входит в линию нагнетания. На нагнетательной
  // ветке по потоку стоят запорный вентиль (если он есть в спецификации),
  // виброгаситель и обратный клапан, после чего ветка входит в общий
  // коллектор нагнетания.
  const stubItems = [];
  if (rowOf('compressor_valve')) stubItems.push({ row: rowOf('compressor_valve'), symbol: 'ball_valve', len: 26 });
  if (dischargeDamperRow) stubItems.push({ row: dischargeDamperRow, symbol: 'damper', len: 32 });
  if (rowOf('check_valves')) stubItems.push({ row: rowOf('check_valves'), symbol: 'check_valve', len: 26 });

  shown.forEach((machine, i) => {
    const x = compressorXs[i];
    if (machine.row) {
      placeRow(machine.row, { symbol: 'compressor', x, y: COMP.centerY, rot: -90 });
    }
    // всасывающая ветка: виброгаситель между коллектором всасывания и КМ
    const suctionMid = (COMP.centerY + COMP.radius + SUCTION_Y) / 2;
    placeRow(suctionDamperRow, {
      symbol: 'damper', x, y: suctionMid, rot: -90,
      tagDx: -26, tagDy: 6, tagAnchor: 'end'
    });
    // нагнетательная ветка: позиции по потоку от компрессора к магистрали
    const stubYs = stubLayout(HEADER_Y, COMP.centerY - COMP.radius, stubItems);
    stubItems.forEach((item, k) => {
      placeRow(item.row, {
        symbol: item.symbol, x, y: stubYs[k], rot: -90,
        tagDx: -26, tagDy: 6, tagAnchor: 'end'
      });
    });
  });

  if (machines.length > shown.length) {
    notes.push(`На схеме показаны ${shown.length} компрессора из ${machines.length}.`);
  }

  // ---------- Масляная линия ----------
  // Маслоотделитель висит под коллектором нагнетания (вход и выход — на его
  // верхнем днище), под ним масляный ресивер, далее вентиль на выходе
  // ресивера, масляный фильтр и вентили Rotalock перед каждым регулятором
  // уровня масла.
  if (hasOilSeparator) placeOption('oil_separator', {
    symbol: 'oil_separator', x: oilHeaderX, y: HEADER_Y + 60
  });
  if (hasOilSeparator) placeOption('oil_receiver', {
    symbol: 'oil_receiver', x: oilHeaderX, y: OIL_FEED_Y, rot: 0
  });
  if (hasOilSeparator) placeOption('oil_cooler', {
    symbol: 'oil_cooler', x: oilHeaderX, y: OIL_FEED_Y - 40
  });
  if (hasOilSeparator) placeOption('orv_thermostat', {
    symbol: 'three_way', x: oilHeaderX + 150, y: OIL_FEED_Y - 40
  });
  // Вентиль на выходе масляного ресивера — на линии подачи, обозначение слева
  if (hasOilSeparator) placeOption('oil_receiver_valve', {
    symbol: 'rotalock_valve', x: oilValveX, y: OIL_FEED_Y, rot: 180,
    tagDx: -24, tagDy: 0, tagAnchor: 'end'
  });
  if (hasOilSeparator) placeOption('oil_filter', {
    symbol: 'oil_filter', x: oilFilterX, y: OIL_FEED_Y, rot: 180
  });
  
    // Дифференциальный клапан на линии сброса давления масляного ресивера
    // Поддерживает перепад 3-3,5 бар между масляным ресивером и всасыванием
    if (hasOilSeparator) placeOption('oil_pressure_relief_valve', {
      symbol: 'diff_valve', x: oilHeaderX, y: OIL_FEED_Y + 115, rot: -90,
      tagDx: 22, tagDy: 4, tagAnchor: 'start'
    });
    // Запорный клапан Rotalock FP-RV-038 SAE на линии сброса (опционально)
    if (hasOilSeparator) placeOption('oil_pressure_relief_rotalock', {
      symbol: 'rotalock_valve', x: oilHeaderX, y: OIL_FEED_Y + 165, rot: -90,
      tagDx: 22, tagDy: 4, tagAnchor: 'start'
    });

  const regulatorValveRow = rowOf('oil_regulator_valve');
  const regulatorRow = rowOf('level_regulator') || rowOf('erum');
  if (hasOilSeparator) regulatorXs.forEach(x => {
    // вентиль Rotalock перед регулятором уровня масла
    placeRow(regulatorValveRow, {
      symbol: 'rotalock_valve', x, y: REGULATOR_VALVE_Y, rot: -90,
      tagDx: 22, tagDy: 0, tagAnchor: 'start'
    });
    // регулятор уровня масла на картере компрессора, обозначение под знаком
    placeRow(regulatorRow, { symbol: 'level_regulator', x, y: COMP.centerY });
  });

  // ---------- Подъём нагнетания (KVR после маслоотделителя) ---------------
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

  // ---------- Предохранительный клапан на штуцере ресивера ---------------
  placeOption('safety_valve', {
    symbol: 'safety_valve', x: LIQUID.safetyX, y: LIQUID.safetyY
  });

  // ---------- Навесное оборудование жидкостного ресивера ----------------
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
    placeOption(slot.code, {
      symbol: 'instrument', x: slot.x, y: slot.y, rot: slot.rot,
      tagDx: 55, tagDy: 0
    });
  });
  HEADER_INSTRUMENTS.forEach(slot => {
    placeOption(slot.code, { symbol: 'instrument', x: slot.x, y: slot.y, rot: slot.rot });
  });

  // ---------- Байпас зимнего комплекта (NRD) ----------
  if (hasWinterBypass) {
    placeOption(BYPASS.code, {
      symbol: 'diff_valve', x: BYPASS.x, y: (BYPASS.y + LIQUID_Y) / 2, rot: -90,
      tagDx: 22, tagDy: 4, tagAnchor: 'start'
    });
  }

  // ---------- Внешние элементы контура: конденсатор ----------
  placeExternal({
    symbol: 'condenser', x: CONDENSER.cx, y: CONDENSER.cy, tag: 'K1',
    note: 'конденсатор (внешний)'
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
    wires: buildWires(compressorXs, hasOilSeparator, hasWinterBypass),
    arrows: buildArrows(compressorXs, hasOilSeparator, hasWinterBypass),
    blocks,
    legend,
    otherItems,
    lineLabels: LINE_LABELS,
    pipes,
    notes
  };
}

module.exports = { buildSchematic };
