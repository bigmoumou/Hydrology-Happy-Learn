# 第三方元件與資料聲明

本專案自己寫的程式與內容授權見 [LICENSE](LICENSE)。下面列出的項目不適用那份授權，依各自的條款。

## 內附的第三方程式

- **three.js r186**（`site/vendor/three/`）：MIT License，Copyright © 2010–2025 three.js authors。授權全文見 `site/vendor/three/LICENSE`。https://github.com/mrdoob/three.js
- **hls.js 1.6.15 light**（`site/vendor/hls/`）：Apache License 2.0，Copyright (c) 2017 Dailymotion；部分程式衍生自 videojs-contrib-hls，Copyright (c) 2013-2015 Brightcove。授權見 `site/vendor/hls/hls.LICENSE.txt` 與 `LICENSE-Apache-2.0.txt`。https://github.com/video-dev/hls.js

## 字型（SIL Open Font License 1.1）

`site/vendor/fonts/` 是下列字型的子集（只含網站用到的字），https://openfontlicense.org/

- Noto Sans TC、Noto Serif TC（思源黑體、思源宋體 繁體中文）：https://github.com/notofonts/noto-cjk
- JetBrains Mono：https://github.com/JetBrains/JetBrainsMono

## 地形資料

單元 1-3 的台灣地形（`site/data/taiwan_dem.bin`）由 [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)（Mapzen／Tilezen 的 Terrarium 格式）重新取樣而來，約 280 m 一格。依其[資料來源聲明](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)：

- SRTM：NASA／USGS，公共領域
- ETOPO1：Amante, C. and B. W. Eakins, 2009. ETOPO1 1 Arc-Minute Global Relief Model. NOAA Technical Memorandum NESDIS NGDC-24. National Geophysical Data Center, NOAA. doi:10.7289/V5C8276M
- GMTED2010、NED 等其他來源依 Tilezen 聲明

## 旁白語音

教學影片的旁白由 [edge-tts](https://github.com/rany2/edge-tts) 呼叫 Microsoft 的神經語音（zh-TW-HsiaoChenNeural）合成。

## 其他

- 影片製作環境沿用 opus-video skill 的工具（原作者周行 Kianzzz，MIT 授權）。
- 網站與影片由使用者與 Claude Code（Anthropic Claude）協作完成。
