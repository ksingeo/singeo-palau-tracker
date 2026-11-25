"""King tides and sea level at Malakal Harbor.

- King-tide calendar: NOAA tide predictions (station 1841367) for the past and
  next year. A high tide in the top 2% of the two-year window is a "king tide",
  top 5% a "very high tide".
- Observed vs. predicted: University of Hawaii Sea Level Center fast-delivery
  hourly data for Malakal (UHSLC 007). This runs ~1-2 months behind; the
  residual shows how far the sea sat above or below the astronomical tide
  (El Nino / La Nina, storms, seasonal swings)."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone

from common import age_hours, http_get, iso, load_prev, now_utc, write_json

STATION = "1841367"
UHSLC_ID = 7
REFRESH_HOURS = 12
NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def noaa(begin, end, interval):
    url = (f"{NOAA}?station={STATION}&product=predictions&datum=MLLW&units=metric&time_zone=gmt&format=json"
           f"&interval={interval}&begin_date={begin:%Y%m%d}&end_date={end:%Y%m%d}")
    d = json.loads(http_get(url, timeout=60))
    if "error" in d:
        raise RuntimeError(d["error"].get("message"))
    return [(datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc), float(p["v"]), p.get("type"))
            for p in d.get("predictions", [])]


def percentile(vals, q):
    s = sorted(vals)
    if not s:
        return None
    k = (len(s) - 1) * q
    f = int(k)
    return s[f] + (s[min(f + 1, len(s) - 1)] - s[f]) * (k - f)


def king_tides():
    today = now_utc().date()
    past = noaa(today - timedelta(days=365), today, "hilo")
    future = noaa(today + timedelta(days=1), today + timedelta(days=365), "hilo")
    highs = [v for _, v, t in past + future if t == "H"]
    p95, p98 = percentile(highs, 0.95), percentile(highs, 0.98)
    lows = [v for _, v, t in past + future if t == "L"]
    l02 = percentile(lows, 0.02)
    upcoming = []
    for t, v, typ in future:
        if typ == "H" and v >= p95 and (t - now_utc()).days <= 180:
            upcoming.append({"time": iso(t), "height_m": round(v, 3), "level": "king" if v >= p98 else "very_high"})
        if typ == "L" and v <= l02 and (t - now_utc()).days <= 180:
            upcoming.append({"time": iso(t), "height_m": round(v, 3), "level": "very_low"})
    year_max = max(((t, v) for t, v, typ in future if typ == "H"), key=lambda x: x[1])
    return {"p95_m": round(p95, 3), "p98_m": round(p98, 3), "low_p02_m": round(l02, 3),
            "mean_high_m": round(sum(highs) / len(highs), 3),
            "year_max": {"time": iso(year_max[0]), "height_m": round(year_max[1], 3)},
            "upcoming": upcoming}


def observed_residual(days=60):
    start = (now_utc() - timedelta(days=150)).strftime("%Y-%m-%dT00:00:00Z")
    url = ("https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.csv?time,sea_level"
           f"&uhslc_id={UHSLC_ID}&time%3E={start}")
    rows = list(csv.reader(io.StringIO(http_get(url, timeout=60).decode())))[2:]
    obs = {}
    for t, v in rows:
        try:
            val = float(v)
        except ValueError:
            continue
        if val != val or val < -30000:      # NaN / fill value
            continue
        obs[datetime.strptime(t, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)] = val / 1000
    if not obs:
        return None
    last = max(obs)
    first = last - timedelta(days=days)
    obs = {t: v for t, v in obs.items() if t >= first}
    pred = {t: v for t, v, _ in noaa(first.date(), last.date() + timedelta(days=1), "h")}
    common_t = sorted(set(obs) & set(pred))
    if len(common_t) < 48:
        return None
    mo = sum(obs[t] for t in common_t) / len(common_t)
    mp = sum(pred[t] for t in common_t) / len(common_t)
    daily = {}
    for t in common_t:
        daily.setdefault(t.date().isoformat(), []).append((obs[t] - mo) - (pred[t] - mp))
    series = [[d, round(sum(v) / len(v) * 100, 1)] for d, v in sorted(daily.items()) if len(v) >= 12]
    # monthly mean level vs the 150-day mean is a rough "how high is the sea" indicator
    return {"last_obs": iso(last), "window_days": days, "daily_residual_cm": series,
            "max_hourly_obs_m_above_mean": round(max(obs[t] - mo for t in common_t), 3),
            "note": "Residual = observed minus predicted tide, both relative to their own mean over the window."}


def run():
    prev = load_prev("sealevel.json", {}) or {}
    if prev.get("updated") and age_hours(prev["updated"]) < REFRESH_HOURS and prev.get("king_tides"):
        write_json("sealevel.json", prev)
        return {"ok": True, "message": "Cached (refreshes twice a day)", "count": len(prev["king_tides"]["upcoming"])}
    out, errors = {"updated": iso(), "station": "Malakal Harbor (NOAA 1841367 / UHSLC 007)"}, []
    try:
        out["king_tides"] = king_tides()
    except Exception as e:  # noqa: BLE001
        errors.append(f"tide predictions: {str(e)[:140]}")
        out["king_tides"] = prev.get("king_tides")
    try:
        out["observed"] = observed_residual()
    except Exception as e:  # noqa: BLE001
        errors.append(f"UHSLC observations: {str(e)[:140]}")
        out["observed"] = prev.get("observed")
    out["errors"] = errors
    write_json("sealevel.json", out)
    kt = out.get("king_tides") or {}
    nxt = next((u for u in kt.get("upcoming", []) if u["level"] == "king"), None)
    return {"ok": bool(kt), "count": len(kt.get("upcoming", [])),
            "message": (f"next king tide {nxt['time'][:10]} ({nxt['height_m']:.2f} m)" if nxt else "no king tides in 180 days")
                       + (f"; observations to {out['observed']['last_obs'][:10]}" if out.get("observed") else "")
                       + (f"; errors: {errors[0]}" if errors else "")}


if __name__ == "__main__":
    print(run())
