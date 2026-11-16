"""后台运行日志捕获：stdout/stderr 行级 tee → 环形缓冲 → /api/logs 轮询。

所有 print/logging 输出原样透传到控制台，同时按行推入缓冲供前端
"日志视图"展示。仅过滤 uvicorn 访问日志行：
    INFO:     127.0.0.1:57582 - "GET /static/css/cards.css HTTP/1.1" 200 OK
"""

import re
import sys
import threading
from collections import deque

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# "LEVEL: ... - "METHOD path HTTP/x" ..." 形态的行视为访问日志丢弃
_ACCESS_RE = re.compile(
    r'^(?:INFO|WARNING|ERROR|DEBUG|CRITICAL):[^"]* - "'
    r'(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) ')

# "INFO:     xxx" / "WARNING:  xxx" 形态的标准日志行前缀
_LEVEL_RE = re.compile(r'^(INFO|WARNING|ERROR|DEBUG|CRITICAL):\s*(.*)$')
_LEVEL_NORM = {"DEBUG": "INFO", "CRITICAL": "ERROR"}
_ERR_HINT = re.compile(r"(?i)traceback|error|exception|failed|失败")

_CAP = 800            # 缓冲上限：超出后最旧行被挤出
_buf = deque(maxlen=_CAP)
_lock = threading.Lock()
_seq = 0
_installed = False


_last_level = "INFO"


def _classify(line: str) -> tuple[str, str]:
    """行 → (level, text)。标准 "LEVEL: msg" 直接拆；缩进的续行
    （traceback 帧等）继承上一条级别；其余按关键词猜 INFO/ERROR。"""
    global _last_level
    m = _LEVEL_RE.match(line)
    if m:
        lv = _LEVEL_NORM.get(m.group(1), m.group(1))
        _last_level = lv
        return lv, m.group(2)
    if line[:1] in (" ", "\t"):
        return _last_level, line
    lv = "ERROR" if _ERR_HINT.search(line) else "INFO"
    _last_level = lv
    return lv, line


def _emit(line: str):
    line = _ANSI_RE.sub("", line.rstrip("\r"))
    if not line.strip() or _ACCESS_RE.match(line):
        return
    global _seq
    with _lock:
        _seq += 1
        _buf.append((_seq, *_classify(line)))


class _Tee:
    """行缓冲 tee：先写透原流，再把完整行喂给 _emit。
    __getattr__ 把 fileno/isatty/encoding 等委托回原流，避免
    logging/uvicorn 探测流属性时崩掉。"""

    def __init__(self, wrapped):
        self._w = wrapped
        self._part = ""

    def write(self, s):
        try:
            if self._w is not None:
                self._w.write(s)
        except Exception:
            pass
        self._part += s
        while "\n" in self._part:
            line, self._part = self._part.split("\n", 1)
            _emit(line)

    def flush(self):
        try:
            if self._w is not None:
                self._w.flush()
        except Exception:
            pass

    def __getattr__(self, name):
        if name == "_w":
            raise AttributeError(name)
        w = self.__dict__.get("_w")
        if w is None:
            raise AttributeError(name)
        return getattr(w, name)


def install():
    """把 sys.stdout/sys.stderr 换成 tee。幂等；应在 uvicorn 启动前调用，
    这样服务自身的 print 与 logging（访问日志除外）也进缓冲。"""
    global _installed
    if _installed:
        return
    _installed = True
    sys.stdout = _Tee(sys.stdout)
    sys.stderr = _Tee(sys.stderr)


def emit(level: str, text: str):
    """供 /api/log 直接推一条前端产生的消息进缓冲。"""
    lv = level if level in ("INFO", "WARNING", "ERROR") else "INFO"
    global _seq, _last_level
    with _lock:
        _seq += 1
        _last_level = lv
        _buf.append((_seq, lv, text))


def clear():
    """清空缓冲。seq 不回退：已轮询过的前端水位线不受影响，
    新行继续递增，不会出现旧行重放。"""
    with _lock:
        _buf.clear()


def snapshot(after: int = 0, limit: int = 400) -> dict:
    """返回 seq>after 的行。after 落后于已挤出缓冲的部分时给 dropped 计数，
    前端显示一条省略提示而不是静默缺行。"""
    with _lock:
        items = [it for it in _buf if it[0] > after]
        seq = _seq
        dropped = (_buf[0][0] - after - 1) if (_buf and after
                                             and _buf[0][0] > after + 1) else 0
    return {"lines": items[-limit:], "dropped": dropped, "seq": seq}
