/**
 * Опции агрегата: правила автовключения и подбор компонентов из каталога.
 *
 * Структура повторяет лист «Спецификация» (Калькулятор Ultima_Prime_DB.xlsx):
 *  - фиксированные позиции (голова отжима, контроллер, шкаф, кондер, винты)
 *  - корпус, шумоизоляция
 *  - виброгасители — индивидуально на каждый компрессор, раздельно для линии
 *    всасывания и линии нагнетания (размер по патрубку КМ, а при отсутствии
 *    данных — по скорости хладагента и индивидуальной производительности)
 *  - обратные клапаны после КМ (по диаметру магистрали нагнетания)
 *  - линия нагнетания: маслоотделитель, масляный ресивер, ЭРУМ
 *  - зимняя опция: KVR+NRD+NRV, клапан поддержания давления до себя,
 *    обратный клапан на сливе, обратный дифференциальный клапан
 *  - жидкостная линия: ресивер, обратный клапан, фильтр-осушитель DCL,
 *    вставка, смотровой глазок, шаровый кран
 *  - линия всасывания: отделитель жидкости, фильтр SDF, шаровый кран
 *  - доп. опции: сервисный кран, вентиль на нагнетании, реле уровня, соленоид
 *
 * sizing (см. db/optionDefinitions.js):
 *  'pipe'                — подбор по диаметру линии, одна позиция на агрегат
 *  'pipe_per_compressor' — подбор по диаметру линии, количество = число КМ
 *  'per_compressor'      — подбор индивидуально по каждому компрессору
 *  'capacity'            — подбор по холодопроизводительности
 *  'none'                — фиксированная цена без компонента
 *
 * auto_rule — JSON:
 *  { "always": true, "max_tevap": -35, "min_tevap": 0, "min_compressors": 2,
 *    "compressor_types": ["screw"], "refrigerants": ["R717"],
 *    "min_kw": 50, "max_kw": 100, "max_tcond": 25 }
 *
 * mandatory_rule — то же правило, но при его выполнении опция становится
 * обязательной: убирается из окна «Опции» и переносится в «Стандартную
 * комплектацию» (маслоотделитель, масляный ресивер и регуляторы уровня масла
 * при двух и более спиральных или поршневых компрессорах).
 * qty_per_compressor — количество позиции равно числу компрессоров.
 */
'use strict';

const { db } = require('../db/database');
const vibration = require('./vibration');

/** Проверка правила автовключения */
function ruleMatches(rule, ctx) {
  if (!rule) return false;
  if (rule.always) return true;
  if (rule.max_tevap != null && !(ctx.tEvap <= rule.max_tevap)) return false;
  if (rule.min_tevap != null && !(ctx.tEvap >= rule.min_tevap)) return false;
  if (rule.max_tcond != null && !(ctx.tCond <= rule.max_tcond)) return false;
  if (rule.min_compressors != null && !(ctx.totalCompressors >= rule.min_compressors)) return false;
  if (rule.compressor_types && !ctx.compressorTypes.some(t => rule.compressor_types.includes(t))) return false;
  if (rule.refrigerants && !rule.refrigerants.some(r => r.toLowerCase() === String(ctx.refrigerant).toLowerCase())) return false;
  if (rule.min_kw != null && !(ctx.totalKw >= rule.min_kw)) return false;
  if (rule.max_kw != null && !(ctx.totalKw <= rule.max_kw)) return false;
  return true;
}

/**
 * Подбор компонента из каталога.
 * @param {string} category — категория каталога
 * @param {Object} p { sizeIn, capacityKw, refrigerant, tEvap, tCond }
 *  sizeIn — минимальный присоединительный размер (дюймы) для sizing=pipe
 *  capacityKw — требуемая производительность для sizing=capacity
 */
function pickComponent(category, { sizeIn = 0, capacityKw = 0, refrigerant, tEvap = 0, tCond = 40 } = {}) {
  const items = db.prepare(
    'SELECT * FROM components WHERE category = ? AND active = 1 ORDER BY size_in, capacity_kw'
  ).all(category);
  if (!items.length) return null;

  // sizing по диаметру: первый компонент с size_in >= требуемого
  if (sizeIn > 0) {
    const bySize = items.find(c => c.size_in != null && c.size_in >= sizeIn - 1e-9);
    if (bySize) return bySize;
    return items[items.length - 1]; // самый большой
  }

  // sizing по производительности: с поправкой на tкип (capacity_kw при t=10, capacity_kw2 при t=-30)
  if (capacityKw > 0) {
    const withCap = items.filter(c => (c.capacity_kw || 0) > 0);
    for (const c of withCap) {
      const cap = ratedCapacity(c, tEvap);
      if (cap >= capacityKw) return c;
    }
    return withCap[withCap.length - 1] || null;
  }
  return items[0];
}

/** Референсная производительность компонента с поправкой на tкип (интерполяция 10°C ↔ -30°C) */
function ratedCapacity(comp, tEvap) {
  const c1 = comp.capacity_kw || 0, c2 = comp.capacity_kw2 != null ? comp.capacity_kw2 : c1;
  if (c2 === c1) return c1;
  const f = Math.min(Math.max((10 - tEvap) / 40, 0), 1); // 0 при t=10, 1 при t=-30
  return c1 + f * (c2 - c1);
}

/** Поправочный коэффициент клапанов KVR по tконд (лист KVR) */
function kvrFactor(tCond, refrigerant) {
  const T0 = [-40, -30, -20, -10, 0, 10];
  const isR134 = String(refrigerant).toLowerCase() === 'r134a';
  const factors = isR134 ? [1.14, 1.09, 1.04, 1, 0.96, 0.93] : [1.18, 1.11, 1.05, 1, 0.95, 0.92];
  if (tCond <= T0[0]) return factors[0];
  if (tCond >= T0[T0.length - 1]) return factors[factors.length - 1];
  for (let i = 0; i < T0.length - 1; i++) {
    if (tCond >= T0[i] && tCond <= T0[i + 1]) {
      const f = (tCond - T0[i]) / (T0[i + 1] - T0[i]);
      return factors[i] + f * (factors[i + 1] - factors[i]);
    }
  }
  return 1;
}

/**
 * План подбора виброгасителей для линии.
 * Если расчёт уже выполнен оркестратором (ctx.vibrationPlans) — переиспользуем его,
 * чтобы спецификация и таблица результатов совпадали.
 */
function resolveVibrationPlan(ctx, line) {
  const cached = ctx.vibrationPlans && ctx.vibrationPlans[line];
  if (cached) return cached;
  return vibration.planLine({
    kind: line,
    compressors: ctx.compressors || [],
    refrigerant: ctx.refrigerant,
    tEvap: ctx.tEvap,
    tCond: ctx.tCond,
    dTsh: ctx.dTsh,
    dTsc: ctx.dTsc
  });
}

// Виброгасители: если у опции не задана конкретная линия, позиции подбираются
// и на всасывании, и на нагнетании (одна опция — обе линии).
const VIBRATION_LINES = ['suction', 'discharge'];

/**
 * Позиции BOM по виброгасителям: по одному на каждый компрессор отдельно для
 * каждой линии. Наименование берётся из подбора (vibration.aggregate) — в нём
 * указаны линия, артикул и присоединительный размер, поэтому позиции линий
 * различаются, даже когда артикул совпадает.
 */
function vibrationItems(opt, ctx, flags) {
  const lines = opt.pipe_line ? [opt.pipe_line] : VIBRATION_LINES;
  const items = [];
  for (const line of lines) {
    const plan = resolveVibrationPlan(ctx, line);
    for (const entry of plan.bomItems) {
      items.push({
        option_code: opt.code,
        section: opt.section,
        component_category: opt.component_category,
        article: entry.article,
        name: entry.name,
        qty: entry.qty,
        unit_price_eur: +entry.price_eur.toFixed(2),
        total_price_eur: +(entry.price_eur * entry.qty).toFixed(2),
        mandatory: flags.mandatory,
        auto: flags.auto,
        selected: flags.selected
      });
    }
  }
  return items;
}

/** Подбор компонента для опций, размер которых определяется диаметром линии */
function pipeSizedComponent(opt, ctx, scaleQty) {
  const size = (ctx.pipeSizes && ctx.pipeSizes[opt.pipe_line]) || 0;
  const component = pickComponent(opt.component_category, { sizeIn: size });
  const qty = scaleQty ? Math.max(1, ctx.totalCompressors || 1) : 1;
  return { component, qty };
}

/** Список типов компрессоров из поля allowed_types ('recip,screw') */
function parseTypeList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

const COMPRESSOR_TYPE_LABELS = { scroll: 'спиральные', screw: 'винтовые', recip: 'поршневые' };

/** Подпись типов компрессоров для предупреждений */
function describeCompressorTypes(ctx) {
  const types = ctx.compressorTypes || [];
  if (!types.length) return 'тип не определён';
  return types.map(t => COMPRESSOR_TYPE_LABELS[t] || t).join(', ');
}

/**
 * Доступность опции для подобранных компрессоров.
 * allowed_types — типы, для которых опция вообще существует (пусто — любые);
 * inverter_only — для спиральных нужна модель, рассчитанная на инвертор
 * (у поршневых и винтовых инвертор внешний, ограничение не действует).
 */
function optionAvailableForCompressors(opt, ctx) {
  const allowed = parseTypeList(opt.allowed_types);
  if (allowed.length && !(ctx.compressorTypes || []).every(t => allowed.includes(t))) return false;
  if (opt.inverter_only && ctx.allInverterCapable === false) return false;
  return true;
}

/** Разбор JSON-правила из поля опции; пустое или битое значение — null */
function parseRule(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

// Коды опций, заменённых при развитии справочника: в сохранённых состояниях
// формы и в старых КП могли остаться прежние значения. Приводим их к текущим.
const RENAMED_CODES = {
  vibration_suction: 'vibration',
  vibration_discharge: 'vibration'
};

/** Приведение списка кодов опций к текущему справочнику (без дублей) */
function normalizeOptionCodes(codes) {
  const normalized = new Set();
  for (const code of codes || []) {
    if (!code) continue;
    normalized.add(RENAMED_CODES[code] || code);
  }
  return [...normalized];
}

/**
 * Опция обязательна для подобранных компрессоров.
 * Кроме статического признака mandatory учитывается mandatory_rule: при двух и
 * более спиральных или поршневых компрессорах маслоотделитель, масляный
 * ресивер и регуляторы уровня масла входят в базовый состав агрегата.
 */
function optionMandatory(opt, ctx) {
  if (opt.mandatory) return true;
  return ruleMatches(parseRule(opt.mandatory_rule), ctx);
}

/**
 * Разрешение опций в позиции BOM.
 * @param {Object} ctx { refrigerant, tEvap, tCond, dTsh, dTsc, totalKw, totalCompressors,
 *                        compressorTypes, pipeSizes: {suction, discharge, liquid},
 *                        compressors: [позиции подбора], vibrationPlans }
 * @param {string[]} selectedCodes — коды, отмеченные пользователем
 * @returns {Object} { items, warnings }
 */
function resolveOptions(ctx, selectedCodes = []) {
  const opts = db.prepare('SELECT * FROM options WHERE active = 1 ORDER BY sort_order, id').all();
  const chosen = normalizeOptionCodes(selectedCodes);
  const items = [];
  const warnings = [];
  // Состояние каждой опции для формы: доступность для выбранного типа
  // компрессоров и обязательность (окно «Опции» или базовый состав)
  const states = {};

  for (const opt of opts) {
    // Корпус выбирается в форме (или подбирается оркестратором) отдельно —
    // здесь он не обрабатывается, иначе позиция попала бы в BOM дважды.
    if (opt.code === 'housing') continue;

    const available = optionAvailableForCompressors(opt, ctx);
    const mandatory = optionMandatory(opt, ctx);
    states[opt.code] = { available, mandatory };

    const auto = ruleMatches(parseRule(opt.auto_rule), ctx);
    const selected = chosen.includes(opt.code);
    if (!(mandatory || selected || auto)) continue;

    // Обязательная позиция и так входит в базовый состав — предупреждать не о чем
    if (auto && !selected && !mandatory) {
      warnings.push(`«${opt.name}» рекомендована для выбранного режима — проверьте включение.`);
    }

    // Опция существует не под все типы компрессоров: отжим клапанов — только
    // поршневые; инвертор — поршневые и винтовые, а у спиральных только модели
    // с поддержкой инвертора; масляный ресивер и регуляторы уровня масла —
    // только спиральные и поршневые (у винтовых масло охлаждается в контуре
    // компрессора маслоохладителем через термостат ORV).
    if (!available) {
      if (selected) {
        warnings.push(`«${opt.name}» недоступна для выбранных компрессоров (${describeCompressorTypes(ctx)}) — позиция не включена в спецификацию.`);
      }
      continue;
    }

    // Виброгасители: подбор индивидуально по каждому компрессору,
    // отдельно линия всасывания и линия нагнетания
    if (opt.sizing === 'per_compressor') {
      items.push(...vibrationItems(opt, ctx, { mandatory, auto, selected }));
      continue;
    }

    // Подбор компонента
    let component = null;
    let qty = 1;
    if (opt.component_category) {
      if (opt.sizing === 'pipe' && opt.pipe_line) {
        ({ component, qty } = pipeSizedComponent(opt, ctx, false));
      } else if (opt.sizing === 'pipe_per_compressor' && opt.pipe_line) {
        ({ component, qty } = pipeSizedComponent(opt, ctx, true));
      } else if (opt.sizing === 'capacity') {
        let need = ctx.totalKw;
        if (opt.component_category === 'kvr_valve') {
          need = ctx.totalKw * kvrFactor(ctx.tCond, ctx.refrigerant);
        }
        component = pickComponent(opt.component_category, { capacityKw: need, tEvap: ctx.tEvap });
      } else {
        component = pickComponent(opt.component_category, {});
      }
    }

    // Регуляторы уровня масла берутся по одному на каждый компрессор
    if (opt.qty_per_compressor) qty = Math.max(1, ctx.totalCompressors || 1);

    const price = component ? component.price_eur : (opt.price_eur || 0);
    const code = component ? component.code : (opt.code.toUpperCase());
    const name = component ? `${opt.name} ${component.code}` : opt.name;

    items.push({
      option_code: opt.code, section: opt.section,
      component_category: opt.component_category,
      article: code, name, qty,
      unit_price_eur: +price.toFixed(2),
      total_price_eur: +(price * qty).toFixed(2),
      mandatory, auto, selected
    });
  }

  return { items, warnings, states };
}

module.exports = {
  resolveOptions, ruleMatches, pickComponent, ratedCapacity, kvrFactor,
  optionAvailableForCompressors, optionMandatory, parseRule, parseTypeList,
  normalizeOptionCodes
};
