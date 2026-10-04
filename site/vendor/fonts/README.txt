字型（皆為 SIL Open Font License 1.1，可自由使用與散布，https://openfontlicense.org/）
- hydro-sans.woff2：Noto Sans TC（思源黑體 繁體中文）的子集，https://github.com/notofonts/noto-cjk
- hydro-serif.woff2：Noto Serif TC（思源宋體 繁體中文）的子集，https://github.com/notofonts/noto-cjk
- hydro-mono.woff2、hydro-mono-bold.woff2：JetBrains Mono 的子集，https://github.com/JetBrains/JetBrainsMono
子集只包含網站用到的字，由 tools/subset_fonts.py 從完整字型產生；完整的 .ttf 不放進 git。
電腦已安裝同名字型時，網站會優先使用本機字型。
