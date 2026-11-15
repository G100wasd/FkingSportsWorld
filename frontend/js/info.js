/* ---------- 信息卡：学期进度 + 历史记录（存活/异常区分） ---------- */
(function () {
  let _busy = false;

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

  function renderSemester(sm, records) {
    const el = $("info-semester");
    const s = (sm && sm.summary) || {}, p = (sm && sm.personal) || {},
          c = (sm && sm.completed) || {};
    if (!Object.keys(s).length && !Object.keys(p).length && !Object.keys(c).length) {
      const err = (sm && (sm.summary_error || sm.personal_error)) || "";
      el.innerHTML = `<div class="hint">学期数据获取失败${err ? "：" + esc(err) : ""}</div>`;
      return;
    }
    // 有效次数：summary 全 0 的学校回退 personal/completed 字段
    const validN = s.semesterValidCount || c.semesterValidCount || p.semesterValid || 0;
    const goalN = s.semesterCount || c.semesterGoalCount || p.semesterGoal || 0;
    // 已完成里程：服务端 summary 恒 0 时，本地按"学期内 + status==0"累计
    let doneDis = s.semesterValidDis || 0;
    if (!doneDis && Array.isArray(records) && p.startDate && p.endDate) {
      doneDis = records.reduce((acc, r) =>
        acc + ((r.status === 0 && r.startTime >= p.startDate &&
                r.startTime <= p.endDate) ? (+r.validDis || +r.totalDis || 0) : 0), 0);
    }
    const cells = [
      ["学期", s.sname || p.sname || "—"],
      ["有效次数", `${validN} / ${goalN}`],
      ["已完成里程", fmtKm(doneDis)],
      ["学期区间", p.startDate ?
        `${fmtDate(p.startDate).slice(0, 5)} ~ ${fmtDate(p.endDate).slice(0, 5)}` : "—"],
    ];
    el.innerHTML = '<div class="kv-grid">' + cells.map(([k, v]) =>
      `<div class="kv"><b>${esc(v)}</b><span>${k}</span></div>`).join("") + "</div>";
  }

  function renderRecords(list) {
    const el = $("info-records");
    if (!Array.isArray(list) || !list.length) {
      el.innerHTML = '<div class="hint">无记录</div>';
      return;
    }
    el.innerHTML = list.map(r => {
      const [cls, label] = recStatus(r);
      return `<div class="rec-row">` +
        `<span class="rec-date">${esc(fmtDate(r.startTime))}</span>` +
        `<span class="rec-dis">${esc(fmtKm(r.totalDis))}</span>` +
        `<span class="rec-dur">${esc(fmtDur(r.totalTime))}</span>` +
        `<span class="rec-tag ${cls}">${esc(label)}</span></div>`;
    }).join("");
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
    semEl.innerHTML = '<div class="hint">加载中…</div>';
    recEl.innerHTML = '<div class="hint">加载中…</div>';
    try {
      const d = await (await fetch("/api/myinfo")).json();
      renderSemester(d.semester, d.records);
      renderRecords(d.records);
      const raw = $("info-raw");
      if (raw) raw.textContent = JSON.stringify(d, null, 1);
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
