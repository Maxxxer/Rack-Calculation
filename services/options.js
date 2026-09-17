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

/** Позиции BOM по виброгасителям одной линии (по одному на каждый компрессор) */
function vibrationItems(opt, ctx, flags) {
  const plan = resolveVibrationPlan(ctx, opt.pipe_line);
  return plan.bomItems.map(entry => ({
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
  }));
}

/** Подбор компонента для опций, размер которых определяется диаметром линии */
function pipeSizedComponent(opt, ctx, scaleQty) {
  const size = (ctx.pipeSizes && ctx.pipeSizes[opt.pipe_line]) || 0;
  const component = pickComponent(opt.component_category, { sizeIn: size });
  const qty = scaleQty ? Math.max(1, ctx.totalCompressors || 1) : 1;
  return { component, qty };
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
  const items = [];
  const warnings = [];

  for (const opt of opts) {
    let rule = null;
    try { rule = opt.auto_rule ? JSON.parse(opt.auto_rule) : null; } catch (_) { /* ignore */ }
    const auto = ruleMatches(rule, ctx);
    const selected = selectedCodes.includes(opt.code);
    const mandatory = !!opt.mandatory;
    if (!(mandatory || selected || auto)) continue;

    if (auto && !selected && !mandatory) {
      warnings.push(`«${opt.name}» рекомендована для выбранного режима — проверьте включение.`);
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

  return { items, warnings };
}

module.exports = { resolveOptions, ruleMatches, pickComponent, ratedCapacity, kvrFactor };
