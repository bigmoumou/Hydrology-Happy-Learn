"""把網站用到的字從完整字型中抽出來，做成小的 woff2（公開網站載入快很多）

用法（opus-video 環境有 fontTools＋brotli）：
  bash ~/.claude/skills/opus-video/scripts/ov python tools/subset_fonts.py

來源：site/vendor/fonts/*.ttf（完整字型，不放進 git）
輸出：site/vendor/fonts/hydro-sans.woff2、hydro-serif.woff2、hydro-mono.woff2、hydro-mono-bold.woff2
字集：site/ 底下所有 .html/.js/.css/.json 出現的字＋ ASCII＋常用標點。新增內容後要重跑一次；
      萬一有字沒收進來，瀏覽器會自動改用系統字型顯示那個字，不會變成方塊。
"""
import glob, os
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
FONTS = os.path.join(ROOT, "vendor", "fonts")

chars = set(chr(c) for c in range(0x20, 0x7F))
chars |= set("　、。，．：；？！「」『』（）〔〕【】《》〈〉—–…‧·・／～﹏％＋－×÷＝≈≤≥≠→←↑↓●○■□▶◀★☆°′″℃·－＿｜")
chars |= set("ΔΣαβγδεθλμπρστφωΩ²³¹⁰⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉ₛₒ√∞∑∫∂")
for ext in ("html", "js", "css", "json", "md"):
    for p in glob.glob(os.path.join(ROOT, "**", f"*.{ext}"), recursive=True):
        if os.sep + "vendor" + os.sep in p:
            continue
        chars |= set(open(p, encoding="utf-8", errors="ignore").read())
chars = {c for c in chars if c.isprintable() or c == " "}
text = "".join(sorted(chars))
print(f"{len(chars)} 個字")

jobs = [
    ("NotoSansTC-VF.ttf", "hydro-sans.woff2"),
    ("NotoSerifTC-VF.ttf", "hydro-serif.woff2"),
    ("JetBrainsMono-Regular.ttf", "hydro-mono.woff2"),
    ("JetBrainsMono-Bold.ttf", "hydro-mono-bold.woff2"),
]
for src, dst in jobs:
    sp = os.path.join(FONTS, src)
    if not os.path.exists(sp):
        print("略過（找不到）", src)
        continue
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    font = TTFont(sp)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    out = os.path.join(FONTS, dst)
    font.flavor = "woff2"
    font.save(out)
    print(f"{dst}: {os.path.getsize(out) / 1024:.0f} KB")
