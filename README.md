# 摄像头录像 (uTools 插件)

通过 Mac 前置摄像头录制视频,保存为 **MP4(含声音)**。

## 原理与坑(重要)
uTools.app 用**硬化运行时**签名但**缺少 `com.apple.security.device.camera` 权利**,导致:
- webview 的 getUserMedia 能拿到流对象但**永远没有帧**(video/MediaRecorder/ImageCapture 全部无数据)
- 直接子进程的 ffmpeg 相机请求被 TCC 直接拒绝(`requires entitlement ... denied`),无法弹窗

**解法**: 内置 `CamHelper.app`(微型脚本 app,无需 Xcode)——插件用 `open` 通过 LaunchServices 启动它,使进程脱离 uTools 责任链,`exec ffmpeg` 后 **ffmpeg 成为独立 TCC 实体**,可正常弹出相机/麦克风授权框。首次点允许即可,ffmpeg 会在「系统设置 → 隐私与安全性 → 相机/麦克风」生成条目。

**工作流**(双进程):
- **预览进程常驻**: `open` 启动 CamHelper → ffmpeg 写单帧预览图,页面 `<img>` 实时显示(约 8fps)
- **录制进程按需**: 点「开始录像」才启动,录**分段 mp4**(frag_keyframe+empty_moov,可安全强杀)
- 点「停止」= SIGKILL 录制进程(预览不受影响)→ 保存对话框 → 存完回到初始化,可再录

**使用流程**: 打开→实时预览→开始录像→停止→保存→回到预览可再录。

## 加载到 uTools(开发者模式)
1. uTools → 设置 → 插件 → 开发者模式
2. 移除旧版「摄像头录像」→ 载入本目录
3. 输入 `录像` 或 `摄像头` 打开

## 首次使用
打开后若弹「ffmpeg 想访问您的相机 / 麦克风」→ **点允许**。授权一次即可。
若没弹窗,可在「系统设置 → 隐私与安全性 → 相机 / 麦克风」里找到 ffmpeg 并开启。

## 依赖
- ffmpeg(必需): `brew install ffmpeg`

## 日志
`~/Library/Logs/utools-selfie.log`(界面「日志」按钮打开)。

## 结构
- `plugin.json` — 插件清单
- `preload.js` — 启动助手/录像/预览/保存(Node),暴露 `window.camRecorder`
- `CamHelper.app` — 独立 TCC 实体的宿主(脚本 app,内含 ffmpeg 启动器)
- `index.html` — 预览 + 按钮(页面)
- `test.js` — 集成自检: `node test.js`
