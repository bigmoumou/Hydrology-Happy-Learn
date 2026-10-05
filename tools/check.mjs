// 推上去之前的檢查（只用 Node.js 內建模組）：node tools/check.mjs
// - site/ 裡每個檔案小於 25 MiB（Cloudflare Pages 上限）、檔案總數小於 20000
// - site/ 裡沒有 mp4 母帶（HLS 的 init.mp4 除外）、沒有 PDF
// - HTML 的 href／src／data-video／data-poster 與 JS 的 import 路徑都找得到檔案
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const MAX = 25 * 1024 * 1024;
const errors = [], warns = [];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p); } else files.push(p);
  }
})(ROOT);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const ignored = (p) => /\.ttf$/i.test(p) || /(^|\/)u\d+-\d+\.(mp4|vtt|jpg)$/.test(rel(p)); // 這些在 .gitignore 裡，不會上線

let total = 0;
for (const f of files) {
  if (ignored(f)) continue;
  const s = fs.statSync(f).size;
  total += s;
  if (s >= MAX) errors.push(`超過 25 MiB：${rel(f)}（${(s / 1048576).toFixed(1)} MiB）`);
  if (/\.pdf$/i.test(f)) errors.push(`不應公開的 PDF：${rel(f)}`);
  if (/\.mp4$/i.test(f) && !/\/hls\/init\.mp4$/.test(rel(f))) errors.push(`mp4 只能放 HLS：${rel(f)}`);
}
const n = files.filter((f) => !ignored(f)).length;
if (n > 20000) errors.push(`檔案太多：${n}（Cloudflare Pages 上限 20000）`);
if (total > 1.5 * 1024 ** 3) warns.push(`網站總大小 ${(total / 1024 ** 3).toFixed(2)} GiB，GitHub repo 建議控制在幾 GB 以內`);

function check(from, ref, what) {
  if (!ref || /^(https?:|data:|mailto:|#|javascript:)/.test(ref) || ref.includes('${')) return;
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return;
  let target = path.resolve(path.dirname(from), decodeURI(clean));
  // 資料夾：網頁連結要有 index.html；JS 用 new URL() 指到的資料夾（例如 data/）只要存在就好
  if (clean.endsWith('/')) { if (what === 'URL') { if (!fs.existsSync(target)) errors.push(`${rel(from)}：${what} 找不到資料夾 ${ref}`); return; } target = path.join(target, 'index.html'); }
  if (!fs.existsSync(target)) errors.push(`${rel(from)}：${what} 找不到 ${ref}`);
}
for (const f of files) {
  if (f.endsWith('.html')) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(?:href|src|data-video|data-poster)="([^"]+)"/g)) check(f, m[1], '連結');
    const map = s.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    if (map) for (const v of Object.values(JSON.parse(map[1]).imports)) {
      if (v.endsWith('/')) { if (!fs.existsSync(path.resolve(path.dirname(f), v))) errors.push(`${rel(f)}：importmap 找不到資料夾 ${v}`); }
      else check(f, v, 'importmap');
    }
  } else if (f.endsWith('.js') && !rel(f).startsWith('vendor/')) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) check(f, m[1], 'import');
    for (const m of s.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g)) check(f, m[1], 'URL');
  }
}

console.log(`site/：${n} 個檔案，共 ${(total / 1048576).toFixed(0)} MiB`);
for (const w of warns) console.log('注意：' + w);
if (errors.length) { for (const e of errors) console.log('錯誤：' + e); process.exit(1); }
console.log('檢查通過');
