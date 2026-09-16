/**
 * Генерация шаблона Excel для импорта каталога компрессоров.
 * Формат совместим с листами Refcomp_polynom / Xecom_polynom.
 *
 * Запуск: npm run template  →  создаст data/import-template.xlsx
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const row1 = ['型号(Model)', '频率(Fre.)', '电压(Volts.)', '冷媒(Refrigerant)',
  'Объемная производительность, м3/ч', '', 'Диаметр всасывания', 'Диаметр нагнетания',
  'Макс. ток, А', 't возврата, °C', 'Min. Cond.', 'Max. Cond.', 'Min. Evap.', 'Max. Evap.'];
for (let i = 1; i <= 10; i++) row1.push('P_C' + i);
for (let i = 1; i <= 10; i++) row1.push('A_C' + i);
for (let i = 1; i <= 10; i++) row1.push('V_C' + i);
for (let i = 1; i <= 10; i++) row1.push('M_C' + i);
for (let i = 1; i <= 10; i++) row1.push('C_C' + i);
row1.push('Множитель (Вт→кВт)');

const row2 = new Array(row1.length).fill('');

const example = ['EXAMPLE-100', 50, 400, 'R404a', 35, null, 0.875, 1.125, 24,
  20, 20, 55, -45, 6];
const zeros10 = () => new Array(10).fill(0);
example.push(...zeros10()); // P_C1..P_C10
example.push(...zeros10()); // A_C1..A_C10
example.push(...zeros10()); // V_C1..V_C10
example.push(...zeros10()); // M_C1..M_C10
example.push(...zeros10()); // C_C1..C_C10
example.push(1000);          // множитель

const aoa = [row1, row2, example];
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws['!cols'] = row1.map(h => ({ wch: Math.max(10, String(h).length + 2) }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Compressors');
const out = path.join(DATA_DIR, 'import-template.xlsx');
XLSX.writeFile(wb, out);
console.log('Шаблон создан:', out);
console.log('Загрузите его в админке: /admin/import');