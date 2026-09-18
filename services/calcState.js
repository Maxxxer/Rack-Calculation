/**
 * Последние введённые значения калькулятора — персонально для каждой учётной
 * записи.
 *
 * Сохраняется весь вход расчёта (окна «01. Режим работы», «02. Компрессоры»,
 * «03. Опции»), поэтому при следующем входе инженер видит свои прошлые
 * параметры, а не пустую форму. Запись одна на пользователя: сохраняется
 * последнее состояние, история не накапливается.
 */
'use strict';

const { db } = require('../db/database');
const { normalizeOptionCodes } = require('./options');

/**
 * Последнее сохранённое состояние пользователя или null.
 * Коды опций приводятся к текущему справочнику: состояние могло быть записано
 * до изменения списка опций (например, когда виброгасители были двумя
 * отдельными опциями), и тогда галочки в форме не совпали бы с определением.
 */
function loadInput(userId) {
  if (!userId) return null;
  const row = db.prepare('SELECT input_json FROM calc_state WHERE user_id = ?').get(userId);
  if (!row) return null;
  try {
    const input = JSON.parse(row.input_json);
    if (!input || typeof input !== 'object') return null;
    if (Array.isArray(input.selectedOptions)) {
      input.selectedOptions = normalizeOptionCodes(input.selectedOptions);
    }
    return input;
  } catch (_) {
    return null;
  }
}

/** Сохранить состояние пользователя (перезаписывает предыдущее) */
function saveInput(userId, input) {
  if (!userId || !input) return;
  db.prepare(`
    INSERT INTO calc_state (user_id, input_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      input_json = excluded.input_json,
      updated_at = datetime('now')`).run(userId, JSON.stringify(input));
}

module.exports = { loadInput, saveInput };
