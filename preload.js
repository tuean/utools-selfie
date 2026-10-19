// uTools 前置脚本:Node 环境。
// 相机采集:ffmpeg 经 CamHelper.app 由 `open` 启动,脱离 uTools 责任链成为独立 TCC 实体(可正常授权)。
// 双进程:预览进程常驻(写 prev.jpg),录制进程按需启停(写分段 mp4)。
// 日志:~/Library/Logs/utools-selfie.log
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
const DEVICE = '0:0'; // 第一个摄像头 : 第一个麦克风
const APP = path.join(__dirname, 'CamHelper.app');
const LOG = path.join(os.homedir(), 'Library', 'Logs', 'utools-selfie.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try {
    try { if (fs.statSync(LOG).size > 5 * 1024 * 1024) fs.writeFileSync(LOG, ''); } catch (e) {}
    fs.appendFileSync(LOG, line);
  } catch (e) {}
}

let dir = null, prevPath = null, prevPid = null, recPid = null, recPath = null;
let lastPath = null, frameCount = 0, closing = false;
let prevTimer = null, pidTimers = [];
let frameCb = null, statusCb = null, doneCb = null;

const ts = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function status(msg) { try { statusCb && statusCb(msg); } catch (e) {} }
function pageLog(msg) { log('[page]', msg); }
function ffTail(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').slice(-300) : ''; } catch (e) { return ''; }
}

// 通过 open 启动 CamHelper,轮询 pid 文件
function launchHelper(mode, pidPath, outPath, errPath, onPid) {
  const op = spawn('/usr/bin/open', ['-n', APP, '--args', mode, pidPath, outPath, errPath, DEVICE, FFMPEG], { stdio: ['ignore', 'ignore', 'pipe'] });
  op.on('error', (e) => { log('open error:', e.message); status('启动助手失败: ' + e.message); });
  let tries = 0;
  const t = setInterval(() => {
    try {
      const p = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
      if (p) { clearInterval(t); onPid(p); log('launched', mode, 'pid =', p); }
    } catch (e) {}
    if (++tries > 30) { clearInterval(t); log('pid 文件超时(mode=' + mode + '), ff.log=', ffTail(errPath)); }
  }, 200);
  pidTimers.push(t);
}

// ---------- 预览(常驻) ----------
function startPreview() {
  if (dir) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  prevPath = path.join(dir, 'prev.jpg');
  frameCount = 0;
  log('preview start, dir=', dir);
  launchHelper('preview', path.join(dir, 'pid-prev'), prevPath, path.join(dir, 'prev.log'), (p) => { prevPid = p; });

  let lastM = 0;
  prevTimer = setInterval(() => {
    try {
      const st = fs.statSync(prevPath);
      if (st.mtimeMs > lastM) {
        lastM = st.mtimeMs;
        frameCount++;
        const buf = fs.readFileSync(prevPath);
        frameCb && frameCb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      }
    } catch (e) {}
  }, 120);

  setTimeout(() => {
    if (frameCount === 0 && !closing) {
      log('no frames in 15s, prev.log=', ffTail(path.join(dir, 'prev.log')));
      status('未收到摄像头画面。若弹出「ffmpeg 想访问相机/麦克风」请点「允许」;没弹窗则检查 系统设置→隐私与安全性→相机 里是否有 ffmpeg。日志: ' + LOG);
    }
  }, 15000);
  status('正在启动摄像头…');
}

// ---------- 录制(按需) ----------
function startRecord() {
  if (recPid || !dir) return;
  recPath = path.join(dir, `rec-${ts()}.mp4`);
  log('record start ->', recPath);
  launchHelper('record', path.join(dir, 'pid-rec'), recPath, path.join(dir, 'rec.log'), (p) => { recPid = p; });
  status('录制中…');
}

function stopRecord() {
  if (!recPid) return;
  log('stopRecord: SIGKILL', recPid);
  status('处理中…');
  try { process.kill(recPid, 'SIGKILL'); } catch (e) { log('SIGKILL fail:', e.message); }
  recPid = null;
  setTimeout(finalize, 400); // 等文件落定
}

function finalize() {
  const rp = recPath; recPath = null;
  if (!rp || !fs.existsSync(rp) || fs.statSync(rp).size < 1000) {
    const why = ffTail(path.join(dir, 'rec.log')) || '(无错误输出)';
    log('record produced no file, stderr=', why);
    doneCb && doneCb({ ok: false, error: `未生成有效视频(录制时间过短或相机不可用)。\n详情见日志: ${LOG}\nffmpeg: ${why}` });
    return;
  }
  const suggested = `录像-${ts()}.mp4`;
  const defaultPath = path.join(os.homedir(), 'Movies', suggested);
  let savePath = null;
  try { savePath = utools.showSaveDialog({ defaultPath }); } catch (e) { log('showSaveDialog threw:', e.message); }
  if (!savePath) { log('dialog cancelled, fallback=', defaultPath); savePath = defaultPath; }
  log('saving ->', savePath);
  try {
    fs.copyFileSync(rp, savePath);
    lastPath = savePath;
    log('saved OK, size=', fs.statSync(savePath).size);
    doneCb && doneCb({ ok: true, path: savePath });
  } catch (e) {
    log('copy failed:', e.stack || e.message);
    doneCb && doneCb({ ok: false, error: `保存失败: ${e.message}\n日志: ${LOG}` });
  }
}

function saveAs() {
  if (!lastPath || !fs.existsSync(lastPath)) return null;
  const p = utools.showSaveDialog({ defaultPath: lastPath });
  if (!p) return null;
  try { fs.copyFileSync(lastPath, p); lastPath = p; log('saveAs ->', p); return p; } catch (e) { log('saveAs failed:', e.stack || e.message); return { error: e.message }; }
}

function showInFinder() {
  if (lastPath) utools.shellShowItemInFolder(lastPath);
}

function openLog() {
  log('openLog');
  try { utools.shellOpenPath(LOG); } catch (e) { status('无法打开日志: ' + e.message); }
}

function close() {
  log('close: SIGKILL');
  closing = true;
  if (prevTimer) { clearInterval(prevTimer); prevTimer = null; }
  pidTimers.forEach(clearInterval); pidTimers = [];
  try { if (prevPid) process.kill(prevPid, 'SIGKILL'); } catch (e) {}
  try { if (recPid) process.kill(recPid, 'SIGKILL'); } catch (e) {}
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} dir = null; }
}

window.camRecorder = {
  startPreview, startRecord, stopRecord, saveAs, showInFinder, openLog, close,
  log: pageLog,
  onFrame: (cb) => { frameCb = cb; },
  onStatus: (cb) => { statusCb = cb; },
  onDone: (cb) => { doneCb = cb; }
};
log('preload loaded, ffmpeg=', FFMPEG, 'device=', DEVICE);
