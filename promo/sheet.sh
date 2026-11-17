#!/bin/sh
# 截几帧并排成一张图，方便一眼看完：sh sheet.sh overview 1.6,3.3,5.2,7.5
rm -f out/stills/$1-*.png
node render.mjs $1 --stills $2 --scale 1 >/dev/null || exit 1
n=$(ls out/stills/$1-*.png | wc -l)
ffmpeg -y -loglevel error -pattern_type glob -i "out/stills/$1-*.png" -vf "tile=${n}x1:padding=8:color=gray" -frames:v 1 out/stills/sheet.png
