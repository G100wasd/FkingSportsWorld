"""GeeGuard/DeepKnow 链：提交体 geeToken/errorCode + deviceVerify 事件上报。

反编译确认的行为模型：
- 取回执：DeepKnowUtils.emitSenseData(callback) -> GeeGuard.submitReceipt
  -> (token, code) 映射：200->(respondedGeeToken,200)；-200->("",-100)；
  -300/-500/-501->(geeToken,code)；其他->("",-999)。
- 上传：RunSportUploadManger.getEmitSenseData() 把 (token,code) 填进
  save/record 提交体的 geeToken/errorCode（两字段都在签名域内）。
- 事件上报：getKeepReceipt -> POST partner.iydsj.com deviceVerify，
  body={geeToken,interactive,errorCode[,rrid][,uuid]}，信封栈同普通 API
  （commonServer @Url 全量覆盖，同一签名拦截器）。interactive：
  1=登录 2=用户信息 5=取点(due-run 三模式) 6=过点 7=跑完 9/10=锻炼跑。
  sportType=1 户外跑上传后不发 verify（UPLOAD_SPORT_RECORD=8 是死代码），
  上传时刻的 SDK 结果由提交体字段承载。

Windows 端没有 libgtcore.so，无法自产 token——默认 ("", -999) 建模
真实客户端"SDK 失败"路径。deviceVerify 的意义是把账号画像从"从不
调用该接口"修正为"调用了但 SDK 失败"。defaultsConfig 的
gee.token_endpoint 可接外部 token 服务（局域网 Android 端点，
返回 {"geeToken","errorCode"}），配了即被采信并重签提交体。
"""

import httpx

from ..config import CFG
from ..integration.client import envelope_request
from ..integration.envelope import compact

# deviceVerify 在 partner 域（反编译 CommonServer @Url 原文），与 campus
# 的 run.gxapp.iydsj.com 不同 host——不要拼 HOST
VERIFY_URL = ("https://partner.iydsj.com"
              "/api/v620/datacollection/geetest/deviceVerify")

INTERACTIVE_LOGIN = 1          # LoginViewModel/BindPhoneViewModel
INTERACTIVE_USER_INFO = 2      # SplashActivity.requestUserInfo
INTERACTIVE_GET_POINT = 5      # 取点成功（Sequence/Random/End 三模式）
INTERACTIVE_EXERCISE_RUN = 9   # 锻炼跑
INTERACTIVE_UPLOAD_EXERCISE = 10  # sportType=5 上传后


def fetch_receipt() -> tuple:
    """取 (geeToken, errorCode)：对应原生 submitReceipt 回调的码映射。

    未配 token 端点 -> ("", -999)：真实客户端 SDK 失败的诚实组合。
    """
    import os
    ep = (os.environ.get("SPORTSWORLD_GEE_ENDPOINT") or
          ((CFG.get("gee") or {}).get("token_endpoint") or "")).strip()
    if not ep:
        return "", -999
    try:
        with httpx.Client(timeout=4.0) as client:
            data = client.get(ep).json()
        token = str(data.get("geeToken") or data.get("token") or "")
        raw_code = data.get("errorCode", data.get("code", -999))
        return token, int(raw_code)
    except Exception as e:
        print(f"[deepest] token 端点不可达（{e}），回退 -999")
        return "", -999


def device_verify(sess, interactive: int, rrid=None, uuid=None) -> bool:
    """上报一次 deviceVerify 事件，返回服务端是否受理。

    原生语义：每个事件先独立取一次回执（token 每次现采），再上报。
    绝不抛异常——原生 FlowKt.launchIn 是 fire-and-forget。
    """
    token, code = fetch_receipt()
    body = {"geeToken": token, "interactive": interactive, "errorCode": code}
    if rrid is not None and int(rrid) != -1:
        body["rrid"] = int(rrid)
    if uuid:
        body["uuid"] = uuid
    try:
        with httpx.Client(timeout=15.0, http2=True) as client:
            out = envelope_request(
                client, sess.envelope, sess.identity, "POST",
                VERIFY_URL, compact(body),
                uid=sess.uid, token=sess.token)
        err = (out.get("business") or {}).get("error")
        print(f"[deepest] deviceVerify interactive={interactive} -> "
              f"error={err}")
        return err == 10000
    except Exception as e:
        print(f"[deepest] deviceVerify interactive={interactive} 失败"
              f"（不阻塞主流程）: {e}")
        return False
