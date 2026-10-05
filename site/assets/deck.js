// 全螢幕投影片引擎（不捲動，直接上一頁／下一頁）
// - 版面以 1920×1080 設計，整體等比縮放到視窗；3D 背景層則鋪滿整個視窗
// - 投影片內 class="f" 的元素是「分段出現」，按下一步時先一個個出現，全部出現後才換頁
// - 網址 #/5/2 代表第 5 頁、第 2 段（從 1 起算），可直接分享或重新整理後回到原處
// - 鍵盤：→ ↓ 空白鍵 PageDown 下一步；← ↑ PageUp 上一步；Home／End；G 或 Esc 總覽；F 全螢幕

import { tr } from './i18n.js';

export class Deck {
  constructor(root, { onChange = () => {} } = {}) {
    this.root = root;
    this.stage = root.querySelector('.deck__stage');
    this.slides = [...root.querySelectorAll('.slide')];
    this.onChange = onChange;
    this.i = 0; this.f = 0;
    this.slides.forEach((s, n) => { s.dataset.n = n + 1; s.setAttribute('aria-hidden', 'true'); });
    this.buildUI();
    this.fit();
    addEventListener('resize', () => this.fit());
    addEventListener('keydown', (e) => this.key(e));
    addEventListener('hashchange', () => this.fromHash());
    this.bindWheelAndTouch();
    // 封面上的入口按鈕：data-deck="next|lab|video"
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-deck]');
      if (!b) return;
      e.preventDefault();
      const a = b.dataset.deck;
      if (a === 'next') this.next();
      else if (a === 'lab') this.go(this.labIndex(), 0);
      else if (a === 'video') this.toggleVideo(true);
    });
    // 用滑鼠拖完滑桿後交還鍵盤焦點，方向鍵才能繼續換頁
    addEventListener('pointerup', (e) => { if (e.target.matches?.('input[type=range]')) e.target.blur(); });
    this.fromHash(true);
  }

  // 分段：同一個 data-fi 的元素一起出現；沒有 data-fi 的依 DOM 順序各自一段
  frags(i = this.i) {
    const els = [...this.slides[i].querySelectorAll('.f')];
    const groups = new Map();
    els.forEach((el, k) => {
      const key = el.dataset.fi ? `g${String(el.dataset.fi).padStart(3, '0')}` : `e${String(k).padStart(3, '0')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });
    return [...groups.keys()].sort().map((k) => groups.get(k));
  }

  fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    this.scale = s;
    this.root.style.setProperty('--s', s);
    this.root.style.setProperty('--ox', `${(innerWidth - 1920 * s) / 2}px`);
    this.root.style.setProperty('--oy', `${(innerHeight - 1080 * s) / 2}px`);
    this.onChange(this.state(), 'resize');
  }

  // 投影片的可見區域在視窗中的位置（給 3D 計算左右留白）
  stageRect() { return { x: (innerWidth - 1920 * this.scale) / 2, y: (innerHeight - 1080 * this.scale) / 2, s: this.scale }; }

  state() { return { i: this.i, f: this.f, slide: this.slides[this.i], frags: this.frags(), deck: this }; }

  go(i, f = 0, { fromHash = false, instant = false } = {}) {
    i = Math.max(0, Math.min(this.slides.length - 1, i));
    const fr = this.frags(i);
    f = Math.max(0, Math.min(fr.length, f));
    const prev = this.slides[this.i];
    const changed = i !== this.i || !this.started;
    this.i = i; this.f = f;
    this.slides.forEach((s, n) => {
      const on = n === i;
      s.classList.toggle('is-active', on);
      s.classList.toggle('is-past', n < i);
      s.setAttribute('aria-hidden', String(!on));
      if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
    });
    fr.forEach((group, k) => group.forEach((el) => {
      el.classList.toggle('is-in', k < f); el.classList.toggle('is-current', k === f - 1);
      // data-flag 的分段不顯示內容，而是在投影片上切換 class（例如讓名詞卡飛到分類欄）
      if (el.dataset.flag) this.slides[i].classList.toggle(`flag-${el.dataset.flag}`, k < f);
    }));
    if (changed) {
      // 重新播放這一頁的進場動畫
      const s = this.slides[i];
      s.classList.remove('is-play'); void s.offsetWidth; s.classList.add('is-play');
      if (prev && prev !== s) prev.classList.remove('is-play');
    }
    this.started = true;
    this.root.dataset.layout = this.slides[i].dataset.layout || 'paper';
    this.ui.count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(this.slides.length).padStart(2, '0')}`;
    this.ui.bar.style.width = `${((i + (fr.length ? f / (fr.length + 1) : 0)) / (this.slides.length - 1 || 1)) * 100}%`;
    this.ui.prev.disabled = i === 0 && f === 0;
    this.ui.next.disabled = i === this.slides.length - 1 && f >= fr.length;
    if (!fromHash) history.replaceState(null, '', `#/${i + 1}${f ? '/' + f : ''}`);
    this.onChange(this.state(), changed ? 'slide' : 'fragment', { instant });
  }

  next() {
    const fr = this.frags();
    if (this.f < fr.length) this.go(this.i, this.f + 1);
    else if (this.i < this.slides.length - 1) this.go(this.i + 1, 0);
  }
  prev() {
    if (this.f > 0) this.go(this.i, this.f - 1);
    else if (this.i > 0) this.go(this.i - 1, this.frags(this.i - 1).length);
  }

  // 網址 #/lab：互動實驗頁；#/video：直接開影片
  labIndex() { const i = this.slides.findIndex((s) => s.dataset.layout === 'lab'); return i < 0 ? 0 : i; }

  fromHash(first = false) {
    if (/^#\/lab/.test(location.hash)) { this.go(this.labIndex(), 0, { instant: first }); return; }
    if (/^#\/video/.test(location.hash)) { this.go(0, 0, { fromHash: true, instant: first }); this.toggleVideo(true); return; }
    const m = location.hash.match(/^#\/(\d+)(?:\/(\d+))?/);
    if (m) this.go(+m[1] - 1, +(m[2] || 0), { fromHash: true, instant: first });
    else if (first) this.go(0, 0, { instant: true });
  }

  key(e) {
    if (e.defaultPrevented) return;
    const t = e.target;
    const typing = t.closest && t.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]');
    if (typing) return;
    const onRange = t.matches && t.matches('input[type=range]');
    const k = e.key;
    if (this.videoOpen) {
      if (k === 'Escape' || k === 'v' || k === 'V') { this.toggleVideo(false); e.preventDefault(); }
      return;
    }
    if ((k === 'v' || k === 'V') && this.vplayer) { e.preventDefault(); this.toggleVideo(true); return; }
    if (this.overview) {
      if (k === 'Escape' || k === 'g' || k === 'G') { this.toggleOverview(false); e.preventDefault(); }
      return;
    }
    if (['ArrowRight', 'PageDown', ' '].includes(k) || (k === 'ArrowDown' && !onRange)) {
      if (onRange && k === 'ArrowRight') return; // 滑桿上的左右鍵留給滑桿
      e.preventDefault(); this.next();
    } else if (['ArrowLeft', 'PageUp'].includes(k) || (k === 'ArrowUp' && !onRange)) {
      if (onRange && k === 'ArrowLeft') return;
      e.preventDefault(); this.prev();
    } else if (k === 'Home') { e.preventDefault(); this.go(0); }
    else if (k === 'End') { e.preventDefault(); this.go(this.slides.length - 1); }
    else if (k === 'g' || k === 'G' || k === 'Escape') { e.preventDefault(); this.toggleOverview(); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); this.toggleFullscreen(); }
  }

  bindWheelAndTouch() {
    let lock = 0;
    addEventListener('wheel', (e) => {
      // 在 3D 可操作的頁面，滾輪交給 3D 縮放
      if (this.videoOpen) return;
      if (this.slides[this.i].dataset.interactive === 'true' && e.target.closest('.deck__bg, .hc-canvas')) return;
      if (e.target.closest('.no-wheel')) return;
      const now = performance.now();
      if (now < lock || Math.abs(e.deltaY) < 8) return;
      lock = now + 650;
      if (e.deltaY > 0) this.next(); else this.prev();
    }, { passive: true });
    let sx = 0, sy = 0;
    addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) this.next(); else this.prev(); }
    }, { passive: true });
  }

  buildUI() {
    const ui = document.createElement('nav');
    ui.className = 'deck__ui';
    ui.setAttribute('aria-label', tr('投影片導覽', 'Slide navigation'));
    ui.innerHTML = `
      <div class="deck__bar"><i></i></div>
      <button class="deck__btn deck__prev" type="button" aria-label="${tr('上一步', 'Previous')}">←</button>
      <span class="deck__count"></span>
      <button class="deck__btn deck__next" type="button" aria-label="${tr('下一步', 'Next')}">→</button>
      <button class="deck__btn deck__grid" type="button" aria-label="${tr('投影片總覽', 'Slide overview')}" title="${tr('總覽（G）', 'Overview (G)')}">▦</button>
      ${this.root.dataset.video ? '<button class="deck__btn deck__video" type="button" aria-label="播放教學影片" title="教學影片（V）">▶</button>' : ''}
      <button class="deck__btn deck__full" type="button" aria-label="${tr('全螢幕', 'Full screen')}" title="${tr('全螢幕（F）', 'Full screen (F)')}">⛶</button>`;
    this.root.appendChild(ui);
    this.ui = {
      bar: ui.querySelector('.deck__bar i'), count: ui.querySelector('.deck__count'),
      prev: ui.querySelector('.deck__prev'), next: ui.querySelector('.deck__next'),
    };
    this.ui.prev.onclick = () => this.prev();
    this.ui.next.onclick = () => this.next();
    ui.querySelector('.deck__grid').onclick = () => this.toggleOverview();
    ui.querySelector('.deck__full').onclick = () => this.toggleFullscreen();
    if (this.root.dataset.video) {
      ui.querySelector('.deck__video').onclick = () => this.toggleVideo(true);
      const vo = document.createElement('div');
      vo.className = 'deck__vplayer';
      // 影片是 HLS（index.m3u8＋小段）：Safari 原生播放，其他瀏覽器第一次開啟時才載入 hls.js
      vo.innerHTML = `<video controls preload="none" playsinline poster="${this.root.dataset.poster || ''}"></video>
        <button class="deck__vclose" type="button" aria-label="關閉影片">✕ 回到投影片</button>`;
      vo.querySelector('.deck__vclose').onclick = () => this.toggleVideo(false);
      this.root.appendChild(vo);
      this.vplayer = vo;
    }
    // 總覽
    const ov = document.createElement('div');
    ov.className = 'deck__overview';
    ov.innerHTML = `<div class="deck__ov-grid">${this.slides.map((s, n) => `
      <button type="button" data-n="${n}"><span class="no">${String(n + 1).padStart(2, '0')}</span><span class="tt">${s.dataset.title || s.querySelector('h1,h2')?.textContent || ''}</span></button>`).join('')}</div>`;
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-n]');
      if (b) { this.toggleOverview(false); this.go(+b.dataset.n); } else if (e.target === ov) this.toggleOverview(false);
    });
    this.root.appendChild(ov);
    this.ov = ov;
  }

  toggleOverview(on = !this.overview) {
    this.overview = on;
    this.ov.classList.toggle('is-open', on);
    this.ov.querySelectorAll('button').forEach((b) => b.classList.toggle('is-current', +b.dataset.n === this.i));
    if (on) this.ov.querySelector('.is-current')?.focus();
  }

  async attachVideo(v) {
    if (this.videoReady) return;
    const src = this.root.dataset.video;
    if (!/\.m3u8($|\?)/.test(src) || v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src; this.videoReady = true; return; }
    if (!window.Hls) {
      await new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = new URL('../vendor/hls/hls.light.min.js', import.meta.url).href;
        sc.onload = res; sc.onerror = rej;
        document.head.appendChild(sc);
      });
    }
    if (window.Hls?.isSupported()) { this.hls = new window.Hls({ maxBufferLength: 30 }); this.hls.loadSource(src); this.hls.attachMedia(v); }
    else v.src = src;
    this.videoReady = true;
  }

  async toggleVideo(on) {
    if (!this.vplayer) return;
    this.videoOpen = on;
    this.vplayer.classList.toggle('is-open', on);
    const v = this.vplayer.querySelector('video');
    this.onChange(this.state(), on ? 'video-open' : 'video-close');
    if (on) {
      try { await this.attachVideo(v); } catch (e) { console.error('影片載入失敗', e); }
      v.focus(); v.play?.().catch(() => {});
    } else v.pause();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
}
