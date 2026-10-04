"""檢查線上網站（或本機）：每個單元載入 3D、換頁、打開影片播放並拖曳，收集錯誤與載入時間、截圖

用法：bash ~/.claude/skills/opus-video/scripts/ov python tools/check_live.py [網址] [截圖資料夾]
  預設網址 https://hydrology-happy-learn.pages.dev/
"""
import os, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://hydrology-happy-learn.pages.dev/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
os.makedirs(OUT, exist_ok=True)
args = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"]
UNITS = [("ch01/u1-1/", [4, 11, 16]), ("ch01/u1-2/", [4, 11]), ("ch01/u1-3/", [7, 13])]
ok = True
with sync_playwright() as p:
    br = p.chromium.launch(headless=True, args=args, channel="chrome")
    ctx = br.new_context(viewport={"width": 1600, "height": 900})
    pg = ctx.new_page()
    errs, failed = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("requestfailed", lambda r: failed.append(r.url))
    pg.on("response", lambda r: failed.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    t0 = time.time(); pg.goto(BASE, wait_until="load")
    pg.evaluate("document.fonts.ready.then(() => true)")
    fonts = pg.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(', ')")
    print(f"首頁 {time.time() - t0:.1f}s　已載入字型：{fonts}")
    pg.screenshot(path=os.path.join(OUT, "live_home.png"))

    for unit, slides in UNITS:
        t0 = time.time()
        pg.goto(BASE + unit, wait_until="load")
        pg.wait_for_function("window.__ready === true", timeout=180000)
        print(f"{unit} 3D 就緒 {time.time() - t0:.1f}s")
        for n in slides:
            pg.evaluate(f"window.deck.go({n - 1}, 0)")
            pg.wait_for_timeout(2500)
            pg.screenshot(path=os.path.join(OUT, f"live_{unit.replace('/', '_')}{n}.png"))
        # 影片：打開、播放、拖曳到 70%
        pg.keyboard.press("v")
        pg.wait_for_timeout(1500)
        r = pg.evaluate("""async () => {
          const v = document.querySelector('.deck__vplayer video');
          const t0 = performance.now();
          while (!(v.duration > 0) && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 200));
          const d = v.duration; v.currentTime = d * 0.7;
          const t1 = performance.now();
          while (v.readyState < 3 && performance.now() - t1 < 15000) await new Promise(r => setTimeout(r, 200));
          await v.play().catch(() => {});
          await new Promise(r => setTimeout(r, 1500));
          return { dur: Math.round(d), t: Math.round(v.currentTime), w: v.videoWidth, paused: v.paused, seekMs: Math.round(performance.now() - t1 - 1500), hls: !!window.Hls, err: v.error && v.error.code };
        }""")
        print(f"  影片：{r}")
        if not r["dur"] or r["err"] or r["w"] == 0: ok = False
        pg.keyboard.press("Escape")
    print("錯誤：", errs[:10] if errs else "無")
    print("失敗的請求：", failed[:10] if failed else "無")
    if errs or failed: ok = False
    br.close()
print("線上檢查通過" if ok else "線上檢查有問題")
