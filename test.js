// 集成自检:真实运行 preload.js 双进程方案(mock 掉 window/utools)
// 流程:预览常驻 → 开始录像 → 停止(SIGKILL) → 保存成功 → 预览仍可用
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camtest-'));
const savedPath = path.join(outDir, 'out.mp4');

global.window = {};
global.utools = {
  showSaveDialog: () => savedPath,
  shellShowItemInFolder: () => {},
  shellOpenPath: () => {}
};

require('./preload.js');
const cam = window.camRecorder;

let frames = 0, lastStatus = '';
cam.onFrame(() => { frames++; });
cam.onStatus((t) => { lastStatus = t; });

let saved = false;
cam.onDone((res) => {
  saved = true;
  assert(res.ok, `保存失败: ${res.error} | status=${lastStatus}`);
  assert(fs.existsSync(res.path), '文件不存在');
  const out = execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', res.path], { encoding: 'utf8' });
  const types = out.trim().split('\n').map((s) => s.trim());
  assert(types.includes('video') && types.includes('audio'), `缺流: ${types}`);
  console.log(`PASS: 录制保存 = ${types.join(',')}`);
});

let watchdog = setTimeout(() => { console.error(`FAIL: 超时 | frames=${frames} status=${lastStatus} saved=${saved}`); process.exit(1); }, 40000);

cam.startPreview();
setTimeout(() => {
  assert(frames > 5, `预览帧太少: ${frames} | status=${lastStatus}`);
  console.log(`PASS: 初始化预览帧 = ${frames}`);
  cam.startRecord();
  setTimeout(() => cam.stopRecord(), 5000); // 录 5s 后停止
}, 4000);

// 保存完成后,确认预览仍在继续(回到初始化状态)
setTimeout(() => {
  if (saved) {
    const f1 = frames;
    setTimeout(() => {
      assert(frames > f1, '保存后预览应继续');
      console.log(`PASS: 保存后预览继续 (${f1} -> ${frames})`);
      cam.close();
      fs.rmSync(outDir, { recursive: true, force: true });
      process.exit(0);
    }, 2000);
  }
}, 15000);
