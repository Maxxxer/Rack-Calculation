/**
 * Определения опций агрегата (разделы спецификации).
 *
 * Этот модуль — единственный источник истины для справочника `options`:
 * его используют и `db/seed.js`, и синхронизация при старте приложения
 * (`syncOptions` в `db/database.js`), поэтому изменения правил подбора
 * автоматически применяются к уже созданной базе.
 *
 * sizing:
 *   'none'                 — фиксированная позиция, компонент не подбирается
 *   'pipe'                 — подбор по диаметру линии (одна позиция на агрегат)
 *   'pipe_per_compressor'  — подбор по общему диаметру линии, количество = число КМ
 *                            (обратные клапаны после каждого компрессора)
 *   'per_compressor'       — подбор индивидуально по каждому компрессору
 *                            (виброгасители: размер по патрубку КМ, иначе по скорости)
 *   'capacity'             — подбор по холодопроизводительности
 *
 * mandatory:
 *   1 — позиция входит в агрегат всегда: она не показывается чекбоксом в окне
 *       «Опции», а перечисляется в окне «Стандартная комплектация»
 *   0 — обычная опция: пользователь отмечает её сам
 * Если у опции задано правило auto_rule, позиция добавляется в спецификацию
 * автоматически, когда режим работы подходит под правило.
 */
'use strict';

const OPTIONS = [
  { code: 'housing', name: 'Корпус', section: 'housing', component_category: 'housing',
    sizing: 'none', auto_rule: '{"always":true}', mandatory: 1, sort_order: 1 },
  { code: 'noise', name: 'Шумоизоляция', section: 'housing', component_category: null,
    sizing: 'none', price_eur: 120, auto_rule: '', sort_order: 2 },

  // --- Виброгасители: индивидуально на каждый компрессор, раздельно по линиям ---
  { code: 'vibration_suction', name: 'Виброгаситель на всасывании (на каждый КМ)',
    section: 'compressors', component_category: 'vibration', sizing: 'per_compressor', pipe_line: 'suction',
    description: 'Размер по патрубку всасывания компрессора; при отсутствии данных — по скорости хладагента и производительности',
    auto_rule: '', sort_order: 10 },
  { code: 'vibration_discharge', name: 'Виброгаситель на нагнетании (на каждый КМ)',
    section: 'compressors', component_category: 'vibration', sizing: 'per_compressor', pipe_line: 'discharge',
    description: 'Размер по патрубку нагнетания компрессора; при отсутствии данных — по скорости хладагента и производительности',
    auto_rule: '', sort_order: 11 },

  { code: 'capacity_ctrl', name: 'Регулировка производительности КМ', section: 'compressors',
    component_category: null, sizing: 'none', price_eur: 180,
    auto_rule: '{"min_compressors":2}', sort_order: 12 },
  { code: 'inverter', name: 'Инвертор', section: 'compressors', component_category: null,
    sizing: 'none', price_eur: 650, auto_rule: '', sort_order: 13 },
  { code: 'unloader', name: 'Отжим клапанов', section: 'compressors', component_category: null,
    sizing: 'none', price_eur: 210, auto_rule: '', sort_order: 14 },
  { code: 'check_valves', name: 'Обратные клапана после КМ', section: 'compressors',
    component_category: 'check_valve', sizing: 'pipe_per_compressor', pipe_line: 'discharge',
    auto_rule: '{"min_compressors":2}', sort_order: 15 },

  { code: 'oil_separator', name: 'Маслоотделитель', section: 'discharge', component_category: 'oil_separator',
    sizing: 'capacity', auto_rule: '{"max_tevap":-25}', sort_order: 20 },
  { code: 'oil_receiver', name: 'Масляный ресивер', section: 'discharge', component_category: 'oil_receiver',
    sizing: 'capacity', auto_rule: '{"min_compressors":2,"max_tevap":-25}', sort_order: 21 },
  { code: 'erum', name: 'ЭРУМ (электронный регулятор уровня масла)', section: 'discharge',
    component_category: null, sizing: 'none', price_eur: 240,
    auto_rule: '{"min_compressors":2,"max_tevap":-25}', sort_order: 22 },
  { code: 'winter_kvr', name: 'Зимняя опция KVR+NRD+NRV', section: 'winter', component_category: 'kvr_valve',
    sizing: 'capacity', auto_rule: '{"max_tcond":25}', sort_order: 30 },
  { code: 'winter_cpr', name: 'Клапан поддержания давления до себя', section: 'winter',
    component_category: null, sizing: 'none', price_eur: 95,
    auto_rule: '{"max_tcond":25}', sort_order: 31 },
  { code: 'winter_nrv_drain', name: 'Обратный клапан на сливе в ресивер', section: 'winter',
    component_category: 'check_valve', sizing: 'pipe', pipe_line: 'liquid',
    auto_rule: '{"max_tcond":25}', sort_order: 32 },
  { code: 'winter_diff', name: 'Обратный дифференциальный клапан', section: 'winter',
    component_category: null, sizing: 'none', price_eur: 88,
    auto_rule: '{"max_tcond":25}', sort_order: 33 },
  { code: 'receiver_heater', name: 'Подогрев ресивера + прессостат', section: 'winter',
    component_category: null, sizing: 'none', price_eur: 35,
    auto_rule: '{"max_tcond":25}', sort_order: 34 },
  { code: 'liquid_receiver', name: 'Ресивер', section: 'liquid', component_category: 'liquid_receiver',
    sizing: 'capacity', auto_rule: '{"always":true}', mandatory: 1, sort_order: 40 },
  { code: 'liquid_nrv', name: 'Обратный клапан на ресивере', section: 'liquid', component_category: 'check_valve',
    sizing: 'pipe', pipe_line: 'liquid', auto_rule: '{"always":true}', mandatory: 1, sort_order: 41 },
  { code: 'filter_drier', name: 'Фильтр-осушитель DCL (разборный)', section: 'liquid',
    component_category: 'filter_drier', sizing: 'pipe', pipe_line: 'liquid',
    auto_rule: '{"always":true}', mandatory: 1, sort_order: 42 },
  { code: 'drier_insert', name: 'Вставка осушительная', section: 'liquid', component_category: 'drier_insert',
    sizing: 'none', auto_rule: '{"always":true}', mandatory: 1, sort_order: 43 },
  { code: 'sight_glass', name: 'Смотровой глазок', section: 'liquid', component_category: 'sight_glass',
    sizing: 'pipe', pipe_line: 'liquid', auto_rule: '{"always":true}', mandatory: 1, sort_order: 44 },
  { code: 'liquid_ball_valve', name: 'Шаровый кран на выходе агрегата', section: 'liquid',
    component_category: 'ball_valve', sizing: 'pipe', pipe_line: 'liquid',
    auto_rule: '{"always":true}', mandatory: 1, sort_order: 45 },
  { code: 'liquid_separator', name: 'Отделитель жидкости', section: 'suction', component_category: 'liquid_separator',
    sizing: 'capacity', auto_rule: '{"max_tevap":-20}', sort_order: 50 },
  { code: 'suction_filter', name: 'Фильтр разборный с грязевой вставкой', section: 'suction',
    component_category: 'suction_filter', sizing: 'pipe', pipe_line: 'suction',
    auto_rule: '', sort_order: 51 },
  { code: 'suction_ball_valve', name: 'Шаровый кран', section: 'suction', component_category: 'ball_valve',
    sizing: 'pipe', pipe_line: 'suction', auto_rule: '{"always":true}', mandatory: 1, sort_order: 52 },
  { code: 'service_valve', name: 'Шаровый кран перед обратным клапаном ресиверной станции (сервис)',
    section: 'extra', component_category: 'ball_valve', sizing: 'pipe', pipe_line: 'liquid',
    auto_rule: '', sort_order: 60 },
  { code: 'discharge_valve', name: 'Шаровый вентиль на нагнетании на выходе из агрегата',
    section: 'extra', component_category: 'ball_valve', sizing: 'pipe', pipe_line: 'discharge',
    auto_rule: '', sort_order: 61 },
  { code: 'level_switch', name: 'Реле уровня фреона', section: 'extra', component_category: null,
    sizing: 'none', price_eur: 145, auto_rule: '', sort_order: 62 },
  { code: 'solenoid', name: 'Соленоидный вентиль на линии жидкости', section: 'extra',
    component_category: 'ball_valve', sizing: 'pipe', pipe_line: 'liquid',
    auto_rule: '', sort_order: 63 }
];

module.exports = { OPTIONS };
