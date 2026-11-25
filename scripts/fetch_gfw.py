"""Fishing and vessel-behaviour events in Palau's EEZ from Global Fishing Watch
(API v3, free non-commercial token: https://globalfishingwatch.org/our-apis/).

GFW combines terrestrial and satellite AIS, so it sees fishing vessels far
offshore that aisstream.io misses, but its data lags real time by ~3-5 days."""
from __future__ import annotations

import json
import os
import urllib.parse
from collections import defaultdict
from datetime import timedelta

from common import age_hours, http_get, iso, load_prev, now_utc, write_json

API = "https://gateway.api.globalfishingwatch.org/v3"
REGION = {"dataset": "public-eez-areas", "id": 8315}   # Palau EEZ (Marine Regions MRGID 8315)
EVENT_DATASETS = {
    "fishing": "public-global-fishing-events:latest",
    "encounter": "public-global-encounters-events:latest",
    "loitering": "public-global-loitering-events:latest",
    "port_visit": "public-global-port-visits-events:latest",
    "gap": "public-global-gaps-events:latest",
}
EVENT_DAYS = 30
EFFORT_MONTHS = 12
REFRESH_HOURS = float(os.environ.get("GFW_REFRESH_HOURS", "6"))


def _post(path, params, body, token):
    url = f"{API}{path}?{urllib.parse.urlencode(params, doseq=True)}"
    raw = http_get(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                 "Accept": "application/json"},
                   data=json.dumps(body).encode(), method="POST", timeout=90, retries=1)
    return json.loads(raw)


def _events(kind, token, start, end):
    out, offset = [], 0
    while offset is not None and len(out) < 500:
        d = _post("/events", {"offset": offset, "limit": 100},
                  {"datasets": [EVENT_DATASETS[kind]], "startDate": start, "endDate": end, "region": REGION},
                  token)
        out += d.get("entries", [])
        offset = d.get("nextOffset")
        if not d.get("entries"):
            break
    return out


def _slim_event(e, kind):
    v = e.get("vessel") or {}
    pos = e.get("position") or {}
    ev = {"id": e.get("id"), "type": kind, "start": e.get("start"), "end": e.get("end"),
          "lat": pos.get("lat"), "lon": pos.get("lon"),
          "vessel": {"id": v.get("id"), "name": v.get("name"), "mmsi": v.get("ssvid"), "flag": v.get("flag"),
                     "type": v.get("type")},
          "dist_shore_km": (e.get("distances") or {}).get("startDistanceFromShoreKm")}
    if kind == "fishing":
        f = e.get("fishing") or {}
        ev["detail"] = {"distance_km": f.get("totalDistanceKm"), "avg_speed_kn": f.get("averageSpeedKnots"),
                        "authorization": f.get("vesselAuthorizationStatus"),
                        "potential_risk": f.get("potentialRisk")}
    elif kind == "encounter":
        en = e.get("encounter") or {}
        ov = en.get("vessel") or {}
        ev["detail"] = {"other_vessel": {"id": ov.get("id"), "name": ov.get("name"), "mmsi": ov.get("ssvid"),
                                         "flag": ov.get("flag"), "type": ov.get("type")},
                        "median_distance_km": en.get("medianDistanceKilometers"),
                        "median_speed_kn": en.get("medianSpeedKnots"),
                        "potential_risk": en.get("potentialRisk")}
    elif kind == "loitering":
        lo = e.get("loitering") or {}
        ev["detail"] = {"hours": lo.get("totalTimeHours"), "distance_km": lo.get("totalDistanceKm"),
                        "avg_speed_kn": lo.get("averageSpeedKnots")}
    elif kind == "port_visit":
        pv = e.get("port_visit") or {}
        anc = (pv.get("intermediateAnchorage") or pv.get("startAnchorage") or {})
        ev["detail"] = {"port": anc.get("name"), "duration_h": pv.get("durationHrs")}
    elif kind == "gap":
        g = e.get("gap") or {}
        ev["detail"] = {"hours": g.get("durationHours"), "distance_km": g.get("distanceKm"),
                        "intentional_disabling": g.get("intentionalDisabling"),
                        "off_lat": (g.get("offPosition") or {}).get("lat"),
                        "off_lon": (g.get("offPosition") or {}).get("lon")}
    return ev


def _effort(token, start, end, temporal, spatial_agg):
    params = {"spatial-resolution": "LOW", "temporal-resolution": temporal, "group-by": "FLAG",
              "datasets[0]": "public-global-fishing-effort:latest", "date-range": f"{start},{end}",
              "format": "JSON"}
    if spatial_agg:
        params["spatial-aggregation"] = "true"
    d = _post("/4wings/report", params, {"region": REGION}, token)
    rows = []
    for entry in d.get("entries", []):
        for _, vals in entry.items():
            rows += vals or []
    return rows


def run():
    token = os.environ.get("GFW_TOKEN", "").strip()
    prev = load_prev("gfw.json", {}) or {}
    if not token:
        write_json("gfw.json", {**prev, "configured": False})
        return {"ok": False, "configured": False, "message": "Not configured: add the GFW_TOKEN secret (free at globalfishingwatch.org)"}
    if prev.get("configured") and age_hours(prev.get("updated")) < REFRESH_HOURS and not os.environ.get("FORCE"):
        write_json("gfw.json", prev)
        return {"ok": True, "message": f"Cached (refreshes every {REFRESH_HOURS:.0f} h)",
                "count": len(prev.get("events", []))}

    today = now_utc().date()
    start = (today - timedelta(days=EVENT_DAYS)).isoformat()
    end = today.isoformat()
    events, errors, counts = [], [], {}
    for kind in EVENT_DATASETS:
        try:
            raw = _events(kind, token, start, end)
            counts[kind] = len(raw)
            events += [_slim_event(e, kind) for e in raw]
        except Exception as e:  # noqa: BLE001
            errors.append(f"{kind}: {str(e)[:160]}")

    by_flag_30d, cells, monthly = defaultdict(float), defaultdict(float), defaultdict(lambda: defaultdict(float))
    try:
        for r in _effort(token, start, end, "ENTIRE", False):
            h = r.get("hours") or 0
            by_flag_30d[r.get("flag") or "UNK"] += h
            if r.get("lat") is not None:
                cells[(round(r["lat"], 1), round(r["lon"], 1))] += h
    except Exception as e:  # noqa: BLE001
        errors.append(f"effort-30d: {str(e)[:160]}")
    try:
        m_start = (today.replace(day=1) - timedelta(days=EFFORT_MONTHS * 31)).replace(day=1).isoformat()
        for r in _effort(token, m_start, end, "MONTHLY", True):
            monthly[r.get("date")][r.get("flag") or "UNK"] += r.get("hours") or 0
    except Exception as e:  # noqa: BLE001
        errors.append(f"effort-monthly: {str(e)[:160]}")

    events.sort(key=lambda e: e.get("start") or "", reverse=True)
    out = {
        "updated": iso(), "configured": True, "window": {"start": start, "end": end},
        "counts": counts, "events": events,
        "effort_by_flag_30d": dict(sorted(((k, round(v, 1)) for k, v in by_flag_30d.items()),
                                          key=lambda kv: -kv[1])),
        "effort_cells_30d": [[lat, lon, round(h, 1)] for (lat, lon), h in cells.items() if h > 0],
        "effort_monthly": {m: {k: round(v, 1) for k, v in f.items()} for m, f in sorted(monthly.items()) if m},
        "errors": errors,
    }
    if not events and errors and prev.get("events"):
        out = {**prev, "errors": errors, "stale": True}
    write_json("gfw.json", out)
    return {"ok": len(errors) < len(EVENT_DATASETS) + 2, "count": len(events),
            "message": f"{len(events)} events in last {EVENT_DAYS} days"
                       + (f"; {len(errors)} errors: {errors[0]}" if errors else ""),
            "counts": counts}


if __name__ == "__main__":
    print(run())
