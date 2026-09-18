/**
 * Маршруты коммерческих предложений: сохранение, список, просмотр,
 * печатная форма КП, производственная спецификация, экспорт CSV, статусы.
 */
'use strict';

const express = require('express');
const { db } = require('../db/database');
const { runCalculation } = require('../services/calc');
const { normalizeTolerancePct } = require('../services/selection');
const { nextQuoteNumber } = require('../services/pricing');

const router = express.Router();

// Сохранить расчет как КП (черновик)
router.post('/save', (req, res) => {
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
      auto: { type: b.autoType || 'any', manufacturerId: b.autoManufacturer || 'any', maxQty: 3 },
      manual: { compressorId: b.compressorId ? parseInt(b.compressorId, 10) : null, qty: parseInt(b.compressorQty, 10) || 1 },
      selectedOptions: Array.isArray(b.options) ? b.options : (b.options ? [b.options] : [])
    };
    const result = runCalculation(input, res.locals.user.discount_percent);
    const number = nextQuoteNumber();
    db.prepare(`
      INSERT INTO quotes (number, user_id, status, input_json, result_json,
        total_eur, discount_percent, total_after_discount_eur)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      number, res.locals.user.id, 'draft',
      JSON.stringify(input), JSON.stringify(result),
      result.totals.subtotal_eur, result.totals.discount_percent, result.totals.total_eur
    );
    res.redirect(`/quotes/${encodeURIComponent(number)}`);
  } catch (e) {
    res.status(400).render('error', { message: e.message });
  }
});

// Список КП пользователя (админ видит все)
router.get('/', (req, res) => {
  const rows = res.locals.user.role === 'admin'
    ? db.prepare(`SELECT q.*, u.name AS user_name FROM quotes q JOIN users u ON u.id = q.user_id ORDER BY q.id DESC`).all()
    : db.prepare(`SELECT q.*, u.name AS user_name FROM quotes q JOIN users u ON u.id = q.user_id WHERE q.user_id = ? ORDER BY q.id DESC`).all(res.locals.user.id);
  res.render('quotes', { quotes: rows });
});

// Просмотр КП
router.get('/:number', (req, res) => {
  const q = db.prepare(`
    SELECT q.*, u.name AS user_name, u.company, u.email, u.discount_percent AS user_discount
    FROM quotes q JOIN users u ON u.id = q.user_id WHERE q.number = ?`).get(req.params.number);
  if (!q) return res.status(404).render('error', { message: 'КП не найдено' });
  if (res.locals.user.role !== 'admin' && q.user_id !== res.locals.user.id) {
    return res.status(403).render('error', { message: 'Нет доступа к этому КП' });
  }
  res.render('quote-view', { q, result: JSON.parse(q.result_json) });
});

// Печатная форма КП
router.get('/:number/print', (req, res) => {
  const q = db.prepare(`
    SELECT q.*, u.name AS user_name, u.company, u.email
    FROM quotes q JOIN users u ON u.id = q.user_id WHERE q.number = ?`).get(req.params.number);
  if (!q) return res.status(404).render('error', { message: 'КП не найдено' });
  res.render('quote-print', { q, result: JSON.parse(q.result_json) });
});

// Производственная спецификация
router.get('/:number/production', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE number = ?').get(req.params.number);
  if (!q) return res.status(404).render('error', { message: 'КП не найдено' });
  if (q.status !== 'approved' && res.locals.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Спецификация доступна после утверждения КП' });
  }
  res.render('production', { q, result: JSON.parse(q.result_json) });
});

// Экспорт производственной спецификации в CSV
router.get('/:number/production.csv', (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE number = ?').get(req.params.number);
  if (!q) return res.status(404).send('КП не найдено');
  if (q.status !== 'approved' && res.locals.user.role !== 'admin') {
    return res.status(403).send('Спецификация доступна после утверждения КП');
  }
  const result = JSON.parse(q.result_json);
  const rows = [['№', 'Артикул', 'Наименование', 'Кол-во', 'Цена EUR', 'Сумма EUR', 'Раздел']];
  result.bom.forEach((it, i) => {
    rows.push([i + 1, it.article, it.name, it.qty, it.unit_price_eur, it.total_price_eur, it.section]);
  });
  const t = result.totals;
  rows.push([], ['', '', 'Материалы', '', '', t.materials_eur, '']);
  rows.push(['', '', `Мелочь ${t.petty_pct}%`, '', '', t.petty_eur, '']);
  rows.push(['', '', `Работы ${t.labor_pct}%`, '', '', t.labor_eur, '']);
  rows.push(['', '', `Профит ${t.profit_pct}%`, '', '', t.profit_eur, '']);
  rows.push(['', '', 'Итого без НДС', '', '', t.subtotal_eur, '']);
  rows.push(['', '', `Скидка ${t.discount_percent}%`, '', '', -t.discount_amount_eur, '']);
  rows.push(['', '', 'ВСЕГО', '', '', t.total_eur, '']);

  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${q.number}_production.csv"`);
  res.send(csv);
});

// Смена статуса КП
router.post('/:number/status', (req, res) => {
  const { status } = req.body;
  if (!['draft', 'sent', 'approved', 'rejected'].includes(status)) {
    return res.status(400).render('error', { message: 'Неверный статус' });
  }
  const q = db.prepare('SELECT * FROM quotes WHERE number = ?').get(req.params.number);
  if (!q) return res.status(404).render('error', { message: 'КП не найдено' });
  // Клиент может только отправить; утверждать/отклонять может админ
  if (res.locals.user.role !== 'admin' && status !== 'sent') {
    return res.status(403).render('error', { message: 'Только администратор может утверждать КП' });
  }
  db.prepare('UPDATE quotes SET status = ?, approved_at = ? WHERE number = ?')
    .run(status, status === 'approved' ? new Date().toISOString() : q.approved_at, req.params.number);
  res.redirect(`/quotes/${encodeURIComponent(req.params.number)}`);
});

module.exports = router;
