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


def _records_page(sess, client: httpx.Client, host: str,
                  page: int, size: int) -> list:
    out = envelope_request(client, sess.envelope, sess.identity,
                           "POST", host + RECORDS_PATH,
                           compact({"pageNum": page, "pageSize": size}),
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


def fetch_records(sess, host: str = HOST) -> list:
    """记录列表（自动翻页取全量）：接口按 pageNum/pageSize 分页、默认 10 条——
    实测 pageNum=2 可翻出更早记录。返回原始行不裁剪字段。"""
    size, page, rows = 50, 1, []
    with httpx.Client(timeout=30.0, http2=True) as client:
        while page <= 20:                       # 上限 20 页防死循环
            part = _records_page(sess, client, host, page, size)
            rows.extend(part)
            if len(part) < size:
                break
            page += 1
    return rows


def fetch_one_record(sess, rrid: int, host: str = HOST) -> dict:
    """单条详情：返回内层 data 对象（双层 data 解包，与 Rust 一致）。"""
    body = compact({"rrid": rrid, "uuid": None, "calculateBadge": False})
    with httpx.Client(timeout=30.0, http2=True) as client:
        out = envelope_request(client, sess.envelope, sess.identity,
                               "POST", host + GET_ONE_PATH, body,
                               uid=sess.uid, token=sess.token)
    biz = check_business(out["business"])
    inner = parse_data_field(biz)
    if isinstance(inner, dict) and inner.get("data") is not None:
        inner = parse_data_field(inner)
    return inner if isinstance(inner, dict) else {}
