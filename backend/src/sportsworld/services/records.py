"""跑步记录回读：提交后验证用。

单条：POST /api/v70260/runnings/get_one_record。
列表：POST /api/v70230/runnings/records。
"""

import httpx

from ..integration.client import check_business, envelope_request
from ..integration.envelope import compact
from .auth import HOST
from .obs import parse_data_field

RECORDS_PATH = "/api/v70230/runnings/records"
GET_ONE_PATH = "/api/v70260/runnings/get_one_record"


def fetch_records(sess, host: str = HOST) -> list:
    """记录列表：返回原始行（不裁剪字段——statusInfo/reasonList 等
    状态字段按学校实际返回，前端据此区分存活/异常记录）。"""
    with httpx.Client(timeout=30.0) as client:
        out = envelope_request(client, sess.envelope, sess.identity,
                               "POST", host + RECORDS_PATH, "{}",
                               uid=sess.uid, token=sess.token)
    biz = check_business(out["business"])
    inner = parse_data_field(biz)
    if isinstance(inner, list):
        return inner
    if isinstance(inner, dict):
        for k in ("list", "records", "data"):
            v = inner.get(k)
            if isinstance(v, list):
                return v
    return []


def fetch_one_record(sess, rrid: int, host: str = HOST) -> dict:
    """单条详情：返回内层 data 对象（双层 data 解包，与 Rust 一致）。"""
    body = compact({"rrid": rrid, "uuid": None, "calculateBadge": False})
    with httpx.Client(timeout=30.0) as client:
        out = envelope_request(client, sess.envelope, sess.identity,
                               "POST", host + GET_ONE_PATH, body,
                               uid=sess.uid, token=sess.token)
    biz = check_business(out["business"])
    inner = parse_data_field(biz)
    if isinstance(inner, dict) and inner.get("data") is not None:
        inner = parse_data_field(inner)
    return inner if isinstance(inner, dict) else {}
