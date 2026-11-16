/* ---------- 全局状态 / 通用工具 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// #status(顶栏) 与 #m-status(登录卡) 共用 .statusline 样式，setStatus 双写。
// 状态文字只显示固定短语，详细内容经 /api/log 进日志视图。
const _STATUS_BRIEF = { on: "ONLINE", busy: "WORKING", err: "ERROR", off: "OFFLINE" };
function logLine(level, text) {
  fetch("/api/log", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, text: String(text) }) }).catch(() => {});
}
let map = null, sess = null, AMap_ = null;
let locMarker = null, picking = false;
let overlays = [];
let fitOverlays = [];
let trackLocs = [];
let origLocs = [];
let lapIdx = [];
let snapIdx = [];
let trackSegs = [];
let ctrls = [];
let ctrlTotal = 8;
let ctrlWeight = 0.8;
let ctrlRadius = 12;
let editing = false;
let lastFit = null;
let FE = { run: {}, frontend: {} };

function setStatus(cls, text) {
  [["status", "status-txt"], ["m-status", "m-status-txt"]].forEach(([a, b]) => {
    const el = $(a), t = $(b);
    if (el) el.className = "statusline " + cls;
    if (t) t.textContent = _STATUS_BRIEF[cls] ?? text;
  });
  if (text && _STATUS_BRIEF[cls] !== undefined)
    logLine(cls === "err" ? "ERROR" : "INFO", text);
}

// 左下状态块：off=未登录灰三角 // idle=待机金三角 // busy=作业中
function setRunBlock(state) {
  const b = $("map-block"), t = b.querySelector(".t");
  b.classList.toggle("off", state === "off");
  t.innerHTML = state === "off" ? "//&nbsp;OFFLINE"
              : state === "busy" ? "RUN&nbsp;//&nbsp;WORKING"
              : "RUN&nbsp;//&nbsp;STANDBY";
}

async function api(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || ("HTTP " + r.status));
  return d;
}

// 按钮结果闪烁：绿底 ✓成功 / 红底 ✗失败（可自定义文字），1s 后恢复原样；
// done：恢复后的回调（按业务状态重算按钮可用性/文字）
function flashBtnResult(b, ok, resetText, flashText, done) {
  b.classList.remove("ok", "fail");
  b.classList.add(ok ? "ok" : "fail");
  b.textContent = flashText || (ok ? "✓ 成功" : "✗ 失败");
  setTimeout(() => {
    b.classList.remove("ok", "fail");
    b.textContent = resetText;
    // 排队锁定期间不解禁被锁按钮：记到锁前状态里，解锁时再恢复
    const lk = typeof _lockPrev !== "undefined" && _lockPrev;
    if (lk && b.id in lk) lk[b.id] = false;
    else b.disabled = false;
    if (done) done();
  }, 1000);
}
