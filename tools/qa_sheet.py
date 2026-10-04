"""影片檢查用接觸印樣：每句旁白取一格（說到 60% 時），拼成大圖，方便一眼檢查構圖、字幕、3D

用法：ov python tools/qa_sheet.py production/ch01/u1-1 [影片路徑]
輸出：production/.../qa/sheet_1.jpg、sheet_2.jpg…（每張 12 格）
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

prod = sys.argv[1]
tl = json.load(open(os.path.join(prod, "timeline.json"), encoding="utf-8"))
video = sys.argv[2] if len(sys.argv) > 2 else os.path.join(prod, "out", os.path.basename(os.path.normpath(prod)).lstrip("u") + ".mp4")
qa = os.path.join(prod, "qa"); os.makedirs(qa, exist_ok=True)
W = 640
frames = []
for c in tl["cues"]:
    t = c["speak"] + 0.6 * c["dur"]
    p = os.path.join(qa, f"f{c['n']:02d}.jpg")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", f"scale={W}:-1", "-q:v", "3", p], check=True)
    frames.append((c, p))
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", 18)
except Exception:
    font = ImageFont.load_default()
per = 12
for s in range(0, len(frames), per):
    chunk = frames[s:s + per]
    cols = 3; rows = (len(chunk) + cols - 1) // cols
    H = int(W * 9 / 16)
    sheet = Image.new("RGB", (cols * W, rows * (H + 28)), "white")
    d = ImageDraw.Draw(sheet)
    for k, (c, p) in enumerate(chunk):
        x, y = (k % cols) * W, (k // cols) * (H + 28)
        sheet.paste(Image.open(p), (x, y + 28))
        d.text((x + 6, y + 4), f"#{c['n']:02d}  slide {c['slide']}/{c['frag']}  t={c['speak']:.1f}s", fill="black", font=font)
    out = os.path.join(qa, f"sheet_{s // per + 1}.jpg")
    sheet.save(out, quality=88)
    print(out)
