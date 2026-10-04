#!/bin/bash
# 依序產生影片並發布到網站（HLS）＋分享用 mp4：bash tools/render_units.sh ch01/u1-2 ch01/u1-3
set -e
cd "$(dirname "$0")/.."
OV="bash $HOME/.claude/skills/opus-video/scripts/ov"
for u in "$@"; do
  name=$(basename "$u" | sed 's/^u//')          # u1-2 -> 1-2
  ch=$(dirname "$u")                            # ch01
  echo "=== $u ($name) ==="
  PYTHONUNBUFFERED=1 $OV python -u tools/make_video.py "production/$u"
  title=$(PYTHONIOENCODING=utf-8 python -c "import json,sys; print(json.load(open(sys.argv[1], encoding='utf-8'))['unit'])" "production/$u/script.json")
  bash tools/publish-video.sh "production/$u/out/$name.mp4" "site/media/$u" 3 "水文學 $title"
  $OV python tools/qa_sheet.py "production/$u" "production/$u/out/$name.mp4"
  echo "=== published $u ==="
done
