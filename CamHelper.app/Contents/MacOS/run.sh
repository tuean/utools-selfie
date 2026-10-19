#!/bin/sh
# 摄像头录像助手:被 `open` 启动,脱离 uTools 责任链;exec 使 ffmpeg 成为独立 TCC 实体
# 用法: run.sh <mode:preview|record> <pidfile> <输出文件> <ff.log> <设备> <ffmpeg路径>
echo $$ > "$2"
case "$1" in
  preview)
    exec "$6" -hide_banner -loglevel error -f avfoundation -framerate 30 -video_size 1280x720 -i "$5" -map 0:v -vf scale=640:-2 -f image2 -update 1 -q:v 5 "$3" 2>"$4"
    ;;
  record)
    exec "$6" -hide_banner -loglevel error -f avfoundation -framerate 30 -video_size 1280x720 -i "$5" -map 0:v -map 0:a -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov "$3" 2>"$4"
    ;;
esac
