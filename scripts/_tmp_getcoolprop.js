/**
 * Временный скрипт: находит на PyPI последнюю сборку CoolProp для Windows x64
 * и скачивает wheel-архив (это обычный ZIP) в vendor/coolprop/.
 * Удаляется после установки библиотеки.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TARGET_DIR = path.join(__dirname, '..', 'vendor', 'coolprop');

/** Кандидаты: win_amd64-сборки, от новых версий к старым */
function pickWheel(releases) {
  const versions = Object.keys(releases).sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });
  for (const version of versions) {
    const wheel = (releases[version] || []).find(f =>
      f.packagetype === 'bdist_wheel' && /win_amd64\.whl$/.test(f.filename)
    );
    if (wheel) return { version, url: wheel.url, filename: wheel.filename, size: wheel.size };
  }
  return null;
}

async function main() {
  const meta = await (await fetch('https://pypi.org/pypi/CoolProp/json')).json();
  const wheel = pickWheel(meta.releases || {});
  if (!wheel) throw new Error('Не найдена сборка CoolProp для win_amd64');

  console.log(`Версия: ${wheel.version}`);
  console.log(`Файл:   ${wheel.filename} (${(wheel.size / 1024 / 1024).toFixed(1)} МБ)`);

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  const zipPath = path.join(TARGET_DIR, 'coolprop.zip');
  const response = await fetch(wheel.url);
  if (!response.ok) throw new Error(`Не удалось скачать: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(zipPath, buffer);
  console.log(`Сохранено: ${zipPath} (${(buffer.length / 1024 / 1024).toFixed(1)} МБ)`);
}

main().catch(e => { console.error('Ошибка:', e.message); process.exitCode = 1; });
