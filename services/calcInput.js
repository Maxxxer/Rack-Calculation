/**
 * Разбор тела запроса калькулятора в нормализованный вход расчёта.
 *
 * Один разбор на два маршрута — «Рассчитать» (routes/calc.js) и
 * «Сохранить как КП» (routes/quotes.js): иначе поля вроде выбранного
 * варианта автоподбора легко теряются в одном из них.
 *
 * Выбранный вариант автоподбора приходит одним полем `variant` в виде
 * «идентификатор компрессора : количество» (кнопки вариантов подставляются
 * как submit-кнопки основной формы), поэтому разбирается отдельно.
 */
'use strict';

const { normalizeTolerancePct } = require('./selection');

const VARIANT_SEPARATOR = ':';
const DEFAULT_OPTIONS = Object.freeze([]);

function toNumber(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptions(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value) return [value];
  return [...DEFAULT_OPTIONS];
}

/** «12:2» → { compressorId: 12, qty: 2 }; при неполных данных — null */
function parseVariant(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const [idPart, qtyPart] = String(raw).split(VARIANT_SEPARATOR);
  const compressorId = toInteger(idPart, 0);
  if (compressorId <= 0) return null;
  return { compressorId, qty: Math.max(1, toInteger(qtyPart, 1)) };
}

/**
 * Вариант, переданный плоскими полями.
 * `variantPinned` — скрытое поле основной формы: оно переносит выбранный
 * вариант в следующий расчёт, когда кнопки вариантов не нажимались.
 */
function parseFlatVariant(body) {
  const compressorId = toInteger(body.variantCompressorId, 0);
  if (compressorId <= 0) return null;
  return { compressorId, qty: Math.max(1, toInteger(body.variantQty, 1)) };
}

/**
 * Нормализованный вход расчёта. Значения по умолчанию совпадают с формой:
 * перегрев 10 К, переохлаждение 0 К, допуск 10 %, до 3 компрессоров.
 */
function parseCalculationInput(body) {
  const source = body || {};
  return {
    refrigerant: source.refrigerant,
    tEvap: toNumber(source.tEvap, null),
    tCond: toNumber(source.tCond, null),
    dTsh: toNumber(source.dTsh, 10),
    dTsc: toNumber(source.dTsc, 0),
    requiredKw: toNumber(source.requiredKw, 0),
    tolerancePct: normalizeTolerancePct(source.tolerancePct),
    housingCode: source.housingCode || null,
    mode: source.mode === 'manual' ? 'manual' : 'auto',
    auto: {
      type: source.autoType || 'any',
      manufacturerId: source.autoManufacturer || 'any',
      maxQty: Math.max(1, toInteger(source.autoMaxQty, 3))
    },
    manual: {
      type: source.manualType || 'any',
      manufacturerId: source.manualManufacturer || 'any',
      compressorId: toInteger(source.compressorId, 0) || null,
      qty: Math.max(1, toInteger(source.compressorQty, 1))
    },
    variant: parseVariant(source.variant) || parseVariant(source.variantPinned) || parseFlatVariant(source),
    selectedOptions: toOptions(source.options)
  };
}

/** Плоские поля для подстановки в скрытые input формы сохранения КП */
function toFlatFields(input) {
  return {
    refrigerant: input.refrigerant,
    tEvap: input.tEvap,
    tCond: input.tCond,
    dTsh: input.dTsh,
    dTsc: input.dTsc,
    requiredKw: input.requiredKw,
    tolerancePct: input.tolerancePct,
    housingCode: input.housingCode || '',
    mode: input.mode,
    autoType: input.auto ? input.auto.type : 'any',
    autoManufacturer: input.auto ? input.auto.manufacturerId : 'any',
    autoMaxQty: input.auto ? input.auto.maxQty : 3,
    manualType: input.manual ? input.manual.type : 'any',
    manualManufacturer: input.manual ? input.manual.manufacturerId : 'any',
    compressorId: input.manual ? input.manual.compressorId || '' : '',
    compressorQty: input.manual ? input.manual.qty : 1,
    variant: input.variant ? `${input.variant.compressorId}${VARIANT_SEPARATOR}${input.variant.qty}` : ''
  };
}

module.exports = { parseCalculationInput, parseVariant, toFlatFields, VARIANT_SEPARATOR };
