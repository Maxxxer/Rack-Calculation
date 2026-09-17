/**
 * Оркестратор полного расчета агрегата (структура листа «Спецификация»):
 *  1. Компрессоры (полиномы AHRI) — автоподбор или ручной выбор
 *  2. Трубопроводы (скорости 12/12/1.2 м/с, дюймовые размеры)
 *  3. Опции → BOM с подбором артикулов из каталога
 *  4. Фиксированные позиции (голова отжима, контроллер, шкаф, кондер, винты)
 *  5. Калькуляция цены: материалы + мелочь 5% + работы 30% + профит 15%
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

/**
 * Полный расчет.
 * @param {Object} input
 *  refrigerant, tEvap, tCond, dTsh (перегрев, К), dTsc (переохлаждение, К),
 *  requiredKw, housingCode (артикул корпуса или null),
 *  mode: 'auto' | 'manual',
 *  auto: { type, manufacturerId, maxQty },
 *  manual: { compressorId, qty },
 *  selectedOptions: [codes]
 */
function runCalculation(input, discountPercent = 0) {
  const {
    refrigerant, tEvap, tCond, dTsh = 10, dTsc = 0,
    requiredKw = 0, housingCode = null
  } = input;

  if (!refrigerant) throw new Error('Не указан хладагент');
  if (tEvap == null || tCond == null) throw new Error('Не указаны температуры кипения/конденсации');
  if (tCond <= tEvap) throw new Error('Температура конденсации должна быть выше температуры кипения');

  // 1. Компрессоры
  let chosen;
  if (input.mode === 'manual' && input.manual && input.manual.compressorId) {
    chosen = { items: [{ compressorId: input.manual.compressorId, qty: input.manual.qty || 1 }] };
  } else {
    const variants = selection.autoSelect({
      refrigerant, tEvap, tCond, requiredKw,
      type: (input.auto && input.auto.type) || 'any',
      manufacturerId: (input.auto && input.auto.manufacturerId) || 'any',
      maxQty: (input.auto && input.auto.maxQty) || 3,
      topN: 5
    });
    if (!variants.length) throw new Error('Не найдено подходящих компрессоров: проверьте каталог и режим работы');
    chosen = { items: [{ compressorId: variants[0].compressor.id, qty: variants[0].qty }], alternatives: variants };
  }

  // 2. Пересчет характеристик
  const sel = selection.evaluateSelection({ refrigerant, tEvap, tCond, items: chosen.items });

  // 3. Трубопроводы
  const pipes = piping.calcPiping({ refrigerant, tEvap, tCond, dTsh, dTsc, items: sel.items });
  const pipeSizes = {
    suction: pipes.common.suction.recommended.size_in,
    discharge: pipes.common.discharge.recommended.size_in,
    liquid: pipes.common.liquid.recommended.size_in
  };

  // 4. Виброгасители: индивидуально на каждый компрессор,
  //    раздельно для линии всасывания и линии нагнетания
  const vibrationPlans = vibration.planAll({
    compressors: sel.items, refrigerant, tEvap, tCond, dTsh, dTsc
  });

  // 5. Опции → BOM
  const ctx = {
    refrigerant, tEvap, tCond, dTsh, dTsc,
    totalKw: sel.totals.q_kw,
    totalCompressors: sel.items.reduce((s, i) => s + i.qty, 0),
    compressorTypes: [...new Set(sel.items.map(i => i.type))],
    pipeSizes,
    compressors: sel.items,
    vibrationPlans
  };
  const opts = optionsSvc.resolveOptions(ctx, input.selectedOptions || []);

  // 6. Корпус
  let housing = null;
  if (housingCode) {
    housing = db.prepare("SELECT * FROM components WHERE category = 'housing' AND code = ?").get(housingCode);
  }
  const housingItem = housing ? {
    option_code: 'housing', section: 'housing',
    article: housing.code, name: `Корпус ${housing.code}`, qty: 1,
    unit_price_eur: housing.price_eur, total_price_eur: housing.price_eur,
    mandatory: true, auto: false, selected: true
  } : null;

  // 7. Фиксированные позиции
  const fixedItems = FIXED_ITEMS.map(f => ({
    option_code: f.code, section: 'fixed',
    article: f.code, name: f.name, qty: 1,
    unit_price_eur: f.price_eur, total_price_eur: f.price_eur,
    mandatory: true, auto: false, selected: true
  }));

  // 8. Полная BOM
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

  // 9. Цены
  const totals = pricing.computeTotals(materials, discountPercent);

  // 10. Свойства хладагента (4 точки цикла)
  const cycle = refr.cyclePoints(refrigerant, tEvap, tCond, dTsh, dTsc);

  return {
    input: { ...input },
    cycle,
    selection: sel,
    piping: pipes,
    vibration: vibrationPlans,
    options: opts,
    bom,
    totals,
    warnings: [...opts.warnings, ...vibrationPlans.warnings]
  };
}

module.exports = { runCalculation, FIXED_ITEMS };
