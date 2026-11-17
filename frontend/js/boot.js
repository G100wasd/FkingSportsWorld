/* ---------- 启动 ---------- */
(async function boot() {
  try {
    const d = await fetch("/api/defaults").then(r => r.json());
    FE = d;
    if (d.username) { $("inp-user").value = d.username; $("m-user").value = d.username; }
    if (d.password) { $("inp-pass").value = d.password; $("m-pass").value = d.password; }
    const R = d.run || {}, F = d.frontend || {}, C = F.ctrl || {};
    CFG_DEFAULT_DIST = R.default_dist ?? CFG_DEFAULT_DIST;
    CFG_DEFAULT_DUR = R.default_dur ?? CFG_DEFAULT_DUR;
    CFG_ADDRESS = R.address || "";
    CFG_ADDRESS_PROV = R.address_prov || "";
    if (R.start_window) [CFG_START_LO, CFG_START_HI] = R.start_window;
    MAX_REFIT = F.max_refit ?? MAX_REFIT;
    LAP_COLORS = F.lap_colors || LAP_COLORS;
    TAPER_PTS = F.taper_points ?? TAPER_PTS;
    SAMPLE_ROWS = F.sample_rows ?? SAMPLE_ROWS;
    ctrlTotal = C.total ?? ctrlTotal;
    ctrlWeight = C.weight ?? ctrlWeight;
    ctrlRadius = C.radius ?? ctrlRadius;
    // 区间回填：有区间用区间，没有则标量两端同值
    const _fill = (base, lo, hi, fmt) => {
      $(base + "-lo").value = fmt ? fmt(lo) : lo;
      $(base + "-hi").value = fmt ? fmt(hi) : hi;
    };
    const dr = R.dist_range || [CFG_DEFAULT_DIST, CFG_DEFAULT_DIST];
    _fill("cfg-dist", dr[0], dr[1]);
    const ur = R.dur_range || [CFG_DEFAULT_DUR, CFG_DEFAULT_DUR];
    _fill("cfg-dur", ur[0], ur[1], fmtDur);
    // 日期/伪装时间不回填：留空 = 本地当前日期/时刻（会话值不落盘）
    const T = d.track || {};
    const sr = T.stride_range || [T.stride_mean ?? 1.2, T.stride_mean ?? 1.2];
    _fill("cfg-stride", sr[0], sr[1]);
    const ar = T.alt_range || [T.alt_cap ?? 55.5, T.alt_cap ?? 55.5];
    _fill("cfg-alt", ar[0], ar[1]);
    const cr = T.cadmax_range || [T.cad_max ?? 260, T.cad_max ?? 260];
    _fill("cfg-cadmax", cr[0], cr[1]);
    $("ctrl-count").max = C.max || 10;
    $("ctrl-count").value = ctrlTotal;
    $("ctrl-count-val").textContent = ctrlTotal;
    $("ctrl-weight").value = ctrlWeight;
    $("ctrl-weight-val").textContent = ctrlWeight;
    $("ctrl-radius").value = ctrlRadius;
    $("ctrl-radius-val").textContent = ctrlRadius + "m";
  } catch (e) {
    console.warn("配置下发失败，使用内置默认值", e);
  }
  updateCfgHint();
  updateAddrWarn();

  if (FE.username && FE.password) setStatus("busy", "正在恢复登录…");
  try {
    const d = await fetch("/api/session").then(r => r.json());
    if (d.logged_in) {
      sess = d;
      const env = d.platform
        ? `${d.platform === "android" ? "Android" : "iOS"} ` +
          `${d.os_version} ${d.device_name}`
        : "";
      setStatus("on", `已登录 ${d.name || ""} (uid=${d.uid})` +
                (env ? ` ｜ ${env}` : ""));
      setAuthState(true);
      setRunBlock("idle");
      await initMap().catch(() => {});
      if (!applyAnchor(d.anchor) && map) locateMe(AMap_);
      updateAutoBtn();
      setLogView(false);             // 会话已恢复：切回地图视图
      refreshInfo();                 // 信息卡预载学期/记录
      if (AUTO_MODE) runAutoFlow();    // ?auto 链接：会话有效直接开跑
    } else if (d.login_error) {
      setStatus("err", "自动登录失败: " + d.login_error);
    }
  } catch (e) { /* 忽略 */ }
  renderLoginInfo();
  // 手机端未登录：默认落登录卡
  if (!sess && compact()) gotoCard("c-login");
})();
