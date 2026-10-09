#!/usr/bin/env bash
# Makes the images, video and audio of the media page, from nothing: every file
# is generated (ffmpeg's and ImageMagick's own sources), so there is nothing to
# license. The results are committed in public/media/; run this again only to
# change them. Needs ffmpeg (with libsvtav1, libvpx-vp9, libx264, libopus,
# libmp3lame), ImageMagick 7 (magick) and cwebp.
set -euo pipefail

cd "$(dirname "$0")/.."
out=public/media
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

ffmpeg_() { ffmpeg -hide_banner -loglevel error -y "$@"; }

# --- Images: three subjects, each at three widths, as AVIF, WebP and JPEG ----

# A landscape at dusk: a gradient sky, a sun, and layered ridges.
magick -size 1600x1000 gradient:'#1e3a8a-#f59e0b' \
  -fill '#fde68a' -draw 'circle 1120,620 1120,540' \
  -fill '#7c2d12' -draw 'polygon 0,760 220,610 420,700 640,560 900,690 1150,600 1400,700 1600,640 1600,1000 0,1000' \
  -fill '#451a03' -draw 'polygon 0,860 260,760 520,830 780,740 1060,840 1320,770 1600,850 1600,1000 0,1000' \
  -fill '#1c0a02' -draw 'polygon 0,940 300,880 640,930 980,870 1300,920 1600,890 1600,1000 0,1000' \
  "$work/dusk.png"

# A fractal: the Mandelbrot set.
ffmpeg_ -f lavfi -i "mandelbrot=size=1600x1000:start_scale=1.4:start_x=-0.75:outer=normalized_iteration_count" \
  -frames:v 1 "$work/fractal.png"

# Cloudy plasma, recoloured: an abstract texture (seeded, so it comes out the same).
magick -seed 42 -size 1600x1000 plasma:'#0ea5e9-#a855f7' -blur 0x12 -modulate 100,140 "$work/plasma.png"

for name in dusk fractal plasma; do
  for width in 480 960 1600; do
    magick "$work/$name.png" -resize "${width}x" -strip -quality 82 "$out/$name-$width.jpg"
    cwebp -quiet -q 78 -resize "$width" 0 "$work/$name.png" -o "$out/$name-$width.webp"
    # AV1 needs even sizes: the heights are 300, 600 and 1000.
    ffmpeg_ -i "$work/$name.png" -vf "scale=$width:-2" -c:v libsvtav1 -crf 38 -pix_fmt yuv420p \
      -frames:v 1 "$out/$name-$width.avif"
  done
done

# --- Video: a zoom into the Mandelbrot set, 8 s, with a poster -----------------
# Not too deep, with few iterations: a deep zoom takes the renderer minutes per second.
# end_pts counts frames (24 per second), not seconds.

ffmpeg_ -f lavfi -i "mandelbrot=size=640x360:rate=24:maxiter=256:start_scale=3:end_scale=0.01:end_pts=192:start_x=-0.743643887037151:start_y=0.131825904205330" \
  -t 8 -pix_fmt yuv420p "$work/zoom.mp4"
ffmpeg_ -i "$work/zoom.mp4" -c:v libvpx-vp9 -crf 50 -b:v 0 -row-mt 1 "$out/zoom.webm"
ffmpeg_ -i "$work/zoom.mp4" -c:v libx264 -crf 34 -preset slow -movflags +faststart "$out/zoom.mp4"
ffmpeg_ -ss 1 -i "$work/zoom.mp4" -frames:v 1 -q:v 4 "$out/zoom-poster.jpg"

# --- Audio: a short chord that rises, 4 s, as Opus and MP3 ---------------------

ffmpeg_ -f lavfi -i "aevalsrc='0.2*sin(2*PI*(220+40*t)*t)+0.15*sin(2*PI*(277+50*t)*t)+0.12*sin(2*PI*(330+60*t)*t)':s=48000:d=4" \
  -af "afade=t=in:d=0.3,afade=t=out:st=3.4:d=0.6" "$work/chord.wav"
ffmpeg_ -i "$work/chord.wav" -c:a libopus -b:a 64k "$out/chord.opus"
ffmpeg_ -i "$work/chord.wav" -c:a libmp3lame -q:a 6 "$out/chord.mp3"

ls -la "$out"
