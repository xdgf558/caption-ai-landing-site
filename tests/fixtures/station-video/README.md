# 可解码视频夹具

`gentle-synthetic.mp4` 是本机测试素材，使用已选猫咪插画及 440Hz 合成音，不是真实歌曲、MV、发布配置或素材权利证明。文件 239372 字节，30 秒、640×360、12fps、H.264/yuv420p + AAC。`manifest.json` 保存文件、源图哈希及编码方法；运行时核对哈希后才将其写入一次性 D1/R2。

短片和 MV 两条记录共用这一个文件，另有故意损坏的 100 字节片段用于错误重试。原影片链接为合成地址。默认旧媒体夹具不变，只有 `videoCases` 明确开启才载入这些记录。

CI 读取已检入文件，不安装编码器。需要重建时，在项目外准备可用 FFmpeg，将本地二进制路径传给工具；本次使用官方 npm registry 的 `@ffmpeg-installer/darwin-arm64@4.1.5`（FFmpeg 4.4），跳过安装脚本，没有改项目依赖或锁文件。

```sh
node scripts/generate-station-video-fixture.mjs /absolute/path/to/ffmpeg
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
node scripts/build-station-clip-home-preview.mjs
npm run test:redesign:clips
STATION_MUSIC_PREVIEW_VIDEO_CASES=1 STATION_MUSIC_PREVIEW_HOME_CLIPS=1 node scripts/serve-station-music-preview.mjs
```

本机预览只监听 127.0.0.1:4208，首页为 `/__preview/home-clips/zh-Hant/`，歌曲视频页为 `/music/tracks/vip/`。首页预览是独立构建图，不随生产构建部署。真实媒体与移动浏览器验收仍需另外完成。
