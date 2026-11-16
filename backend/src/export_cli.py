# -*- coding: utf-8 -*-
"""运动数据导出 CLI：登录 → 列出全部记录 → Enter → 拉全量详情+OBS → {uid}.json。

给同学贡献数据用：把生成的 JSON 发回即可。打包：
    pyinstaller --onefile --name swdata-export src/export_cli.py
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sportsworld.services.auth import login, stable_identity          # noqa: E402
from sportsworld.services.records import fetch_records, fetch_one_record  # noqa: E402
from sportsworld.services.myinfo import fetch_record_detail          # noqa: E402


def fmt_date(ms: int) -> str:
    try:
        return time.strftime("%m-%d %H:%M", time.localtime(ms / 1000))
    except Exception:
        return "--"


def status_label(r: dict) -> str:
    s = r.get("status")
    if isinstance(s, int):
        return "正常" if s == 0 else "异常"
    return "--"


def main() -> int:
    print("=" * 44)
    print("  运动世界校园 · 跑步数据导出工具")
    print("=" * 44)
    user = input("账号: ").strip()
    pwd = input("密码: ").strip()
    if not user or not pwd:
        print("账号/密码不能为空")
        return 1

    print("\n[1/3] 登录中（可能需要滑块验证，请稍候）…")
    try:
        sess = login(user, pwd, identity=stable_identity(user, None))
    except Exception as e:
        print(f"登录失败: {e}")
        return 1
    print(f"      已登录 uid={sess.uid} name={sess.name or '-'}")
    try:
        return run_export(sess)
    finally:
        try:
            sess.logout()
            print("已登出")
        except Exception:
            pass


def run_export(sess) -> int:
    print("\n[2/3] 拉取记录列表…")
    try:
        rows = fetch_records(sess)
    except Exception as e:
        print(f"记录列表获取失败: {e}")
        return 1
    print(f"      共 {len(rows)} 条：")
    print(f"      {'#':>3}  {'日期':<12}{'里程':>8}{'用时':>7}  状态")
    for i, r in enumerate(rows, 1):
        print(f"      {i:>3}  {fmt_date(r.get('startTime', 0)):<12}"
              f"{(r.get('totalDis', 0) or 0) / 1000:>6.2f}km"
              f"{int((r.get('totalTime', 0) or 0)) // 60:>5}分  "
              f"{status_label(r)}")

    input("\n按 Enter 开始导出全部数据（详情 + 轨迹，需几分钟）…")

    print("\n[3/3] 逐条抓取详情与轨迹对象…")
    out_rows = []
    ok_obs = 0
    for i, r in enumerate(rows, 1):
        rrid = r.get("rrid")
        entry = {"row": r, "detail": {}, "obs": {}}
        try:
            d = fetch_record_detail(sess, int(rrid),
                                    uuid=r.get("uuid") or "",
                                    start_ms=int(r.get("startTime") or 0))
            entry["detail"] = d.get("detail") or {}
            entry["obs"] = d.get("obs") or {}
            if entry["obs"]:
                ok_obs += 1
            else:
                entry["obs_error"] = d.get("obs_error", "")
        except Exception as e:
            entry["error"] = str(e)
        out_rows.append(entry)
        has_obs = "obs" if entry["obs"] else "no-obs"
        print(f"      [{i:>3}/{len(rows)}] rrid={rrid} {has_obs}")

    payload = {
        "uid": sess.uid,
        "unid": getattr(sess, "unid", ""),
        "name": getattr(sess, "name", ""),
        "exported_at": int(time.time() * 1000),
        "record_count": len(out_rows),
        "obs_count": ok_obs,
        "records": out_rows,
    }
    path = Path.cwd() / f"{sess.uid}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False),
                    encoding="utf-8")
    print(f"\n完成：{path}（{len(out_rows)} 条记录，{ok_obs} 条含轨迹）")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except KeyboardInterrupt:
        print("\n已取消")
        code = 1
    input("\n按 Enter 退出…")
    sys.exit(code)
