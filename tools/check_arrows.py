"""3D 箭頭與標籤在四個標準尺寸下的實際畫面位置：標籤不能蓋住箭頭、標籤要貼近自己的箭頭、都要在畫面內。

用法：bash ~/.claude/skills/opus-video/scripts/ov python tools/check_arrows.py <頁面，例如 ch01/u1-2/> <第幾頁> <輸出資料夾>
（需先開本機網站 8790；檢查該頁每一個分段，並把每個尺寸的畫面拼成一張 sheet）
"""
import sys, os
from playwright.sync_api import sync_playwright
from PIL import Image

PAGE, SLIDE, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.makedirs(OUT, exist_ok=True)
SIZES = [('13吋 MacBook Air', 1470, 832, 2), ('14吋 MacBook Pro', 1512, 862, 2), ('27吋 QHD', 2560, 1300, 1), ('32吋 4K', 3008, 1560, 2)]

# 每個箭頭（arrowMesh 群組）投影到畫面的外框；每個標籤的外框；箭頭和標籤用顏色配對
MEASURE = r"""(() => {
  const cam = hydro.camera, v = cam.position.clone(), out = { arrows: [], labels: [] };
  const vw = innerWidth, vh = innerHeight;
  hydro.scene.traverse((o) => {
    if (!o.isGroup || !o.userData || !o.userData.mat || !o.visible) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    o.updateMatrixWorld(true);
    for (const m of o.children) {
      m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
      for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
        v.set(cx, cy, cz).applyMatrix4(m.matrixWorld).project(cam);
        const sx = (v.x + 1) / 2 * vw, sy = (1 - v.y) / 2 * vh;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    }
    out.arrows.push({ color: '#' + o.userData.mat.color.getHexString(), x0, y0, x1, y1 });
  });
  for (const el of document.querySelectorAll('.hc-label')) {
    if (el.closest('[style*="display: none"]') || getComputedStyle(el).opacity === '0') continue;
    const b = el.querySelector('.hc-label__box').getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!b.width) continue;
    out.labels.push({ name: el.textContent.trim().split(/\s+/).slice(0, 2).join(' '), x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, ax: (r.left + r.right) / 2, ay: r.bottom });
  }
  return out;
})()"""
PAIR = {'入流': '#2b86e0', 'Inflow': '#2b86e0', '出流': '#c26a1d', 'Outflow': '#c26a1d'}

def gap(a, b):  # 兩個框的距離（重疊為負）
    dx = max(a['x0'] - b['x1'], b['x0'] - a['x1']); dy = max(a['y0'] - b['y1'], b['y0'] - a['y1'])
    return max(dx, dy)

ok = True
with sync_playwright() as p:
    br = p.chromium.launch(headless=True, channel="chrome", args=["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"])
    for name, w, h, dpr in SIZES:
        pg = br.new_page(viewport={"width": w, "height": h}, device_scale_factor=dpr)
        pg.goto(f"http://127.0.0.1:8790/{PAGE}#/{SLIDE}")
        pg.wait_for_function("window.__ready === true", timeout=240000)
        nf = pg.evaluate(f"deck.frags({SLIDE - 1}).length")
        print(f"=== {name} {w}×{h}")
        shots = []
        for fr in range(nf + 1):
            pg.evaluate(f"deck.go({SLIDE - 1}, {fr})"); pg.wait_for_timeout(6500 if fr else 2500)
            m = pg.evaluate(MEASURE)
            probs, dist = [], []
            for l in m['labels']:
                for a in m['arrows']:
                    if gap(l, a) < -2: probs.append(f"「{l['name']}」蓋住 {a['color']} 箭頭")
                col = next((c for k, c in PAIR.items() if l['name'].startswith(k)), None)
                if col:
                    mine = [a for a in m['arrows'] if a['color'] == col]
                    if not mine: probs.append(f"「{l['name']}」找不到自己的箭頭"); continue
                    a = mine[0]
                    # 標籤框底到箭頭頂的距離（標籤要在箭頭正上方，水平中心落在箭頭範圍內）
                    over = a['x0'] - 10 <= (l['x0'] + l['x1']) / 2 <= a['x1'] + 10
                    d = a['y0'] - l['y1'] if over else 1e9
                    dist.append(f"{l['name'][:2]} {d:.0f}px")
                    if d > 0.02 * h or d < -2: probs.append(f"「{l['name']}」離箭頭 {'不在正上方' if d == 1e9 else f'{d:.0f}px'}（上限 {0.02 * h:.0f}px）")
            for o in m['labels'] + m['arrows']:
                if o['x0'] < 0 or o['y0'] < 0 or o['x1'] > w or o['y1'] > h: probs.append(f"超出畫面 {o.get('name', o.get('color'))}")
            print(f"  分段 {fr}：" + ('正常' if not probs else '；'.join(probs)) + f"　（標籤到箭頭：{', '.join(dist)}）")
            ok = ok and not probs
            f = os.path.join(OUT, f"{w}x{h}_f{fr}.png"); pg.screenshot(path=f); shots.append(f)
        pg.close()
        tw = 640; th = int(tw * h / w)
        S = Image.new('RGB', (tw * len(shots), th), 'white')
        for k, f in enumerate(shots): S.paste(Image.open(f).convert('RGB').resize((tw, th)), (k * tw, 0))
        S.save(os.path.join(OUT, f"sheet_{w}x{h}.jpg"), quality=85)
    br.close()
print('全部正常' if ok else '有問題')
