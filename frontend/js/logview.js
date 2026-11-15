/* ---------- 日志视图：地图右下浮动按钮切换，轮询 /api/logs ---------- */
(function () {
  let _on = false, _timer = null, _last = 0, _pending = false;
  const MAX_DOM = 1500;

  function _mkLine(level, text, dim) {
    const d = document.createElement("div");
    if (dim) { d.className = "log-dim"; d.textContent = text; return d; }
    d.className = "lg lg-" + level;
    const tag = document.createElement("span");
    tag.className = "lt";
    tag.textContent = "[" + level + "]";
    d.appendChild(tag);
    d.appendChild(document.createTextNode(text));
    return d;
  }

  async function _poll() {
    if (_pending) return;
    _pending = true;
    try {
      const r = await fetch("/api/logs?after=" + _last);
      const d = await r.json();
      const pre = $("log-lines");
      if (!pre) return;
      // 追加前先记一次是否贴底：用户上翻查看历史时不强拉到底
      const nearBottom =
        pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 40;
      if (d.dropped > 0)
        pre.appendChild(_mkLine("", "// …省略 " + d.dropped + " 行", true));
      (d.lines || []).forEach(([seq, level, text]) => {
        if (seq <= _last) return;
        _last = seq;
        pre.appendChild(_mkLine(level, text));
      });
      while (pre.childElementCount > MAX_DOM)
        pre.removeChild(pre.firstChild);
      if (nearBottom) pre.scrollTop = pre.scrollHeight;
    } catch (e) {
      /* 服务未就绪/网络抖动：下轮重试 */
    } finally {
      _pending = false;
    }
  }

  function setLogView(on) {
    _on = on;
    $("log-view").classList.toggle("off", !on);
    $("btn-log").classList.toggle("active", on);
    $("btn-log").title = on ? "返回地图" : "后台日志";
    if (on) {
      _last = 0;
      $("log-lines").innerHTML = "";
      _poll();
      _timer = setInterval(_poll, 800);
    } else if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  $("btn-log").onclick = () => setLogView(!_on);
  window.setLogView = setLogView;   // session.js/boot.js 登录态联动用
  setLogView(true);                 // 启动默认进日志视图：能看到后端启动输出
})();
