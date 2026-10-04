"""把 data/dem/taiwan_z10.npz 轉成網頁用的高程檔（site/data/taiwan_dem.bin，Int16 公尺，列優先）＋說明檔 json，並輸出預覽圖"""
import json, math, os
import numpy as np
from PIL import Image
R = os.path.join(os.path.dirname(__file__), "..")
d = np.load(os.path.join(R, "data/dem/taiwan_z10.npz"))
elev = d["elev"]; lon0, lon1, lat0, lat1 = float(d["lon0"]), float(d["lon1"]), float(d["lat0"]), float(d["lat1"])
H, W = elev.shape
Z = 10
def lat_to_y(lat):
    r = math.radians(lat); return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z * 256
def lon_to_x(lon): return (lon + 180) / 360 * 2 ** Z * 256
x0p = lon_to_x(lon0); y0p = lat_to_y(lat1)
# 裁切：119.9–122.1E、21.85–25.35N（本島＋周圍海床；澎湖放不進方形就算了）
c = dict(lon0=119.9, lon1=122.15, lat0=21.85, lat1=25.35)
xa, xb = int(lon_to_x(c["lon0"]) - x0p), int(lon_to_x(c["lon1"]) - x0p)
ya, yb = int(lat_to_y(c["lat1"]) - y0p), int(lat_to_y(c["lat0"]) - y0p)
crop = elev[ya:yb, xa:xb]
# 縮成約 640 寬
k = 2
crop = crop[: crop.shape[0] // k * k, : crop.shape[1] // k * k].reshape(crop.shape[0] // k, k, crop.shape[1] // k, k).mean(axis=(1, 3))
crop = np.clip(crop, -4000, 4000).astype(np.int16)
h, w = crop.shape
os.makedirs(os.path.join(R, "site/data"), exist_ok=True)
crop.tofile(os.path.join(R, "site/data/taiwan_dem.bin"))
# 每像素大約多少公尺（緯度 23.6 度）
mpp_x = (c["lon1"] - c["lon0"]) * 111320 * math.cos(math.radians(23.6)) / w
mpp_y = (c["lat1"] - c["lat0"]) * 110574 / h
meta = dict(width=w, height=h, dtype="int16", unit="m", order="row-major, north first", **c, mpp_x=round(mpp_x, 1), mpp_y=round(mpp_y, 1),
            source="AWS Terrain Tiles (Terrarium, z10): SRTM 陸地、ETOPO1/GEBCO 海床", max=int(crop.max()), min=int(crop.min()))
json.dump(meta, open(os.path.join(R, "site/data/taiwan_dem.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# 預覽
gy, gx = np.gradient(crop.astype(np.float32))
shade = np.clip(0.6 + (-gx * 0.6 - gy * 0.6) / 400, 0, 1)
col = np.zeros((h, w, 3))
land = crop > 0
t = np.clip(crop / 3500, 0, 1)
col[land] = (np.array([0.45, 0.6, 0.35]) * (1 - t[land, None]) + np.array([0.75, 0.7, 0.62]) * t[land, None])
col[~land] = np.array([0.25, 0.45, 0.65]) * (0.6 + 0.4 * np.clip(1 + crop[~land, None] / 4000, 0, 1))
img = (np.clip(col * shade[..., None] * 1.2, 0, 1) * 255).astype(np.uint8)
Image.fromarray(img).save(os.path.join(R, "data/dem/taiwan_preview.png"))
print(meta)
