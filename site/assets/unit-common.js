// 每個單元共用：自我檢查、影片擷取模式的掛鉤、3D 左右留白計算
// 影片工具（tools/make_video.py）會用到：window.deck、window.__ready、window.quizReveal、window.lab、window.unitActs

import { tr, stageName } from './i18n.js';

export const isCapture = new URLSearchParams(location.search).has('capture');

export function setupCapture(root, deck) {
  if (isCapture) root.classList.add('is-capture');
  window.deck = deck;
  window.unitActs = window.unitActs || {};
}

export function markReady() { window.__ready = true; }

// 投影片上 data-inset 元素擋住的寬度（給 3D 把投影中心移到可見區域）
export function insets(slide) {
  let l = 0, r = 0;
  for (const el of slide.querySelectorAll('[data-inset="left"]')) l = Math.max(l, el.getBoundingClientRect().right + 12);
  for (const el of slide.querySelectorAll('[data-inset="right"]')) r = Math.max(r, innerWidth - el.getBoundingClientRect().left + 12);
  return [l, r];
}

export function setupQuiz() {
  document.querySelectorAll('.q').forEach((q) => {
    const fb = q.querySelector('.q__fb');
    const show = (ok, picked) => {
      fb.className = `q__fb ${ok ? 'ok' : 'no'}`;
      fb.textContent = (ok ? tr('答對了。', 'Correct. ') : tr(`再想想${picked ? `：「${picked}」不對` : ''}。`, `Not quite${picked ? ` — “${picked}” isn't it` : ''}. Try again.`)) + (ok ? fb.dataset.why : '');
    };
    if (q.dataset.answer) {
      q.querySelectorAll('.q__opts button').forEach((b) => b.addEventListener('click', () => {
        const ok = b.textContent.trim() === q.dataset.answer;
        b.classList.add(ok ? 'is-right' : 'is-wrong');
        show(ok, b.textContent.trim());
      }));
    } else if (q.dataset.num) {
      const inp = q.querySelector('input');
      const check = () => {
        const v = parseFloat(inp.value);
        const ok = Math.abs(v - +q.dataset.num) <= +q.dataset.tol * Math.max(1, Math.abs(+q.dataset.num));
        show(ok);
      };
      q.querySelector('.q__num button').addEventListener('click', check);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    }
  });
  // 影片用：揭曉第 n 題
  window.quizReveal = (n) => {
    const q = document.querySelectorAll('.q')[n];
    if (!q) return;
    if (q.dataset.answer) [...q.querySelectorAll('.q__opts button')].find((b) => b.textContent.trim() === q.dataset.answer)?.click();
    else { q.querySelector('input').value = q.dataset.num; q.querySelector('.q__num button').click(); }
  };
}

// 3D 載入進度條
export const STAGE_WEIGHT = { '地形骨架': [0, 0.15], '侵蝕模擬': [0.15, 0.6], '河道與水文分析': [0.6, 0.75], '環境遮蔽': [0.75, 0.82], '建立 3D 模型': [0.82, 0.98], '完成': [1, 1] };
export function progressTo(loading, stageEl) {
  return (stage, p) => {
    const [a, b] = STAGE_WEIGHT[stage] || [0, 1];
    loading.style.setProperty('--p', `${(a + (b - a) * p) * 100}%`);
    if (stageEl) stageEl.textContent = `${stageName(stage)} ${Math.round(p * 100)}%`;
  };
}
