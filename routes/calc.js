/**
 * Маршруты мастера расчета: форма ввода, автоподбор/ручной выбор,
 * опции чекбоксами, результат.
 *
 * Последние введённые значения (окна 01 «Режим работы», 02 «Компрессоры»,
 * 03 «Опции») сохраняются персонально для учётной записи и подставляются при
 * следующем открытии калькулятора.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { runCalculation, VARIANT_COUNT } = require('../services/calc');
const { autoSelect, normalizeTolerancePct } = require('../services/selection');
const { parseCalculationInput } = require('../services/calcInput');
const { loadInput, saveInput } = require('../services/calcState');

const router = express.Router();

// Справочники для формы
function getFormData() {
  return {
    refrigerants: db.prepare('SELECT * FROM refrigerants WHERE active = 1 ORDER BY code').all(),
    manufacturers: db.prepare('SELECT * FROM manufacturers ORDER BY name').all(),
    housings: db.prepare("SELECT * FROM components WHERE category = 'housing' AND active = 1 ORDER BY code").all(),
    options: db.prepare('SELECT * FROM options WHERE active = 1 ORDER BY sort_order, id').all(),
    variantCount: VARIANT_COUNT
  };
}

router.get('/', (req, res) => {
  // Прошлые значения пользователя: окна 1–3 заполняются ими, а не пустой формой
  const saved = loadInput(res.locals.user.id);
  res.render('calc', { ...getFormData(), result: null, error: null, form: saved || {} });
});

// Расчет (POST из формы)
router.post('/', (req, res) => {
  const input = parseCalculationInput(req.body);
  // Сохраняем введённые значения до расчёта: даже при ошибке подбора
  // пользователь возвращается к своим параметрам, а не к пустой форме.
  saveInput(res.locals.user.id, input);

  try {
    const result = runCalculation(input, res.locals.user.discount_percent);
    res.render('calc', { ...getFormData(), result, error: null, form: input });
  } catch (e) {
    res.render('calc', { ...getFormData(), result: null, error: e.message, form: input });
  }
});

// API: варианты автоподбора (для динамического обновления)
router.post('/api/variants', (req, res) => {
  try {
    const { refrigerant, tEvap, tCond, requiredKw, type, manufacturerId, maxQty } = req.body;
    const variants = autoSelect({
      refrigerant,
      tEvap: parseFloat(tEvap),
      tCond: parseFloat(tCond),
      requiredKw: parseFloat(requiredKw) || 0,
      type: type || 'any',
      manufacturerId: manufacturerId || 'any',
      maxQty: parseInt(maxQty, 10) || 3,
      tolerancePct: normalizeTolerancePct(req.body.tolerancePct),
      inverterOnly: req.body.inverter === '1' || req.body.inverter === 'on',
      topN: VARIANT_COUNT
    });
    res.json({
      variants: variants.map(v => ({
        compressorId: v.compressor.id,
        manufacturer: v.compressor.manufacturer,
        model: v.compressor.model,
        type: v.compressor.type,
        qty: v.qty,
        totalKw: +v.totalKw.toFixed(2),
        oversizePct: +v.oversizePct.toFixed(1),
        priceEur: v.priceEur
      }))
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// API: список компрессоров для ручного выбора (с фильтром по типу и производителю).
// Тип и признак поддержки инвертора нужны форме, чтобы предлагать только те
// опции, которые применимы к выбранной модели.
router.get('/api/compressors', (req, res) => {
  const { refrigerant, type, manufacturer } = req.query;
  let sql = `
    SELECT c.id, c.model, c.type, c.refrigerant_code, c.price_eur,
           c.inverter_capable, m.name AS manufacturer
    FROM compressors c JOIN manufacturers m ON m.id = c.manufacturer_id
    WHERE c.active = 1 AND LOWER(c.refrigerant_code) = LOWER(?)`;
  const args = [refrigerant || ''];
  if (type && type !== 'any') { sql += ' AND c.type = ?'; args.push(type); }
  if (manufacturer && manufacturer !== 'any') { sql += ' AND c.manufacturer_id = ?'; args.push(manufacturer); }
  sql += ' ORDER BY m.name, c.model';
  const rows = db.prepare(sql).all(...args);
  res.json({ compressors: rows });
});

module.exports = router;
