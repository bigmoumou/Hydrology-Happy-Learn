"""下載台灣的公開地形資料（AWS Terrain Tiles，Terrarium 格式），拼成一張高程圖

來源：https://registry.opendata.aws/terrain-tiles/（Mapzen／AWS Open Data；陸地主要是 SRTM，海底是 ETOPO1／GEBCO）
編碼：高程(m) = R*256 + G + B/256 - 32768
縮放層級 10，解析度約 140 m／像素。

用法：python tools/fetch_dem.py
輸出：data/dem/tiles/10/x_y.png（原始圖磚）、data/dem/taiwan_z10.npz（高程陣列＋經緯度範圍）
"""
import math, os, sys, time, urllib.request, concurrent.futures as cf
import numpy as np
from PIL import Image

Z = 10
LON0, LON1, LAT0, LAT1 = 119.3, 122.4, 21.7, 25.5   # 台灣本島＋澎湖
ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "dem")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

def tx(lon): return int((lon + 180) / 360 * 2 ** Z)
def ty(lat):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z)

xs = range(tx(LON0), tx(LON1) + 1)
ys = range(ty(LAT1), ty(LAT0) + 1)
os.makedirs(os.path.join(ROOT, "tiles", str(Z)), exist_ok=True)

def get(xy):
    x, y = xy
    p = os.path.join(ROOT, "tiles", str(Z), f"{x}_{y}.png")
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p, 0
    req = urllib.request.Request(URL.format(z=Z, x=x, y=y), headers={"User-Agent": "hydrology-course/1.0 (personal study)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            open(p, "wb").write(data)
            return p, len(data)
        except Exception as e:
            time.sleep(1.5 * (attempt + 1))
            err = e
    raise RuntimeError(f"tile {x},{y}: {err}")

jobs = [(x, y) for y in ys for x in xs]
print(f"{len(jobs)} tiles, x {xs.start}..{xs.stop-1}, y {ys.start}..{ys.stop-1}")
total = 0
with cf.ThreadPoolExecutor(4) as ex:
    for p, n in ex.map(get, jobs):
        total += n
print(f"downloaded {total/1e6:.1f} MB")

W, H = len(xs) * 256, len(ys) * 256
elev = np.zeros((H, W), np.float32)
for j, y in enumerate(ys):
    for i, x in enumerate(xs):
        a = np.asarray(Image.open(os.path.join(ROOT, "tiles", str(Z), f"{x}_{y}.png")).convert("RGB"), np.float32)
        elev[j*256:(j+1)*256, i*256:(i+1)*256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
def lon_of(x): return x / 2 ** Z * 360 - 180
def lat_of(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** Z))))
bounds = dict(lon0=lon_of(xs.start), lon1=lon_of(xs.stop), lat1=lat_of(ys.start), lat0=lat_of(ys.stop))
np.savez_compressed(os.path.join(ROOT, f"taiwan_z{Z}.npz"), elev=elev, **bounds)
print("mosaic", elev.shape, "min/max", float(elev.min()), float(elev.max()), bounds)
