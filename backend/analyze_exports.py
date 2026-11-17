"""同学数据包 -> 跑步纹理特征提取 -> profiles.json
用法: python analyze_exports.py <json包> [更多包...]
特征(每条 status:0 且本学期且有 OBS 的记录):
  pace_s_km      平均配速 s/km
  spm_mean/sd    step_freq_json 每10s步数换算步频的均值/标准差
  spm_slope      步频随里程进度的线性漂移 (spm/全程)
  pace_slope     配速随里程进度的漂移 (相对变化/全程, 负=末段掉速)
  jitter_sd      相邻10s窗口速度差的σ (微观速度抖动强度)
  gps_sd         轨迹点对邻点连线的垂直偏差σ 中位数 (GPS噪声, 米)
  pause_frac     距离≈0的10s窗口占比 (停顿模式)
"""
import json, math, sys, statistics as st
from pathlib import Path

SEMESTER_MS = 1788192000000   # 2026-09-01 00:00 (UTC+8)

def _lin_slope(xs, ys):
    n = len(xs)
    if n < 3: return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    den = sum((x-mx)**2 for x in xs)
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys))/den if den else 0.0

def _hav(a, b):
    R=6371000; p1,p2=math.radians(a[0]),math.radians(b[0])
    dp,dl=p2-p1,math.radians(b[1]-a[1])
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def run_features(row, obs):
    sp = obs.get("speed_json") or []
    sf = obs.get("step_freq_json") or []
    pts = obs.get("points") or []
    if not sp or not sf or not row.get("totalDis"):
        return None
    # 10s窗速度 m/s
    spd = [w.get("distance",0)/max(1,(w.get("endTime",0)-w.get("beginTime",0))/1000)
           for w in sp]
    spd = [s for s in spd if 0 < s < 8]
    spm = [w.get("stepsNum",0)*6 for w in sf]          # 10s步数->每分钟
    spm = [s for s in spm if 30 < s < 260]
    if len(spd) < 10 or len(spm) < 10: return None
    xs = [i/(len(spd)-1) for i in range(len(spd))]      # 进度 0..1
    mean_s = sum(spd)/len(spd)
    dlt = [spd[i+1]-spd[i] for i in range(len(spd)-1)]
    # GPS噪声: 中点对两端连线偏差
    geo = [(p.get("gLat"), p.get("gLng")) for p in pts if p.get("gLat") and p.get("gLng")]
    dev = []
    for i in range(1, len(geo)-1):
        a, m, b = geo[i-1], geo[i], geo[i+1]
        mid = ((a[0]+b[0])/2, (a[1]+b[1])/2)
        dev.append(_hav(m, mid))
    gps_sd = st.median(dev) if dev else 0.0
    pauses = sum(1 for w in sp if w.get("distance",0) < 1.5)
    return {
        "dist": row["totalDis"], "dur": row["totalTime"],
        "pace_s_km": row["totalTime"]/(row["totalDis"]/1000),
        "spm_mean": sum(spm)/len(spm), "spm_sd": st.pstdev(spm),
        "spm_slope": _lin_slope(xs[:len(spm)], spm),
        "pace_slope": _lin_slope(xs, [s/mean_s for s in spd]),
        "jitter_sd": st.pstdev(dlt) if len(dlt)>2 else 0.0,
        "gps_sd": gps_sd, "pause_frac": pauses/len(sp),
    }

all_runs = []
for f in sys.argv[1:]:
    d = json.load(open(f, encoding="utf-8"))
    n_all = n_sem = n_ok = 0
    for r in d.get("records", []):
        row, obs = r.get("row") or {}, r.get("obs")
        n_all += 1
        if (row.get("startTime") or 0) < SEMESTER_MS: continue
        n_sem += 1
        if row.get("status") != 0 or not obs: continue
        feat = run_features(row, obs)
        if feat:
            feat.update(uid=d["uid"], name=d.get("name",""))
            all_runs.append(feat); n_ok += 1
    print(f"{d['uid']}({d.get('name','')}): 全部{n_all} -> 本学期{n_sem} -> 有效{n_ok}")

KEYS = ["pace_s_km","spm_mean","spm_sd","spm_slope","pace_slope","jitter_sd","gps_sd","pause_frac"]
by_uid = {}
for r in all_runs: by_uid.setdefault(r["uid"], []).append(r)
print("\n== 每人均值 ==")
print("uid        n  pace    spm±sd   spm斜率  配速斜率 jitter  gps_m  停顿%")
for uid, rs in by_uid.items():
    m = {k: sum(r[k] for r in rs)/len(rs) for k in KEYS}
    print(f"{uid}  {len(rs):2d}  {m['pace_s_km']:5.0f}s  {m['spm_mean']:3.0f}±{m['spm_sd']:4.1f}  {m['spm_slope']:+5.1f}   {m['pace_slope']:+.3f}   {m['jitter_sd']:.3f}   {m['gps_sd']:4.1f}  {m['pause_frac']*100:4.1f}")
print("\n== 人群分布(均值±标准差) ==")
for k in KEYS:
    v = [r[k] for r in all_runs]
    print(f"{k:12s} {st.mean(v):8.3f} ± {st.pstdev(v):6.3f}   [{min(v):.3f}, {max(v):.3f}]")
out = {"semester_ms": SEMESTER_MS, "n_users": len(by_uid),
       "n_runs": len(all_runs), "runs": all_runs,
       "pop": {k: {"mean": st.mean([r[k] for r in all_runs]),
                   "sd": st.pstdev([r[k] for r in all_runs])} for k in KEYS}}
Path("profiles.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("\n-> profiles.json  (n_users=%d, n_runs=%d)" % (len(by_uid), len(all_runs)))

