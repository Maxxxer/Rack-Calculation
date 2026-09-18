/**
 * Оркестратор полного расчета агрегата (структура листа «Спецификация»):
 *  1. Компрессоры (полиномы AHRI) — автоподбор или ручной выбор
 *  2. Трубопроводы (скорости 12/12/1.2 м/с, дюймовые размеры)
 *  3. Опции → BOM с подбором артикулов из каталога
 *  4. Фиксированные позиции (голова отжима, контроллер, шкаф, кондер, винты)
 *  5. Калькуляция цены: материалы + мелочь 5% + работы 30% + профит 15%
 *
 * Автоподбор отдаёт до пяти вариантов, упорядоченных по цене: от самого
 * дешёвого подходящего по холодопроизводительности к самому дорогому. Для
 * каждого варианта считается цена базового состава (стандартная комплектация
 * без дополнительных опций), а полный подбор — трубопроводы, виброгасители,
 * спецификация и итоговая цена — формируется при выборе варианта
 * (input.variant).
 */
'use strict';

const selection = require('./selection');
const piping = require('./piping');
const optionsSvc = require('./options');
const pricing = require('./pricing');
const refr = require('./refrigerants');
const vibration = require('./vibration');
const { db } = require('../db/database');

// Фиксированные позиции спецификации (лист «Спецификация»)
const FIXED_ITEMS = [
  { code: 'FIX-HEAD', name: 'Голова отжима', price_eur: 450 },
  { code: 'FIX-CTRL', name: 'Контроллер', price_eur: 300 },
  { code: 'FIX-BOX', name: 'Шкаф', price_eur: 600 },
  { code: 'FIX-COND', name: 'Кондер', price_eur: 1100 },
  { code: 'FIX-SCREW', name: 'Винты', price_eur: 240 }
];

/** Сколько вариантов автоподбора показывается инженеру */
const VARIANT_COUNT = 5;

/** Проверка исходных данных расчёта */
function assertInput(refrigerant, tEvap, tCond) {
  if (!refrigerant) throw new Error('Не указан хладагент');
  if (tEvap == null || tCond == null) throw new Error('Не указаны температуры кипения/конденсации');
  if (tCond <= tEvap) throw new Error('Температура конденсации должна быть выше температуры кипения');
}

/**
 * Варианты автоподбора для авторежима.
 * Если выбран инвертор, сначала перебираются только модели, рассчитанные на
 * работу с инвертором; когда таких в каталоге нет — возвращаемся к общему
 * списку, а опция будет снята при разрешении опций (с предупреждением).
 */
function resolveVariants(input, tolerancePct) {
  const params = {
    refrigerant: input.refrigerant,
    tEvap: input.tEvap,
    tCond: input.tCond,
    requiredKw: input.requiredKw,
    type: (input.auto && input.auto.type) || 'any',
    manufacturerId: (input.auto && input.auto.manufacturerId) || 'any',
    maxQty: (input.auto && input.auto.maxQty) || 3,
    tolerancePct,
    topN: VARIANT_COUNT
  };
  const inverterRequired = (input.selectedOptions || []).includes('inverter');
  if (!inverterRequired) return selection.autoSelect(params);

  const inverterVariants = selection.autoSelect({ ...params, inverterOnly: true });
  return inverterVariants.length ? inverterVariants : selection.autoSelect(params);
}

/** Краткое описание варианта подбора для карточек выбора */
function describeVariant(variant) {
  return {
    compressorId: variant.compressor.id,
    manufacturer: variant.compressor.manufacturer,
    model: variant.compressor.model,
    type: variant.compressor.type,
    qty: variant.qty,
    totalKw: +variant.totalKw.toFixed(2),
    oversizePct: +variant.oversizePct.toFixed(1),
    withinTolerance: !!variant.withinTolerance,
    priceEur: +variant.priceEur.toFixed(2),
    powerKw: +(variant.powerKw || 0).toFixed(2)
  };
}

/** Цена базового состава варианта: компрессоры + корпус + стандартная комплектация */
function previewPrice(preview) {
  return preview.baseTotalEur != null ? preview.baseTotalEur : preview.priceEur;
}

/**
 * Цена базового состава для каждого варианта — то, с чем инженер сравнивает
 * варианты до нажатия на агрегат. Считается тем же ядром расчёта, что и
 * полный подбор, но без дополнительных опций.
 */
function buildVariantPreviews(input, variants, discountPercent) {
  const baseInput = { ...input, selectedOptions: [] };
  const previews = variants.map(variant => {
    const item = { compressorId: variant.compressor.id, qty: variant.qty };
    let baseTotalEur = null;
    try {
      baseTotalEur = calculateCore(baseInput, item, discountPercent).totals.total_eur;
    } catch (_) {
      baseTotalEur = null; // вариант не считается — цена базового состава неизвестна
    }
    return { ...describeVariant(variant), baseTotalEur };
  });
  previews.sort((a, b) => (previewPrice(a) - previewPrice(b)) || (a.priceEur - b.priceEur));
  return previews;
}

/**
 * Ядро расчёта для уже выбранного набора компрессоров.
 * @param {Object} input — нормализованный вход (см. services/calcInput.js)
 * @param {Object} chosenItem { compressorId, qty }
 */
function calculateCore(input, chosenItem, discountPercent = 0) {
  const {
    refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0,
    requiredKw = 0, housingCode = null
  } = input;

  // 1. Компрессоры
  const sel = selection.evaluateSelection({
    refrigerant, tEvap, tCond, items: [chosenItem]
  });

  // Отклонение подобранной мощности от требуемой. Для ручного выбора режима
  // требуемая мощность может быть не задана — тогда показывать нечего.
  const deviationPct = requiredKw > 0
    ? +((sel.totals.q_kw / requiredKw - 1) * 100).toFixed(1)
    : null;

  // 2. Трубопроводы
  const pipes = piping.calcPiping({ refrigerant, tEvap, tCond, dTsh, dTsc, items: sel.items });
  const pipeSizes = {
    suction: pipes.common.suction.recommended.size_in,
    discharge: pipes.common.discharge.recommended.size_in,
    liquid: pipes.common.liquid.recommended.size_in
  };

  // 3. Виброгасители: индивидуально на каждый компрессор,
  //    раздельно для линии всасывания и линии нагнетания
  const vibrationPlans = vibration.planAll({
    compressors: sel.items, refrigerant, tEvap, tCond, dTsh, dTsc
  });

  // 4. Опции → BOM
  const ctx = {
    refrigerant, tEvap, tCond, dTsh, dTsc,
    totalKw: sel.totals.q_kw,
    totalCompressors: sel.items.reduce((s, i) => s + i.qty, 0),
    compressorTypes: [...new Set(sel.items.map(i => i.type))],
    allInverterCapable: sel.items.every(i => selection.compressorSupportsInverter(i)),
    pipeSizes,
    compressors: sel.items,
    vibrationPlans
  };
  const opts = optionsSvc.resolveOptions(ctx, input.selectedOptions || []);

  // 5. Корпус — ровно одна позиция: выбранный в форме, иначе первый из каталога.
  let housing = housingCode
    ? db.prepare("SELECT * FROM components WHERE category = 'housing' AND code = ?").get(housingCode)
    : null;
  if (!housing) {
    housing = db.prepare(`SELECT * FROM components
                          WHERE category = 'housing' AND active = 1
                          ORDER BY size_in, capacity_kw, id`).get();
  }
  const housingItem = housing ? {
    option_code: 'housing', section: 'housing',
    article: housing.code, name: `Корпус ${housing.code}`, qty: 1,
    unit_price_eur: housing.price_eur, total_price_eur: housing.price_eur,
    mandatory: true, auto: !housingCode, selected: !!housingCode
  } : null;

  // 6. Фиксированные позиции
  const fixedItems = FIXED_ITEMS.map(f => ({
    option_code: f.code, section: 'fixed',
    article: f.code, name: f.name, qty: 1,
    unit_price_eur: f.price_eur, total_price_eur: f.price_eur,
    mandatory: true, auto: false, selected: true
  }));

  // 7. Полная BOM
  const bom = [
    ...sel.items.map(c => ({
      option_code: 'compressor', section: 'compressors',
      article: c.model, name: `Компрессор ${c.manufacturer} ${c.model}`, qty: c.qty,
      unit_price_eur: c.price_eur, total_price_eur: c.total_price_eur,
      mandatory: true, auto: false, selected: true
    })),
    ...(housingItem ? [housingItem] : []),
    ...fixedItems,
    ...opts.items
  ];
  const materials = bom.reduce((s, i) => s + i.total_price_eur, 0);

  // 8. Цены
  const totals = pricing.computeTotals(materials, discountPercent);

  // 9. Свойства хладагента (4 точки цикла)
  const cycle = refr.cyclePoints(refrigerant, tEvap, tCond, dTsh, dTsc);

  return {
    input,
    cycle,
    selection: sel,
    piping: pipes,
    vibration: vibrationPlans,
    options: opts,
    bom,
    totals,
    deviationPct,
    warnings: [...opts.warnings, ...vibrationPlans.warnings]
  };
}

/**
 * Полный расчет.
 * @param {Object} input
 *  refrigerant, tEvap, tCond, dTsh (перегрев, К), dTsc (переохлаждение, К),
 *  requiredKw, tolerancePct (допуск попадания в требуемую мощность, %),
 *  housingCode (артикул корпуса или null),
 *  mode: 'auto' | 'manual',
 *  auto: { type, manufacturerId, maxQty },
 *  manual: { compressorId, qty },
 *  variant: { compressorId, qty } — выбранный вариант автоподбора,
 *  selectedOptions: [codes]
 */
function runCalculation(input, discountPercent = 0) {
  const { refrigerant, tEvap, tCond, requiredKw = 0 } = input;
  const tolerancePct = selection.normalizeTolerancePct(input.tolerancePct);
  assertInput(refrigerant, tEvap, tCond);

  const selectedOptions = Array.isArray(input.selectedOptions) ? input.selectedOptions : [];
  const normalizedInput = { ...input, tolerancePct, selectedOptions };

  const manual = input.mode === 'manual' && input.manual && input.manual.compressorId
    ? { compressorId: input.manual.compressorId, qty: input.manual.qty || 1 }
    : null;

  let variants = null;
  let chosenItem = manual;
  if (!chosenItem) {
    variants = resolveVariants(normalizedInput, tolerancePct);
    if (!variants.length) {
      throw new Error('Не найдено подходящих компрессоров: проверьте каталог и режим работы');
    }
    const pinned = normalizedInput.variant && normalizedInput.variant.compressorId
      ? { compressorId: normalizedInput.variant.compressorId, qty: normalizedInput.variant.qty || 1 }
      : null;
    const first = variants[0];
    chosenItem = pinned || { compressorId: first.compressor.id, qty: first.qty };
  }

  const result = calculateCore(normalizedInput, chosenItem, discountPercent);

  // Замечание о непопадании в допуск имеет смысл только для автоподбора
  const warnings = [];
  if (variants && result.deviationPct != null && Math.abs(result.deviationPct) > tolerancePct) {
    const sign = result.deviationPct > 0 ? '+' : '';
    warnings.push(
      `Подобранные компрессоры дают ${sign}${result.deviationPct} % к требуемой мощности. ` +
      `В допуск ±${tolerancePct} % попасть не удалось — показан ближайший возможный вариант.`
    );
  }
  result.warnings = [...warnings, ...result.warnings];

  if (variants) {
    result.alternatives = variants.map(describeVariant);
    result.selectedVariant = { ...chosenItem };
    result.variantPreviews = buildVariantPreviews(normalizedInput, variants, discountPercent);
  }

  return result;
}

module.exports = { runCalculation, FIXED_ITEMS, VARIANT_COUNT };
