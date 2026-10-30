#!/bin/bash
# Join the filmed segments into the showcase video and add the sound track.
# usage: tools/film/encode.sh OUTDIR      (OUTDIR as given to film.cjs) -> OUTDIR/mapa-gusinja-showcase.mp4
set -euo pipefail
OUT=$(realpath "$1"); HERE=$(dirname "$(realpath "$0")")
mkdir -p "$OUT/seg"; : > "$OUT/seg/list.txt"
V=(-c:v libx264 -preset veryfast -crf 20 -r 30 -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
   -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
for d in "$OUT"/frames/*/; do
  n=$(basename "$d")
  ffmpeg -y -v error -framerate 30 -i "$d/%05d.jpg" "${V[@]}" "$OUT/seg/$n.tmp.mp4"
  mv "$OUT/seg/$n.tmp.mp4" "$OUT/seg/$n.mp4"
  echo "file '$n.mp4'" >> "$OUT/seg/list.txt"
done
ffmpeg -y -v error -f concat -safe 0 -i "$OUT/seg/list.txt" -c copy "$OUT/video.tmp.mp4" && mv "$OUT/video.tmp.mp4" "$OUT/video.mp4"
python3 "$HERE/music.py" "$OUT/events.json" "$OUT/music.wav"
ffmpeg -y -v error -i "$OUT/video.mp4" -i "$OUT/music.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
  -movflags +faststart "$OUT/mapa-gusinja-showcase.tmp.mp4"
mv "$OUT/mapa-gusinja-showcase.tmp.mp4" "$OUT/mapa-gusinja-showcase.mp4"
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of compact "$OUT/mapa-gusinja-showcase.mp4"
