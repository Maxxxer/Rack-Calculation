/**
 * Админ-панель: пользователи (одобрение, скидки), импорт каталога из Excel,
 * просмотр справочников.
 *
 * Excel-импорт (формат листов Refcomp_polynom / Xecom_polynom из «База данных.xlsx»):
 *  - строка заголовков с P_C1..P_C10 (Power), A_C.., V_C.., M_C.., C_C1..C_C10 (Capacity)
 *  - колонки: модель, хладагент, Vh, d_всас, d_нагн, Imax, min/max tконд, min/max tкип
 *  - последний столбец — множитель (1000 для Вт; кВт если 1)
 *  - производитель выбирается в форме загрузки
 */
'use strict';

const express = require('express');
const XLSX = require('xlsx');
const { db, normalizePorts } = require('../db/database');

const router = express.Router();

// ---------- Пользователи ----------
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, email, name, company, phone, role, status, discount_percent, created_at FROM users ORDER BY id').all();
  res.render('admin-users', { users, message: req.query.msg || null });
});

router.post('/users/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'rejected', 'pending'].includes(status)) {
    return res.status(400).render('error', { message: 'Неверный статус' });
  }
  db.prepare('UPDATE users SET status = ? WHERE id = ? AND role = ?').run(status, req.params.id, 'client');
  res.redirect('/admin/users?msg=' + encodeURIComponent('Статус обновлен'));
});

router.post('/users/:id/discount', (req, res) => {
  const d = Math.min(Math.max(parseFloat(req.body.discount) || 0, 0), 100);
  db.prepare('UPDATE users SET discount_percent = ? WHERE id = ? AND role = ?').run(d, req.params.id, 'client');
  res.redirect('/admin/users?msg=' + encodeURIComponent('Скидка обновлена'));
});

// ---------- Импорт компрессоров из Excel ----------
router.get('/import', (req, res) => {
  const manufacturers = db.prepare('SELECT * FROM manufacturers ORDER BY name').all();
  res.render('admin-import', { manufacturers, message: req.query.msg || null, error: null, imported: null });
});

router.post('/import', (req, res) => {
  const manufacturers = db.prepare('SELECT * FROM manufacturers ORDER BY name').all();
  try {
    if (!req.files || !req.files.file) {
      return res.render('admin-import', { manufacturers, message: null, error: 'Файл не выбран', imported: null });
    }
    const mfrId = parseInt(req.body.manufacturerId, 10);
    const mfr = db.prepare('SELECT * FROM manufacturers WHERE id = ?').get(mfrId);
    if (!mfr) {
      return res.render('admin-import', { manufacturers, message: null, error: 'Производитель не найден', imported: null });
    }

    const wb = XLSX.read(req.files.file.data, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    // Найти строку заголовков: содержит "型号" или первый столбец с именем модели и 10 коэффициентов capacity
    let headerRow = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i];
      if (r && (String(r[0]).includes('型号') || String(r[0]).includes('Model') ||
                (typeof r[0] === 'string' && r.slice(14).some(c => c != null)))) {
        headerRow = i; break;
      }
    }
    if (headerRow < 0) headerRow = 2; // типичная структура: 2 строки заголовков

    let imported = 0, skipped = 0;
    const getNum = (v) => {
      if (v == null || v === '' || v === '-' || typeof v !== 'number') return null;
      return v;
    };
    const getPoly = (row, startIdx) => {
      const arr = [];
      for (let k = 0; k < 10; k++) {
        const v = row[startIdx + k];
        arr.push(typeof v === 'number' ? v : (parseFloat(v) || 0));
      }
      return arr;
    };

    const insert = db.prepare(`
      INSERT INTO compressors
      (manufacturer_id, model, type, refrigerant_code, frequency_hz, voltage_v,
       displacement_m3h, suction_d_in, discharge_d_in, max_current_a,
       min_tevap, max_tevap, min_tcond, max_tcond, price_eur,
       poly_capacity, poly_power, poly_mass, poly_multiplier)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(manufacturer_id, model, refrigerant_code) DO UPDATE SET
        poly_capacity=excluded.poly_capacity, poly_power=excluded.poly_power,
        poly_mass=excluded.poly_mass, poly_multiplier=excluded.poly_multiplier,
        displacement_m3h=excluded.displacement_m3h, suction_d_in=excluded.suction_d_in,
        discharge_d_in=excluded.discharge_d_in, max_current_a=excluded.max_current_a,
        min_tevap=excluded.min_tevap, max_tevap=excluded.max_tevap,
        min_tcond=excluded.min_tcond, max_tcond=excluded.max_tcond, active=1`);

    const defaultPrice = parseFloat(req.body.defaultPrice) || 1000;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0] || typeof r[0] !== 'string' || !r[0].trim()) continue;
      const model = r[0].trim();
      // Структура строки: [0]модель [1]частота [2]напряжение [3]хладагент [4]Vh
      // [6]dSuction [7]dDisch [8]Imax [9]tвозврата [10]minTcond [11]maxTcond [12]minTevap [13]maxTevap
      // [14..23] P_C1..C10 [24..33] A_C [34..43] V_C [44..53] M_C [54..63] C_C [64] множитель
      const refrigerant = String(r[3] || 'R404a').trim();
      // Проверить наличие capacity-полинома (колонки 54..63)
      if (r[54] == null) { skipped++; continue; }
      const pCap = getPoly(r, 54);
      const pPow = getPoly(r, 14);
      const pMas = getPoly(r, 44);
      const multiplier = getNum(r[64]) || 1000;
      const refExists = db.prepare('SELECT code FROM refrigerants WHERE LOWER(code) = LOWER(?)').get(refrigerant);
      if (!refExists) { skipped++; continue; }

      // Диаметр нагнетания всегда меньше всасывания: если колонки в файле
      // поставщика перепутаны, пара вернётся в правильном порядке.
      const [portSuction, portDischarge] = normalizePorts(getNum(r[6]), getNum(r[7]));

      insert.run(
        mfrId, model, 'scroll', refExists.code,
        getNum(r[1]) || 50, getNum(r[2]) || 400,
        getNum(r[4]), portSuction, portDischarge, getNum(r[8]),
        getNum(r[12]) != null ? getNum(r[12]) : -40, getNum(r[13]) != null ? getNum(r[13]) : 10,
        getNum(r[10]) != null ? getNum(r[10]) : 10, getNum(r[11]) != null ? getNum(r[11]) : 60,
        defaultPrice,
        JSON.stringify(pCap), JSON.stringify(pPow), JSON.stringify(pMas), multiplier
      );
      imported++;
    }

    res.render('admin-import', { manufacturers, message: null, error: null,
      imported: { count: imported, skipped, manufacturer: mfr.name } });
  } catch (e) {
    res.render('admin-import', { manufacturers, message: null, error: 'Ошибка импорта: ' + e.message, imported: null });
  }
});

// ---------- Справочники ----------
router.get('/catalog', (req, res) => {
  const categories = db.prepare('SELECT DISTINCT category FROM components ORDER BY category').all().map(r => r.category);
  const byCat = {};
  for (const c of categories) {
    byCat[c] = db.prepare('SELECT * FROM components WHERE category = ? ORDER BY code').all(c);
  }
  const compressorsCount = db.prepare('SELECT COUNT(*) AS n FROM compressors WHERE active = 1').get().n;
  res.render('admin-catalog', { byCat, compressorsCount });
});

module.exports = router;
