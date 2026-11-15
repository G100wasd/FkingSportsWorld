"""账号运动数据：学期进度汇总 + 个人学期信息（纯读接口）。

汇总：POST /api/v55/runnings/recordssummary/semester {}
个人：POST /api/v41/running/getPersonalSemesterInfo {"runMode":1}
  （学期截止/计分方式/有效次数；结构按学校返回，原样透传）

两段各自软失败：单段挂掉不拖垮整页。
"""

import httpx

from ..integration.client import check_business, envelope_request
from ..integration.envelope import compact
from .auth import HOST
from .obs import parse_data_field

SUMMARY_PATH = "/api/v55/runnings/recordssummary/semester"
PERSONAL_PATH = "/api/v41/running/getPersonalSemesterInfo"
COMPLETED_PATH = "/api/v44/runnings/personalSemesterCompleted"


def _post(sess, host: str, path: str, body: dict) -> dict:
    with httpx.Client(timeout=30.0) as client:
        out = envelope_request(client, sess.envelope, sess.identity,
                               "POST", host + path, compact(body),
                               uid=sess.uid, token=sess.token)
    biz = check_business(out["business"])
    inner = parse_data_field(biz)
    return inner if isinstance(inner, (dict, list)) else {}


def fetch_semester(sess, host: str = HOST, latest_rrid: int = 0) -> dict:
    """{summary, personal, completed}：summary 常见字段
    sname/semesterDis/semesterValidDis/semesterCount/semesterValidCount；
    completed（需最近一条 rrid）带 semesterGoalCount 目标数等字段。"""
    out = {"summary": {}, "personal": {}, "completed": {}}
    try:
        out["summary"] = _post(sess, host, SUMMARY_PATH, {})
    except Exception as e:
        out["summary_error"] = str(e)
    try:
        out["personal"] = _post(sess, host, PERSONAL_PATH, {"runMode": 1})
    except Exception as e:
        out["personal_error"] = str(e)
    if latest_rrid:
        try:
            out["completed"] = _post(sess, host, COMPLETED_PATH,
                                     {"rrid": latest_rrid})
        except Exception as e:
            out["completed_error"] = str(e)
    return out
