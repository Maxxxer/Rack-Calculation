/**
 * Дюймовые размеры в «трубной» записи.
 *
 * В базе диаметры хранятся десятичной дробью (2.125, 0.5, 0.375 — так, как они
 * лежат в «База данных.xlsx»), но в каталогах арматуры и в переписке с
 * заказчиком тот же размер принято записывать обыкновенной дробью:
 * 2.125 → 2 1/8", 0.5 → 1/2", 0.375 → 3/8".
 *
 * Шаг дюймовой шкалы — 1/16 (все используемые размеры кратны ей), поэтому
 * значение округляется до шестнадцатых и дробь сокращается.
 */
'use strict';

/** Знаменатель шкалы: размеры труб и присоединений кратны 1/16". */
const SCALE_DENOMINATOR = 16;

/** Разделитель целой и дробной части в готовой записи (неразрывный пробел). */
const WHOLE_SEPARATOR = ' ';

function greatestCommonDivisor(a, b) {
  let left = a;
  let right = b;
  while (right) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * Запись размера в дюймах обыкновенной дробью: 2.125 → 2 1/8", 0.5 → 1/2".
 * Пустое или неположительное значение → «—» (в таблицах это «нет данных»).
 */
function formatInch(value) {
  const inches = Number(value);
  if (!Number.isFinite(inches) || inches <= 0) return '—';

  const steps = Math.round(inches * SCALE_DENOMINATOR);
  const whole = Math.floor(steps / SCALE_DENOMINATOR);
  const rest = steps - whole * SCALE_DENOMINATOR;
  if (!rest) return `${whole}"`;

  const divisor = greatestCommonDivisor(rest, SCALE_DENOMINATOR);
  const fraction = `${rest / divisor}/${SCALE_DENOMINATOR / divisor}`;
  return whole ? `${whole}${WHOLE_SEPARATOR}${fraction}"` : `${fraction}"`;
}

/** Тот же размер с номиналом трубы: 2.125 → 2 1/8" (Ø53.98×2) */
function formatInchWithPipe(sizeIn, odMm, wallMm) {
  const size = formatInch(sizeIn);
  if (size === '—' || odMm == null || wallMm == null) return size;
  return `${size} (Ø${odMm}×${wallMm})`;
}

module.exports = { formatInch, formatInchWithPipe, SCALE_DENOMINATOR };
