/**
 * Ценообразование. Структура калькуляции (лист «Спецификация»):
 *   Материалы (сумма позиций) + Мелочь (5%) + Работы (30%) + Профит (15%)
 *   = Итого без НДС. Валюта EUR, без НДС.
 * Скидка клиента применяется к итогу.
 */
'use strict';

const FACTORS = {
  petty_pct: 0.05,   // Мелочь, % от материалов
  labor_pct: 0.30,   // Работы, % от материалов
  profit_pct: 0.15   // Профит, % от материалов
};

/**
 * @param {number} materialsEur — сумма материалов (компрессоры + компоненты + фиксированные)
 * @param {number} discountPercent — клиентская скидка, %
 */
function computeTotals(materialsEur, discountPercent = 0) {
  const materials = +materialsEur.toFixed(2);
  const petty = +(materials * FACTORS.petty_pct).toFixed(2);
  const labor = +(materials * FACTORS.labor_pct).toFixed(2);
  const profit = +(materials * FACTORS.profit_pct).toFixed(2);
  const subtotal = +(materials + petty + labor + profit).toFixed(2);

  const discount = Math.min(Math.max(discountPercent || 0, 0), 100);
  const discountAmount = +(subtotal * discount / 100).toFixed(2);
  const total = +(subtotal - discountAmount).toFixed(2);

  return {
    materials_eur: materials,
    petty_pct: FACTORS.petty_pct * 100,
    petty_eur: petty,
    labor_pct: FACTORS.labor_pct * 100,
    labor_eur: labor,
    profit_pct: FACTORS.profit_pct * 100,
    profit_eur: profit,
    subtotal_eur: subtotal,
    discount_percent: discount,
    discount_amount_eur: discountAmount,
    total_eur: total,
    currency: 'EUR',
    vat_note: 'Цены указаны без НДС'
  };
}

/** Номер КП: KP-ГГГГ-NNNN */
function nextQuoteNumber() {
  const { db } = require('../db/database');
  const year = new Date().getFullYear();
  const prefix = `KP-${year}-`;
  const row = db.prepare('SELECT number FROM quotes WHERE number LIKE ? ORDER BY id DESC LIMIT 1').get(prefix + '%');
  let n = 0;
  if (row) n = parseInt(row.number.slice(prefix.length), 10) || 0;
  return prefix + String(n + 1).padStart(4, '0');
}

module.exports = { computeTotals, nextQuoteNumber, FACTORS };