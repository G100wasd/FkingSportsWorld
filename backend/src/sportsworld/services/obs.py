"""OBS 上传：POST /api/obs/temporary/url 换签名 URL → PUT JSON。"""

import base64
import gzip
import json

import httpx

from ..integration.client import check_business, envelope_request, get_field
from ..integration.envelope import compact
from .auth import HOST

OBS_SIGN_PATH = "/api/obs/temporary/url"
BUCKET = "iydsj-hbase-hot"


def parse_data_field(biz: dict):
    """business.data 可能是 JSON 字符串或对象——统一归一为 dict/list。"""
    d = biz.get("data")
    if isinstance(d, str):
        try:
            return json.loads(d)
        except ValueError:
            return {}
    return d if isinstance(d, (dict, list)) else {}


def sign_url(sess, key: str, client: httpx.Client,
             method: str = "Put", host: str = HOST) -> str:
    body = compact({"bucketName": BUCKET, "objectKey": key,
                    "method": method, "contentType": "application/json"})
    out = envelope_request(client, sess.envelope, sess.identity,
                           "POST", host + OBS_SIGN_PATH, body,
                           uid=sess.uid, token=sess.token)
    biz = check_business(out["business"])
    data = parse_data_field(biz)
    url = (data.get("signedUrl") if isinstance(data, dict) else None) \
        or get_field(biz, "signedUrl")
    if not url:
        raise RuntimeError(f"OBS 签名响应缺 signedUrl: {str(biz)[:160]}")
    return url


def upload_both_keys(sess, keys, payload: bytes, host: str = HOST) -> int:
    """逐 key 签名并 PUT，返回成功数（0..len(keys)）；单 key 失败不中断。"""
    ok = 0
    with httpx.Client(timeout=30.0, http2=True) as client:
        for key in keys:
            try:
                url = sign_url(sess, key, client, host=host)
                r = client.put(url, content=payload,
                               headers={"Content-Type": "application/json"})
                if r.status_code >= 400:
                    raise RuntimeError(f"HTTP {r.status_code}")
                ok += 1
                print(f"[obs] PUT {key} -> {r.status_code}")
            except Exception as e:
                print(f"[obs] PUT {key} 失败: {e}")
    return ok


def fetch_object(sess, key: str, host: str = HOST) -> dict:
    """签名 GET 回读 OBS 对象（10 键、值均为 gzip+base64）。"""
    with httpx.Client(timeout=30.0, http2=True) as client:
        url = sign_url(sess, key, client, method="Get", host=host)
        r = client.get(url)
        r.raise_for_status()
        print(f"[obs] GET {key} 回读 {len(r.content)} 字节")
        return r.json()


def ungz(value: str):
    """OBS 字段值解码：base64 → gunzip → JSON（非 JSON 时返回原文）。"""
    text = gzip.decompress(base64.b64decode(value)).decode("utf-8", "replace")
    try:
        return json.loads(text)
    except ValueError:
        return text
