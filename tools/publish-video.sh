#!/usr/bin/env bash
# 把做好的影片放上網站：壓成 1080p、切成 HLS 小段，擷取封面和縮圖（做法沿用師大教材網站）。
# Cloudflare Pages 單檔上限 25 MiB、也不支援 Range 請求（mp4 無法拖曳），所以網站只放 HLS。
#
# 用法：bash tools/publish-video.sh <母帶 mp4> <網站影片資料夾> [封面秒數] [分享檔名]
#   例：bash tools/publish-video.sh production/ch01/u1-1/out/1-1.mp4 site/media/ch01/u1-1 3 "水文學 1-1 水文循環"
#
# 產生（網站影片資料夾裡）：
#   hls/index.m3u8、hls/init.mp4、hls/segNN.m4s   1920×1080、H.264 CRF 23、每 6 秒一段
#   poster.jpg（1920×1080）、thumb.jpg（640×360）
# 給了分享檔名時，另外輸出 分享/<分享檔名>.mp4（1080p，方便傳給別人；不放進 git）
# 先寫到暫存資料夾，全部成功才換上去，失敗時原本的影片不會壞。
set -euo pipefail
cd "$(dirname "$0")/.."

src="${1:?用法：tools/publish-video.sh <母帶 mp4> <網站影片資料夾> [封面秒數] [分享檔名]}"
dest="${2:?用法：tools/publish-video.sh <母帶 mp4> <網站影片資料夾> [封面秒數] [分享檔名]}"
poster_at="${3:-3}"
share_name="${4:-}"
[ -f "$src" ] || { echo "找不到影片：$src" >&2; exit 1; }

conda_bin="$HOME/anaconda3/envs/opus-video/Library/bin"
if [ -n "${FFMPEG:-}" ]; then ffmpeg="$FFMPEG"
elif command -v ffmpeg >/dev/null 2>&1; then ffmpeg="ffmpeg"
elif [ -x "$conda_bin/ffmpeg.exe" ]; then ffmpeg="$conda_bin/ffmpeg.exe"
else echo "找不到 ffmpeg，請用 FFMPEG=... 指定" >&2; exit 1
fi
ffprobe="${ffmpeg%ffmpeg*}ffprobe${ffmpeg##*ffmpeg}"
[ "$ffmpeg" = "ffmpeg" ] && ffprobe="ffprobe"

duration=$("$ffprobe" -v error -show_entries format=duration -of csv=p=0 "$src")
mkdir -p "$dest"
tmp="$dest/.publish-tmp"
rm -rf "$tmp"
mkdir -p "$tmp/hls"
trap 'rm -rf "$tmp"' EXIT

echo "壓縮並切段（$(printf '%.0f' "$duration") 秒）……"
"$ffmpeg" -v error -y -i "$src" \
  -vf "scale=1920:1080:flags=lanczos" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -profile:v high -x264-params aq-mode=3 \
  -force_key_frames "expr:gte(t,n_forced*6)" -sc_threshold 0 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod \
  -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "$tmp/hls/seg%03d.m4s" "$tmp/hls/index.m3u8"

echo "擷取 ${poster_at} 秒的畫面當封面……"
"$ffmpeg" -v error -y -ss "$poster_at" -i "$src" -frames:v 1 -vf "scale=1920:1080:flags=lanczos" -q:v 3 "$tmp/poster.jpg"
"$ffmpeg" -v error -y -i "$tmp/poster.jpg" -vf "scale=640:360:flags=lanczos" -q:v 4 "$tmp/thumb.jpg"

# 單檔不能超過 Cloudflare Pages 的 25 MiB
for f in "$tmp"/hls/* "$tmp"/*.jpg; do
  [ -f "$f" ] || continue
  if [ "$(wc -c < "$f")" -ge $((25 * 1024 * 1024)) ]; then echo "$(basename "$f") 超過 25 MiB，沒有放上去" >&2; exit 1; fi
done

rm -rf "$dest/hls"
mv "$tmp/hls" "$dest/hls"
mv -f "$tmp/poster.jpg" "$dest/poster.jpg"
mv -f "$tmp/thumb.jpg" "$dest/thumb.jpg"

if [ -n "$share_name" ]; then
  mkdir -p 分享
  echo "輸出分享用 mp4……"
  "$ffmpeg" -v error -y -i "$src" -vf "scale=1920:1080:flags=lanczos" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
    -x264-params aq-mode=3 -c:a aac -b:a 128k -movflags +faststart "分享/$share_name.mp4"
fi

secs=$(printf '%.0f' "$duration")
echo "完成：$dest"
echo "  HLS $(ls "$dest/hls" | wc -l) 個檔案，共 $(du -sh "$dest/hls" | cut -f1)，長度 $((secs / 60)) 分 $(printf '%02d' $((secs % 60))) 秒"
[ -n "$share_name" ] && echo "  分享檔：分享/$share_name.mp4（$(du -sh "分享/$share_name.mp4" | cut -f1)）"
exit 0
