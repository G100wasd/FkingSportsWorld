"""桌面外壳的关闭策略（仅打包窗口模式）。

点窗口右上角关闭时：
- 无排队提交 → 放行关闭；webview.start() 返回后主线程登出并退出。
- 有排队提交 → 取消关闭、隐藏窗口到托盘保活；队列跑完后弹 Windows
  通知，GRACE_S 秒后自动登出退出（期间可从托盘"显示窗口"或"退出"）。

托盘菜单：
    账号 张三          信息项（不可点）
    距提交 08:32       信息项：最近一个待执行 job 的倒计时（打开菜单时取值）
    取消排队           弹出排队中的 job（正在执行的不可取消）
    ─────────
    显示窗口           恢复窗口，取消自动退出
    退出               登出后结束进程
"""

import sys
import threading
import time
from pathlib import Path

from . import queue, state

GRACE_S = 60          # 提交完成后的自动退出等待


def active_jobs() -> list:
    """仍会执行的 job：failed 不会再跑；账号与当前登录用户不符的
    （登出/换号）在当前登录态下也不会跑，两者都不算。"""
    user = state.current_user()
    return [(u, j) for u, j in queue.jobs.items()
            if j.get("state") != "failed" and j.get("username") == user]


def _icon_image():
    from PIL import Image
    # 打包：logo.ico 在 _MEIPASS 根；源码：backend/logo.ico
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))
    p = base / "logo.ico"
    return Image.open(p) if p.exists() else Image.new("RGB", (64, 64), (96, 128, 88))


class TrayKeeper:
    def __init__(self, window):
        self.window = window
        self.quitting = False     # True 后 closing 一律放行
        self.gen = 0              # 每次进/出托盘自增：旧监视线程见到变化即退出
        self.icon = None
        window.events.closing += self._on_closing

    # —— 菜单动态文本 ——
    def _account_text(self):
        sess = state.sess_cache.get("sess")
        name = getattr(sess, "name", "") if sess else ""
        return "账号 " + (name or state.current_user() or "未登录")

    def _countdown_text(self):
        acts = active_jobs()
        if not acts:
            return "无排队任务"
        waiting = [(u, j) for u, j in acts if u not in queue.firing]
        if not waiting:
            return "提交执行中…"
        _, j = min(waiting, key=lambda t: t[1].get("fire_at") or 0)
        left = max(0, int(((j.get("fire_at") or 0) - queue.now_ms()) / 1000))
        what = "开跑" if j.get("kind") == "deferred" else "提交"
        return f"距{what} {left // 60:02d}:{left % 60:02d}"

    def _cancellable(self):
        return any(u not in queue.firing for u, _ in active_jobs())

    # —— 窗口关闭拦截 ——
    def _on_closing(self):
        if self.quitting or not active_jobs():
            self.quitting = True
            return True
        # 不能在 GUI 线程的事件回调里直接 hide（会等 GUI 线程自己）
        threading.Thread(target=self._to_tray, daemon=True).start()
        return False

    def _to_tray(self):
        import pystray
        self.gen += 1
        gen = self.gen
        self.window.hide()
        self.icon = pystray.Icon(
            "wasdSports", _icon_image(), "wasdSports：提交排队中",
            menu=pystray.Menu(
                pystray.MenuItem(lambda i: self._account_text(), None,
                                 enabled=False),
                pystray.MenuItem(lambda i: self._countdown_text(), None,
                                 enabled=False),
                pystray.MenuItem("取消排队", self._cancel,
                                 enabled=lambda i: self._cancellable()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("显示窗口", self._restore, default=True),
                pystray.MenuItem(
                    lambda i: "退出（放弃排队并登出）" if active_jobs()
                    else "退出（登出）", self._quit)))
        self.icon.run(setup=lambda ic: self._watch(ic, gen))

    # —— 托盘期间：等队列跑完 → 通知 → 宽限期 → 自动退出 ——
    def _watch(self, icon, gen):
        icon.visible = True
        icon.notify("有提交正在排队，已最小化到托盘；提交完成后自动登出退出。",
                    "wasdSports")
        t0 = queue.now_ms()
        while active_jobs():
            if self.gen != gen:
                return
            icon.title = "wasdSports：" + self._countdown_text()
            time.sleep(1)
        if self.gen != gen:
            return
        lf = queue.last_fired or {}
        if lf.get("ok") and lf.get("ts", 0) >= t0:
            msg = f"提交成功 rrid={lf.get('rrid')}，{GRACE_S} 秒后自动登出退出。"
        else:
            errs = [j.get("last_error") for j in queue.jobs.values()
                    if j.get("state") == "failed" and j.get("last_error")]
            msg = (f"提交失败：{errs[-1] if errs else '排队已取消'}；"
                   f"{GRACE_S} 秒后自动登出退出。")
        icon.title = "wasdSports：" + msg
        icon.notify(msg, "wasdSports")
        for left in range(GRACE_S, 0, -1):
            if self.gen != gen:
                return
            icon.title = f"wasdSports：已提交，{left} 秒后登出退出"
            time.sleep(1)
        self._quit()

    # —— 托盘菜单 ——
    def _cancel(self, *_):
        """取消排队：弹出未到期的 job；正在执行的任务无法取消。"""
        blocked = False
        for u, j in list(queue.jobs.items()):
            if j.get("state") == "failed":
                continue
            if u in queue.firing:
                blocked = True
            else:
                queue.jobs.pop(u, None)
        if blocked:
            self.icon.notify("已取消等待中的任务；执行中的提交无法取消，"
                             "完成后仍将自动退出。", "wasdSports")
            return
        self.icon.notify("已取消排队提交。", "wasdSports")
        self._restore()          # 队列清空 → 回到窗口，按正常关闭流程走

    def _restore(self, *_):
        self.gen += 1             # 作废监视线程：回到前台后按正常关闭流程重新判定
        if self.icon:
            self.icon.stop()
            self.icon = None
        self.window.show()

    def _quit(self, *_):
        if self.quitting:
            return
        self.quitting = True
        self.gen += 1
        try:
            state.close_session()     # 先登出远端会话，再杀窗口
        except Exception:
            pass
        if self.icon:
            self.icon.stop()
            self.icon = None
        self.window.destroy()
