'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = [];
const log = (...a) => out.push(a.map(String).join(' '));

const src = 'd:/Фирменный стиль MAIR.pdf';
const data = fs.readFileSync(src);

// ---- enumerate all indirect objects with their dictionaries ----
const objs = [];
const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
let m;
while ((m = re.exec(data.toString('latin1'))) !== null) {
  objs.push({ num: Number(m[1]), gen: Number(m[2]), body: m[3], absStart: m.index });
}
log('OBJECTS', objs.length);

// ---- find image XObjects and extract raw data ----
const dir = 'scripts/_tmp_img';
fs.mkdirSync(dir, { recursive: true });

let saved = 0;
for (const o of objs) {
  const dict = o.body.slice(0, o.body.indexOf('stream') >= 0 ? o.body.indexOf('stream') : o.body.length);
  if (!/\/Subtype\s*\/Image/.test(dict)) continue;
  const filtM = dict.match(/\/Filter\s*(\[[^\]]+\]|\/[A-Za-z0-9]+)/);
  const filter = filtM ? filtM[1] : 'none';
  const wM = dict.match(/\/Width\s+(\d+)/);
  const hM = dict.match(/\/Height\s+(\d+)/);
  const csM = dict.match(/\/ColorSpace\s*(\/[A-Za-z0-9]+|\[[^\]]+\]|\d+\s+\d+\s+R)/);
  const bpcM = dict.match(/\/BitsPerComponent\s+(\d+)/);
  log('IMG obj', o.num, 'filter', filter, 'w', wM && wM[1], 'h', hM && hM[1], 'cs', csM && csM[1], 'bpc', bpcM && bpcM[1]);

  const si = o.body.indexOf('stream');
  if (si === -1) continue;
  let st = si + 6;
  if (o.body[st] === '\r') st++;
  if (o.body[st] === '\n') st++;
  const en = o.body.indexOf('endstream', st);
  const raw = Buffer.from(o.body.slice(st, en), 'latin1');

  if (/DCTDecode/.test(filter)) {
    const f = path.join(dir, 'img_' + o.num + '.jpg');
    fs.writeFileSync(f, raw);
    saved++;
    log('  saved', f, raw.length);
  } else if (/FlateDecode/.test(filter)) {
    let inf = null;
    for (const cand of [raw, raw.slice(0, raw.length - 1), raw.slice(0, raw.length - 2)]) {
      try { inf = zlib.inflateSync(cand); break; } catch (e) { /* next */ }
    }
    if (inf) {
      const f = path.join(dir, 'img_' + o.num + '.raw');
      fs.writeFileSync(f, inf);
      saved++;
      log('  saved raw', f, inf.length);
    } else {
      log('  inflate failed', raw.length);
    }
  } else {
    log('  filter not handled:', filter, 'len', raw.length);
  }
}
log('SAVED', saved);

// ---- fix color parsing: correct slice ----
const decoded = [];
let idx = 0;
while (true) {
  const i = data.indexOf('stream', idx);
  if (i === -1) break;
  let start = i + 6;
  if (data[start] === 0x0d) start++;
  if (data[start] === 0x0a) start++;
  const end = data.indexOf('endstream', start);
  if (end === -1) break;
  const raw = data.slice(start, end);
  idx = end + 9;
  for (const cand of [raw, raw.slice(0, raw.length - 1), raw.slice(0, raw.length - 2)]) {
    try { decoded.push(zlib.inflateSync(cand)); break; } catch (e) { /* next */ }
  }
}
const content = decoded.map(b => b.toString('latin1')).join('\n');

function all(reSrc) {
  const map = new Map();
  for (const mm of content.matchAll(reSrc)) {
    const key = mm.slice(1, mm.length - 1).map(x => Number(x).toFixed(4)).join(' ');
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

log('--- 4-comp CMYK (4 numbers + scn/k) ---');
for (const [k, v] of all(/\b(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(?:scn|SCN|k|K)\b/g)) {
  const [c, mm2, y, kk] = k.split(' ').map(Number);
  const r = Math.round(255 * (1 - c) * (1 - kk));
  const g = Math.round(255 * (1 - mm2) * (1 - kk));
  const b = Math.round(255 * (1 - y) * (1 - kk));
  const hex = '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('').toUpperCase();
  log('CMYK', k, '->', hex, 'x' + v);
}

log('--- 3-comp (3 numbers + scn) ---');
for (const [k, v] of all(/\b(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(?:scn|SCN)\b/g)) {
  const [r, g, b] = k.split(' ').map(Number);
  const hex = '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  log('RGB', k, '->', hex, 'x' + v);
}

log('--- 2-comp (2 numbers + scn) ---');
for (const [k, v] of all(/\b(\d*\.?\d+)\s+(\d*\.?\d+)\s+(?:scn|SCN)\b/g)) {
  const [r, g] = k.split(' ').map(Number);
  const hex = '#' + [r, g].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  log('2c', k, '->', hex + '??', 'x' + v);
}

log('--- 1-comp (1 number + scn) ---');
for (const [k, v] of all(/\b(\d*\.?\d+)\s+(?:scn|SCN)\b/g)) log('1c', k, 'x' + v);

// context around the crimson operator
log('--- context samples ---');
const needle = '0.8745';
let p = -1, n = 0;
while ((p = content.indexOf(needle, p + 1)) !== -1 && n < 6) {
  log('>>> ' + JSON.stringify(content.slice(Math.max(0, p - 60), p + 60)));
  n++;
}
const needle2 = '0.0588';
p = -1; n = 0;
while ((p = content.indexOf(needle2, p + 1)) !== -1 && n < 6) {
  log('### ' + JSON.stringify(content.slice(Math.max(0, p - 60), p + 60)));
  n++;
}

fs.writeFileSync('scripts/_tmp_out.txt', out.join('\n'), 'utf8');
console.log('DONE lines=' + out.length);
