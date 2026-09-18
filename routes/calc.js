/**
 * Маршруты мастера расчета: форма ввода, автоподбор/ручной выбор,
 * опции чекбоксами, результат.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { runCalculation } = require('../services/calc');
const { autoSelect, normalizeTolerancePct } = require('../services/selection');

const router = express.Router();

// Справочники для формы
function getFormData() {
  return {
    refrigerants: db.prepare('SELECT * FROM refrigerants WHERE active = 1 ORDER BY code').all(),
    manufacturers: db.prepare('SELECT * FROM manufacturers ORDER BY name').all(),
    housings: db.prepare("SELECT * FROM components WHERE category = 'housing' AND active = 1 ORDER BY code").all(),
    options: db.prepare('SELECT * FROM options WHERE active = 1 ORDER BY sort_order, id').all()
  };
}

router.get('/', (req, res) => {
  res.render('calc', { ...getFormData(), result: null, error: null, form: {} });
});

// Расчет (POST из формы)
router.post('/', (req, res) => {
  try {
    const b = req.body;
    const input = {
      refrigerant: b.refrigerant,
      tEvap: parseFloat(b.tEvap),
      tCond: parseFloat(b.tCond),
      dTsh: parseFloat(b.dTsh) || 10,
      dTsc: parseFloat(b.dTsc) || 0,
      requiredKw: parseFloat(b.requiredKw) || 0,
      tolerancePct: normalizeTolerancePct(b.tolerancePct),
      housingCode: b.housingCode || null,
      mode: b.mode === 'manual' ? 'manual' : 'auto',
      auto: {
        type: b.autoType || 'any',
        manufacturerId: b.autoManufacturer || 'any',
        maxQty: b.autoMaxQty ? parseInt(b.autoMaxQty, 10) : 3
      },
      manual: {
        type: b.manualType || 'any',
        manufacturerId: b.manualManufacturer || 'any',
        compressorId: b.compressorId ? parseInt(b.compressorId, 10) : null,
        qty: b.compressorQty ? parseInt(b.compressorQty, 10) : 1
      },
      selectedOptions: Array.isArray(b.options) ? b.options : (b.options ? [b.options] : [])
    };
    const result = runCalculation(input, res.locals.user.discount_percent);
    res.render('calc', { ...getFormData(), result, error: null, form: input });
  } catch (e) {
    res.render('calc', { ...getFormData(), result: null, error: e.message, form: req.body });
  }
});

// API: варианты автоподбора (для динамического обновления)
router.post('/api/variants', (req, res) => {
  try {
    const { refrigerant, tEvap, tCond, requiredKw, type, manufacturerId, maxQty } = req.body;
    const variants = autoSelect({
      refrigerant, tEvap: parseFloat(tEvap), tCond: parseFloat(tCond),
      requiredKw: parseFloat(requiredKw) || 0,
      type: type || 'any',
      manufacturerId: manufacturerId || 'any',
      maxQty: parseInt(maxQty, 10) || 3,
      tolerancePct: normalizeTolerancePct(req.body.tolerancePct),
      topN: 5
    });
    res.json({
      variants: variants.map(v => ({
        compressorId: v.compressor.id,
        manufacturer: v.compressor.manufacturer,
        model: v.compressor.model,
        qty: v.qty,
        totalKw: v.totalKw,
        oversizePct: +v.oversizePct.toFixed(1),
        priceEur: v.priceEur
      }))
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// API: список компрессоров для ручного выбора (с фильтром по типу и производителю)
router.get('/api/compressors', (req, res) => {
  const { refrigerant, type, manufacturer } = req.query;
  let sql = `
    SELECT c.id, c.model, c.type, c.refrigerant_code, c.price_eur, m.name AS manufacturer
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
