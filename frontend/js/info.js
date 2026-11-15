/* ---------- 信息卡：学期进度 + 历史记录（存活/异常区分 + 详情展开） ---------- */
(function () {
  let _busy = false;
  const _detailCache = {};   // rrid -> {detail, obs, obs_error}

  /* 记录状态：实测 status 数值型——0=正常/存活，非 0（如 2）=异常/已清空。 */
  function recStatus(r) {
    if (typeof r.status === "number")
      return r.status === 0 ? ["ok", "正常"] : ["bad", "异常"];
    if (typeof r.statusInfo === "string" && r.statusInfo.trim()) {
      return /有效|正常|通过|达标/.test(r.statusInfo)
        ? ["ok", r.statusInfo] : ["bad", r.statusInfo];
    }
    if (r.complete === false) return ["bad", "未完成"];
    return ["dim", "—"];
  }

  const fmtDate = ms => {
    const d = new Date(+ms);
    return isNaN(d) ? "—" :
      `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ` +
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const fmtDur = s => {
    s = +s || 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };
  const fmtKm = m => ((+m || 0) / 1000).toFixed(2) + "km";
  const fmtPace = sec => {           // 秒/公里 -> m'ss"
    if (!isFinite(sec) || sec <= 0) return "—";
    return `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, "0")}"`;
  };

  function renderSemester(sm, records) {
    const el = $("info-semester");
    const s = (sm && sm.summary) || {}, p = (sm && sm.personal) || {},
          c = (sm && sm.completed) || {};
    const hasRecs = Array.isArray(records) && records.length;
    if (!Object.keys(s).length && !Object.keys(p).length &&
        !Object.keys(c).length && !hasRecs) {
      const err = (sm && (sm.summary_error || sm.personal_error)) || "";
      el.innerHTML = `<div class="hint">学期数据获取失败${err ? "：" + esc(err) : ""}</div>`;
      return;
    }
    // 已完成里程：同一天多次只算一次，取当天最早一条的 validDis；
    // 学期区间缺失时退化为全部存活记录按天累计
    let doneDis = s.semesterValidDis || 0;
    if (!doneDis && Array.isArray(records)) {
      const inSem = r => r.status === 0 &&
        (!p.startDate || (r.startTime >= p.startDate && r.startTime <= p.endDate));
      const perDay = {};
      for (const r of records) {
        if (!inSem(r)) continue;
        const day = new Date(+r.startTime).toDateString();
        if (!perDay[day] || +r.startTime < +perDay[day].startTime) perDay[day] = r;
      }
      doneDis = Object.values(perDay)
        .reduce((acc, r) => acc + (+r.validDis || +r.totalDis || 0), 0);
    }
    el.innerHTML = `<div class="sem-done"><b>${esc(fmtKm(doneDis))}</b>` +
      `<span>已完成里程</span></div>`;
  }

  /* ---------- canvas 小图 ---------- */

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    return v || fallback;
  }

  /* 通用折线图：xs 等距索引即可，ys 数值数组。 */
  function lineChart(cv, ys, { fmt = v => v.toFixed(0), color } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const pad = { l: 38, r: 6, t: 6, b: 4 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vals = ys.filter(v => isFinite(v));
    if (!vals.length) { ctx.fillStyle = "#999"; ctx.font = "10px monospace";
      ctx.fillText("NO DATA", pad.l, h / 2); return; }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const X = i => pad.l + (ys.length > 1 ? i / (ys.length - 1) : 0.5) * iw;
    const Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * ih;
    ctx.strokeStyle = "#e5e5e5"; ctx.lineWidth = 1;
    for (const gy of [0, 0.5, 1]) {
      const y = pad.t + gy * ih;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    ctx.fillStyle = "#999"; ctx.font = "9px monospace"; ctx.textAlign = "right";
    ctx.fillText(fmt(hi), pad.l - 4, pad.t + 8);
    ctx.fillText(fmt(lo), pad.l - 4, pad.t + ih);
    ctx.beginPath();
    ys.forEach((v, i) => {
      if (!isFinite(v)) return;
      const x = X(i), y = Y(v);
      i === 0 || !isFinite(ys[i - 1]) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color || cssVar("--accent", "#d99a2b");
    ctx.lineWidth = 1.4; ctx.stroke();
  }

  /* 轨迹图：GCJ02 点集投影到 canvas，起点绿点/终点红点。 */
  function drawTrack(cv, pts) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const ok = pts.filter(p => isFinite(+p.gLat) && isFinite(+p.gLng));
    if (ok.length < 2) { ctx.fillStyle = "#999"; ctx.font = "10px monospace";
      ctx.fillText("NO TRACK", 8, h / 2); return; }
    const lats = ok.map(p => +p.gLat), lngs = ok.map(p => +p.gLng);
    const [la0, la1] = [Math.min(...lats), Math.max(...lats)];
    const [ln0, ln1] = [Math.min(...lngs), Math.max(...lngs)];
    const pad = 10;
    const sc = Math.min((w - pad * 2) / Math.max(ln1 - ln0, 1e-9),
                        (h - pad * 2) / Math.max(la1 - la0, 1e-9));
    const cx = (ln0 + ln1) / 2, cy = (la0 + la1) / 2;
    const X = p => w / 2 + (+p.gLng - cx) * sc;
    const Y = p => h / 2 - (+p.gLat - cy) * sc;
    ctx.beginPath();
    ok.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)));
    ctx.strokeStyle = cssVar("--accent", "#d99a2b");
    ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
    for (const [p, c] of [[ok[0], "#2f9e55"], [ok[ok.length - 1], "#d33"]]) {
      ctx.beginPath(); ctx.arc(X(p), Y(p), 3, 0, 7);
      ctx.fillStyle = c; ctx.fill();
    }
  }

  /* ---------- 记录详情展开 ---------- */

  function renderDetail(panel, d) {
    const obs = d.obs || {};
    let html = "";
    const pts = Array.isArray(obs.points) ? obs.points : [];
    const sp = Array.isArray(obs.speed_json) ? obs.speed_json : [];
    const st = Array.isArray(obs.step_freq_json) ? obs.step_freq_json : [];
    if (pts.length > 1 || sp.length) {
      html += '<canvas class="rec-track"></canvas>';
      html += '<div class="rec-charts">' +
        [["配速", "pace"], ["步幅", "stride"], ["步频", "cad"], ["海拔", "alt"]]
          .map(([t, k]) => `<div class="rec-chart"><em>${t}</em>` +
            `<canvas data-c="${k}"></canvas></div>`).join("") + "</div>";
    } else {
      html += `<div class="hint">轨迹数据不可用` +
        `${d.obs_error ? "：" + esc(d.obs_error) : ""}</div>`;
    }
    panel.innerHTML = html;

    const track = panel.querySelector(".rec-track");
    if (track && pts.length > 1) drawTrack(track, pts);
    const winSec = w => Math.max((+w.endTime - +w.beginTime) / 1000, 0.001);
    const series = {
      pace:   sp.map(w => w.distance > 0 ? winSec(w) / (w.distance / 1000) : NaN),
      stride: sp.map((w, i) => {
        const sn = st[i] && +st[i].stepsNum;
        return (w.distance > 0 && sn > 0) ? w.distance / sn * 100 : NaN;
      }),
      cad:    st.map(w => +w.stepsNum > 0 ? +w.stepsNum / (winSec(w) / 60) : NaN),
      alt:    pts.map(p => +p.bdA),
    };
    const fmts = {
      pace: v => fmtPace(v), stride: v => v.toFixed(0) + "cm",
      cad: v => v.toFixed(0), alt: v => v.toFixed(0) + "m",
    };
    panel.querySelectorAll("canvas[data-c]").forEach(cv =>
      lineChart(cv, series[cv.dataset.c], { fmt: fmts[cv.dataset.c] }));
  }

  async function toggleDetail(row, rrid) {
    const panel = row.nextElementSibling;
    const open = panel.classList.toggle("open");
    row.classList.toggle("open", open);
    if (!open || panel.dataset.loaded) return;
    panel.dataset.loaded = "1";
    panel.innerHTML = '<div class="hint">加载中…</div>';
    try {
      const d = _detailCache[rrid] ||
        (_detailCache[rrid] = await (await fetch(
          `/api/record_detail?rrid=${rrid}` +
          `&uuid=${encodeURIComponent(row.dataset.uuid || "")}` +
          `&start=${row.dataset.start || 0}`)).json());
      renderDetail(panel, d);
    } catch (e) {
      panel.innerHTML = `<div class="hint">详情获取失败：${esc(e.message)}</div>`;
    }
  }

  function renderRecords(list) {
    const el = $("info-records");
    if (!Array.isArray(list) || !list.length) {
      el.innerHTML = '<div class="hint">无记录</div>';
      return;
    }
    el.innerHTML = list.map(r => {
      const [cls, label] = recStatus(r);
      return `<div class="rec-row" data-rrid="${r.rrid}" ` +
        `data-uuid="${esc(r.uuid || "")}" data-start="${r.startTime || 0}">` +
        `<span class="rec-date">${esc(fmtDate(r.startTime))}</span>` +
        `<span class="rec-dis">${esc(fmtKm(r.totalDis))}</span>` +
        `<span class="rec-dur">${esc(fmtDur(r.totalTime))}</span>` +
        `<span class="rec-tag ${cls}">${esc(label)}</span>` +
        `<span class="rec-caret">▾</span></div><div class="rec-detail"></div>`;
    }).join("");
    el.querySelectorAll(".rec-row").forEach(row =>
      row.addEventListener("click", () => toggleDetail(row, row.dataset.rrid)));
  }

  async function refreshInfo() {
    if (_busy) return;
    const semEl = $("info-semester"), recEl = $("info-records");
    if (!sess) {
      semEl.innerHTML = '<div class="hint">未登录</div>';
      recEl.innerHTML = '<div class="hint">未登录</div>';
      return;
    }
    _busy = true;
    for (const k in _detailCache) delete _detailCache[k];
    semEl.innerHTML = '<div class="hint">加载中…</div>';
    recEl.innerHTML = '<div class="hint">加载中…</div>';
    try {
      const d = await (await fetch("/api/myinfo")).json();
      renderSemester(d.semester, d.records);
      renderRecords(d.records);
    } catch (e) {
      const m = `<div class="hint">获取失败：${esc(e.message)}</div>`;
      semEl.innerHTML = m;
      recEl.innerHTML = m;
    } finally {
      _busy = false;
    }
  }

  document.querySelector('.rail-ico[data-card="c-info"]')
    .addEventListener("click", refreshInfo);
  $("btn-info-refresh").onclick = refreshInfo;
  window.refreshInfo = refreshInfo;   // session.js 登录成功后联动
})();
