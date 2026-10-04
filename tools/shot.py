"""全解析度截圖（檢查 3D 畫質用，也是之後影片逐格擷取的基礎）

用法（需先啟動本機伺服器 serve.bat，或 .claude/launch.json 的 hydro-site）：
  bash ~/.claude/skills/opus-video/scripts/ov python tools/shot.py <網址路徑> <輸出.png> [--size 1920x1080] [--wait 秒] [--js "程式碼"]
例：
  ... tools/shot.py "lab/hydro-cycle.html?step=4" out.png --size 2560x1440
"""
import argparse, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("path"); ap.add_argument("out")
ap.add_argument("--size", default="1920x1080")
ap.add_argument("--base", default="http://127.0.0.1:8790/")
ap.add_argument("--wait", type=float, default=4.0, help="場景就緒後再等幾秒（讓鏡頭移動與動畫跑一下）")
ap.add_argument("--js", default="", help="就緒後在頁面執行的 JS")
ap.add_argument("--scale", type=float, default=1.0, help="deviceScaleFactor")
a = ap.parse_args()
w, h = map(int, a.size.split("x"))
args = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-unsafe-swiftshader"]
with sync_playwright() as p:
    try:
        br = p.chromium.launch(headless=True, args=args, channel="chrome")
    except Exception:
        br = p.chromium.launch(headless=True, args=args)
    pg = br.new_page(viewport={"width": w, "height": h}, device_scale_factor=a.scale)
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    t0 = time.time()
    pg.goto(a.base + a.path)
    pg.wait_for_function("window.hydro !== undefined || window.__ready === true", timeout=120000)
    pg.wait_for_timeout(300)
    pg.evaluate("document.fonts.ready.then(() => true)")
    print(f"ready in {time.time()-t0:.1f}s", file=sys.stderr)
    renderer = pg.evaluate("(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()")
    print("GPU:", renderer, file=sys.stderr)
    if a.js:
        pg.evaluate(a.js)
    time.sleep(a.wait)
    pg.screenshot(path=a.out)
    for l in logs:
        if "error" in l.lower():
            print(l, file=sys.stderr)
    br.close()
print("saved", a.out)
