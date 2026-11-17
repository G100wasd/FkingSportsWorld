/* ---------- 跑步配置 ---------- */
let CFG_DEFAULT_DIST = 2200, CFG_DEFAULT_DUR = 720;
let CFG_START_LO = 6, CFG_START_HI = 22;
let TAPER_PTS = 14;
let SAMPLE_ROWS = 40;

function halfWidth(s) {
  return s.replace(/[：∶]/g, ":")
          .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}
function parseDur(raw) {
  // HH:MM:SS / MM:SS / 纯秒。注意：match 数组长度恒为"组数+1"，
  // 不能用它区分有无小时位——未命中的组是 undefined（曾导致 NaN，
  // 用时配置被静默忽略、全程回退默认值）
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,3}):([0-5]\d)$/);
  if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
  const v = parseFloat(raw);
  return isFinite(v) && v > 0 ? Math.round(v) : null;
}
/* 数值区间输入：两个框同排 [lo ~ hi]，任一空/非正数 → null；
   写反了自动交换，不为难用户 */
function rngNum(id) {
  const lo = parseFloat(halfWidth(($(id + "-lo").value || "").trim()));
  const hi = parseFloat(halfWidth(($(id + "-hi").value || "").trim()));
  return (isFinite(lo) && isFinite(hi) && lo > 0 && hi > 0)
    ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
}
function rngDur() {
  const a = parseDur(halfWidth(($("cfg-dur-lo").value || "").trim()));
  const b = parseDur(halfWidth(($("cfg-dur-hi").value || "").trim()));
  return (a && b) ? [Math.min(a, b), Math.max(a, b)] : null;
}
function cfgDistRange() { return rngNum("cfg-dist") || [CFG_DEFAULT_DIST, CFG_DEFAULT_DIST]; }
function cfgDurRange() { return rngDur() || [CFG_DEFAULT_DUR, CFG_DEFAULT_DUR]; }
// 中点：仅用于警告/提示文案，提交时由后端在区间内采样
function cfgDist() { const r = cfgDistRange(); return (r[0] + r[1]) / 2; }
function cfgEffDur() { const r = cfgDurRange(); return Math.round((r[0] + r[1]) / 2); }
/* 派生展示：均速=距离/用时，步频=均速·60/步幅（生成器内部
   cadence 本就由瞬时速度/步幅派生，这里只预告取值范围） */
function updateDerivedHint() {
  const [dl, dh] = cfgDistRange(), [tl, th] = cfgDurRange();
  const st = rngNum("cfg-stride");
  const vlo = dl / th, vhi = dh / tl;
  let t = `均速 ≈${vlo.toFixed(2)}~${vhi.toFixed(2)} m/s`;
  if (st) t += ` · 步频 ≈${Math.round(vlo * 60 / st[1])}~${Math.round(vhi * 60 / st[0])} spm`;
  $("cfg-derive-hint").textContent = t + "（每次提交在区间内随机取值）";
}
["cfg-dist-lo", "cfg-dist-hi", "cfg-dur-lo", "cfg-dur-hi",
 "cfg-stride-lo", "cfg-stride-hi", "cfg-alt-lo", "cfg-alt-hi",
 "cfg-cadmax-lo", "cfg-cadmax-hi"]
  .forEach(id => $(id).addEventListener("input", updateCfgHint));
// 日期/伪装时间决定提交按钮是"提交记录"还是"延迟提交"
$("cfg-start").addEventListener("input", () => {
  startCache = null;
  updateCfgHint();
  updateSubmitMode();
});
$("cfg-date").addEventListener("input", () => {
  startCache = null;
  updateCfgHint();
  updateSubmitMode();
});

let startCache = null;
function resolveStart() {
  if (!startCache) startCache = computeStart();
  return startCache;
}
function resolveStartMs() { return resolveStart().ms; }

function computeStart() {
  const raw = halfWidth(($("cfg-start").value || "").trim());
  const durMs = cfgEffDur() * 1000 + 60000;
  const dv = ($("cfg-date").value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const sec = Math.floor(Math.random() * 60);

  // 日期/拉取时间为会话值不落盘：留空=本地当前日期/时刻。
  // 合法 HH:MM 一律生效（窗口外只给警告，不静默丢弃——否则
  // "未来时间"判定会被悄悄抹平）。结束在未来合法：定时队列
  // 会等到 end+delay 再提交。
  const base = dv ? new Date(+dv[1], +dv[2] - 1, +dv[3]) : new Date();
  if (m) base.setHours(+m[1], +m[2], sec, 0);
  const ms = base.getTime();
  const warn = (m && ms + durMs > Date.now())
    ? "所选时刻的结束在当前之后，将排队至结束后自动提交" : null;
  return { ms, warn, explicit: !!m,
           outWin: !!m && (+m[1] < CFG_START_LO || +m[1] >= CFG_START_HI) };
}

function updateCfgHint() {
  const { ms, warn } = resolveStart(), d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  const [dl, dh] = cfgDistRange(), [tl, th] = cfgDurRange();
  $("cfg-hint").innerHTML =
    (warn ? `<span style="color:var(--warn)">⚠ ${warn}</span><br>` : "") +
    `拉取：${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    ` ｜ ${dl.toFixed(0)}~${dh.toFixed(0)}m · ` +
    `${fmtDur(tl)}~${fmtDur(th)}`;
  updateDerivedHint();
}

/* ---------- 地点：省市两级下拉（AMap DistrictSearch，市名提交到 address） ---------- */
let CFG_ADDRESS = "", CFG_ADDRESS_PROV = "";
let _addrInit = false;

function updateAddrWarn() {
  const w = $("submit-addr-warn");
  if (w) w.textContent = CFG_ADDRESS ? "" :
    "⚠ 未配置地点：提交记录的地址字段将为空，与真实记录不符" +
    "——请在跑步配置卡选择所在城市";
}

function addrSet(provName, cityName) {
  CFG_ADDRESS_PROV = provName || "";
  CFG_ADDRESS = cityName || "";
  updateAddrWarn();
}

function loadCities(provName) {
  const city = $("cfg-city");
  if (!provName) {
    city.innerHTML = '<option value="">市</option>';
    addrSet("", "");
    return;
  }
  const ds = new AMap_.DistrictSearch({ level: "province", subdistrict: 1 });
  ds.search(provName, (st, res) => {
    const list = (st === "complete" && res.districtList[0].districtList) || [];
    // 直辖市下级是区：保留省名本身作为市级选项
    const names = [provName, ...list.map(d => d.name).filter(Boolean)];
    city.innerHTML = names.map(n => `<option>${esc(n)}</option>`).join("");
    city.value = CFG_ADDRESS || provName;
    addrSet(provName, city.value);
  });
}

function initAddrSelect() {
  if (_addrInit || !AMap_) return;
  _addrInit = true;
  const prov = $("cfg-prov");
  const ds = new AMap_.DistrictSearch({ level: "country", subdistrict: 1 });
  ds.search("中国", (st, res) => {
    if (st !== "complete" || !res.districtList.length) {
      $("cfg-addr-hint").textContent = "行政区数据加载失败（检查 amap_key）";
      return;
    }
    prov.innerHTML = '<option value="">省/直辖市</option>' +
      res.districtList[0].districtList
        .map(d => `<option>${esc(d.name)}</option>`).join("");
    if (CFG_ADDRESS_PROV) { prov.value = CFG_ADDRESS_PROV; loadCities(prov.value); }
  });
  prov.addEventListener("change", () => loadCities(prov.value));
  $("cfg-city").addEventListener("change",
    e => addrSet(prov.value, e.target.value));
}

/* ---------- 保存前的配置检查 ----------
   红字（格式错误）→ 保存按钮下方说明区，且本次不落盘；
   黄字（语义警告）→ 对应输入框下方的 field-hint。 */
const FIELD_HINTS = ["cfg-start-hint", "cfg-dist-hint", "cfg-derive-hint"];
function clearCfgHints() {
  FIELD_HINTS.forEach(id => { const e = $(id); if (e) e.textContent = ""; });
}

function cfgCheck() {
  clearCfgHints();
  const errs = [], num = s => halfWidth((s || "").trim());
  const v = id => num($(id).value);
  // 1) 格式：时间类必须是 时:分 / 分:秒，数值类必须是正数
  const start = v("cfg-start");
  if (start && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(start))
    errs.push("拉取时间格式应为 HH:MM（如 07:30）");
  ["cfg-dur-lo", "cfg-dur-hi"].forEach(id => {
    const d = v(id);
    if (d && !/^(?:\d+:)?\d{1,3}:[0-5]\d$/.test(d))
      errs.push("用时区间格式应为 mm:ss 或 hh:mm:ss（如 12:27）");
  });
  const date = ($("cfg-date").value || "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    errs.push("日期格式不正确");
  [["cfg-dist", "距离"], ["cfg-alt", "最大海拔"],
   ["cfg-stride", "步幅"], ["cfg-cadmax", "最大步频"]]
    .forEach(([base, name]) => ["-lo", "-hi"].forEach(sfx => {
      const raw = v(base + sfx);
      if (raw && !(parseFloat(raw) > 0 && /^\d*\.?\d+$/.test(raw)))
        errs.push(`${name}区间应为正数`);
    }));
  // 区间允许留空（回退默认）；只填一端视为缺失，提示补齐
  ["cfg-dist", "cfg-dur", "cfg-alt", "cfg-stride", "cfg-cadmax"].forEach(b => {
    const a = v(b + "-lo"), c = v(b + "-hi");
    if ((a && !c) || (!a && c)) errs.push("区间需要同时填左右两端，或都留空");
  });
  if (errs.length) return { errs };

  // 2) 语义警告（不阻断保存）
  const st = computeStart(), ms = st.ms, now = Date.now();
  let future = 0;
  const warns = [];
  if (st.outWin)
    warns.push(`该时刻在校方允许的 ${CFG_START_LO}:00-${CFG_START_HI}:00 窗口外`);
  if (start) {
    if (ms > now + 30000) {
      future = ms;
    } else if (now - ms > 120000) {
      warns.push(`拉取时间过远（${Math.round((now - ms) / 60000)} 分钟前），` +
                 `可能导致服务器日志对不上`);
    }
  }
  if (warns.length) $("cfg-start-hint").textContent = warns.join("；");
  if (cfgDist() < 2000)
    $("cfg-dist-hint").textContent =
      `里程 ${cfgDist().toFixed(0)}m 可能不够（多数学校计分跑要求 ≥2000m）`;
  return { errs: [], future };
}
function fitGoal() {
  // dist/dur 传 0：后端在配置区间内采样，每次拟合/提交自然波动
  return { dist: 0, dur: 0, start_ms: resolveStartMs() };
}

/* 保存按钮：当前输入值持久化到服务端 defaultsConfig.json 的 run/track 段；
   拟合/提交链路随后以 JSON 落盘值为准（boot 时全量回填各输入框）。 */
$("btn-cfg-save").onclick = async () => {
  const btn = $("btn-cfg-save");
  const chk = cfgCheck();
  if (chk.errs.length) {        // 格式错误：红字报错，本次不落盘
    flashBtnResult(btn, false, "保存配置");
    $("cfg-hint").innerHTML =
      `<span style="color:var(--red)">配置未保存：` +
      chk.errs.map(esc).join("；") + `</span>`;
    return;
  }
  btn.disabled = true;
  try {
    const payload = {
      dist_range: rngNum("cfg-dist"),
      dur_range: rngDur(),
      stride_range: rngNum("cfg-stride"),
      alt_range: rngNum("cfg-alt"),
      cadmax_range: rngNum("cfg-cadmax"),
      address: CFG_ADDRESS,
      address_prov: CFG_ADDRESS_PROV,
    };
    const r = await api("/api/config", payload);
    CFG_ADDRESS = r.run.address || "";
    CFG_ADDRESS_PROV = r.run.address_prov || "";
    updateAddrWarn();
    if (r.run.start_window) [CFG_START_LO, CFG_START_HI] = r.run.start_window;
    flashBtnResult(btn, true, "保存配置");
    updateCfgHint();
    updateSubmitMode();
    if (chk.future) {
      // 拉取时间在未来：此刻拉不了点（点位是实时下发的），
      // 只能排一个定时任务——直接把用户送到提交卡
      const t = new Date(chk.future);
      const p = n => String(n).padStart(2, "0");
      $("submit-defer-hint").innerHTML =
        `拉取时间设在 ${p(t.getHours())}:${p(t.getMinutes())}（未来）：` +
        `当前无法拉取打卡点，需创建定时任务——点"延迟提交"，` +
        `到点后自动 拉点 → 拟合 → 跑完 → 提交`;
      gotoCard("c-result");
      return;
    }
    $("submit-defer-hint").textContent = "";
    // 已有拟合结果 → 按新配置重算记录数据（跑道几何在服务端缓存，
    // 不重新拟合、不重拉点）；服务端已作废旧提交载荷，必须刷新，
    // 否则会提交与配置不符的记录
    if (lastFit && lastFit.locs && lastFit.locs.length) await recalc();
  } catch (e) {
    flashBtnResult(btn, false, "保存配置");
    $("cfg-hint").innerHTML =
      `<span style="color:var(--red)">保存失败：${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
};
