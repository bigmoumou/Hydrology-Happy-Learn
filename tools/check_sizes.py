# 四個標準尺寸（13/14 吋 MacBook、27/32 吋螢幕）逐頁檢查一個單元（使用者指定的標配尺寸）：
# 1) 每頁文字不能超出投影片或被裁切；2) 第 4 頁四個 3D 標籤都完整在畫面內、不被說明卡／導覽列擋住（三個分段都看）；
# 3) 第 4 頁水位動畫兩個方向都會動；4) 第 5、6 頁示意圖的元素不互相重疊、不超出畫面。每個尺寸拼一張 sheet。
# 用法：bash ~/.claude/skills/opus-video/scripts/ov python tools/check_sizes.py <頁面，例如 ch01/u1-2/> <輸出資料夾>
# （需先開本機網站 8790；第 4 頁的標籤／水位檢查是給 1-2 水庫用的，其他單元會自動略過那段的意義）
import sys, os, json
from playwright.sync_api import sync_playwright
from PIL import Image
PAGE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SIZES = [('13吋 MacBook Air', 1470, 832, 2), ('14吋 MacBook Pro', 1512, 862, 2), ('27吋 QHD', 2560, 1300, 1), ('32吋 4K', 3008, 1560, 2)]
OVERFLOW = r"""
(() => {
  const s = deck.slides[deck.i], bad = [];
  const st = document.querySelector('.deck__stage').getBoundingClientRect(), k = deck.scale;
  for (const el of s.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    const card = el.matches('.card3d, .lab-card, .chart-card, .phys, .title-block, .q, .chip, button');
    if (!own && !card) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const x0 = (r.left - st.left) / k, y0 = (r.top - st.top) / k, x1 = (r.right - st.left) / k, y1 = (r.bottom - st.top) / k;
    const name = (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 40);
    if (x1 > 1920.5 || y1 > 1080.5 || x0 < -0.5 || y0 < -0.5) bad.push(`outside stage [${x0|0},${y0|0},${x1|0},${y1|0}] ${name}`);
    if (['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) bad.push(`clipped ${el.scrollHeight}>${el.clientHeight} ${name}`);
    if (['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) bad.push(`clipped-x ${el.scrollWidth}>${el.clientWidth} ${name}`);
  }
  return bad;
})()
"""
LABELS = r"""(() => {
  const vw = innerWidth, vh = innerHeight, R = (el) => el.getBoundingClientRect();
  const blockers = [...document.querySelectorAll('.slide.is-active .card3d, .slide.is-active .crumb, .deck__ui')].map(R);
  const out = [];
  for (const el of document.querySelectorAll('.hc-label')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || el.style.display === 'none' || el.closest('[style*="display: none"]')) continue;
    const box = el.querySelector('.hc-label__box'), r = R(box), name = box.textContent.trim().split(/\s+/)[0] + ' ' + (box.textContent.trim().split(/\s+/)[1] || '');
    if (!r.width) continue;
    const inside = r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
    const hit = blockers.some((b) => !(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom));
    out.push({ name: name.trim(), inside, hit, occ: el.classList.contains('is-occluded'), x: Math.round(r.left), y: Math.round(r.top) });
  }
  return out;
})()"""
SVGCHK = r"""(() => {
  const svg = document.querySelector('.slide.is-active .cvsvg'); if (!svg) return 'no svg';
  const vw = innerWidth, vh = innerHeight, bad = [];
  const texts = [...svg.querySelectorAll('text')].filter((t) => getComputedStyle(t.closest('.f') || t).opacity !== '0' && t.getBoundingClientRect().width);
  const rs = texts.map((t) => [t.textContent.trim(), t.getBoundingClientRect()]);
  for (const [n, r] of rs) if (r.left < 0 || r.right > vw || r.top < 0 || r.bottom > vh) bad.push('超出畫面 ' + n);
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i][1], b = rs[j][1];
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) bad.push(`文字重疊 ${rs[i][0]} / ${rs[j][0]}`);
  }
  // 文字壓到箭頭的箭身（取每個 shaft 的外框）
  const shafts = [...svg.querySelectorAll('.shaft')].map((s) => [s.closest('.arw').className.baseVal, s.getBoundingClientRect()]);
  for (const [n, r] of rs) for (const [an, s] of shafts) {
    const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left), oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ox > 3 && oy > 3) bad.push(`文字「${n}」壓到箭頭 ${an}`);
  }
  return bad;
})()"""
report = {}
with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="chrome", args=["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"])
    for name, w, h, dpr in SIZES:
        pg = br.new_page(viewport={"width": w, "height": h}, device_scale_factor=dpr)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:8790/{PAGE}#/1")
        pg.wait_for_function("window.__ready === true", timeout=240000)
        pg.evaluate("document.fonts.ready.then(() => true)")
        n = pg.evaluate("deck.slides.length")
        rep = {'overflow': {}, 'labels': {}, 'svg': {}, 'level': {}}
        shots = []
        for i in range(n):
            nf = pg.evaluate(f"deck.frags({i}).length")
            pg.evaluate(f"deck.go({i}, {nf})"); pg.wait_for_timeout(2200)
            bad = pg.evaluate(OVERFLOW)
            if bad: rep['overflow'][i + 1] = bad[:6]
            if pg.evaluate("!!document.querySelector('.slide.is-active[data-layout=scene], .slide.is-active[data-layout=title]')"):
                pg.wait_for_timeout(600)
                labs = pg.evaluate(LABELS)
                badl = [l['name'] for l in labs if not l['occ'] and (not l['inside'] or l['hit'])]
                hid = [l['name'] for l in labs if l['occ']]
                rep.setdefault('slabels', {})[i + 1] = ('看得到的標籤被擋住：' + str(badl) if badl else '') + ('｜自動淡出：' + str(hid) if hid else '')
            if pg.evaluate("!!document.querySelector('.slide.is-active .cvsvg')"):
                sb = pg.evaluate(SVGCHK)
                if sb: rep['svg'][i + 1] = sb[:8]
            f = os.path.join(OUT, f"{w}x{h}_s{i + 1:02d}.png"); pg.screenshot(path=f); shots.append(f)
        # 第 4 頁（1-2 水庫）：三個分段的標籤，加上水位動畫；其他單元沒有水位就略過
        for fr in ((0, 1, 2) if pg.evaluate("typeof (window.hydro && hydro.level) === 'number'") else ()):
            pg.evaluate(f"deck.go(3, {fr})")
            lv = []
            for _ in range(14): lv.append(round(pg.evaluate("hydro.level"), 2)); pg.wait_for_timeout(500)
            rep['level'][fr] = [lv[0], lv[-1]]
            labs = pg.evaluate(LABELS)
            rep['labels'][fr] = [f"{l['name']}{'' if l['inside'] else '（超出畫面）'}{'（被擋住）' if l['hit'] else ''}{'（自動淡出！）' if l['occ'] else ''}" for l in labs]
            pg.screenshot(path=os.path.join(OUT, f"{w}x{h}_s04_f{fr}.png"))
        rep['errors'] = errs[:3]
        report[name] = rep
        pg.close()
        # sheet
        tw = 480; th = int(tw * h / w)
        ims = [Image.open(f).convert('RGB').resize((tw, th)) for f in shots]
        S = Image.new('RGB', (tw * 4, th * ((len(ims) + 3) // 4)), 'white')
        for k, im in enumerate(ims): S.paste(im, ((k % 4) * tw, (k // 4) * th))
        S.save(os.path.join(OUT, f"sheet_{w}x{h}.jpg"), quality=85)
    br.close()
for name, rep in report.items():
    print(f"\n=== {name}")
    print("  文字超出或裁切：", rep['overflow'] or '無')
    print("  示意圖問題：", rep['svg'] or '無')
    print("  各頁 3D 標籤：", {k: v for k, v in rep.get('slabels', {}).items() if v} or '全部正常')
    for fr in rep['level']: print(f"  第 4 頁分段 {fr}：水位 {rep['level'][fr][0]} → {rep['level'][fr][1]}｜標籤 {rep['labels'][fr]}")
    print("  頁面錯誤：", rep['errors'] or '無')
