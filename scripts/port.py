"""Port of Malakal (Koror) activity derived from AIS:
- ships in port now (within PORT_RADIUS_NM of Malakal Harbor)
- expected arrivals: ships elsewhere whose AIS destination is Palau
- a 45-day log of port calls with arrival, departure and time in port

Only AIS class-A vessels count (commercial ships must carry class A), so
small local tour boats don't flood the log."""
from __future__ import annotations

import re

from common import age_hours, haversine_km, iso, km_to_nm, load_prev, parse_iso, write_json

MALAKAL = (7.330, 134.452)
PORT_RADIUS_NM = 4.0
LOG_DAYS = 45
DEST = re.compile(r"PALAU|KOROR|MALAKAL|PW\s?ROR|PWKOR|PW\s?MKL|BELAU|P\.?W\.?\s*KOROR", re.I)


def in_port(s):
    return s.get("lat") is not None and km_to_nm(haversine_km(s["lat"], s["lon"], *MALAKAL)) <= PORT_RADIUS_NM


def summary(s):
    return {k: s.get(k) for k in ("mmsi", "name", "imo", "callsign", "category", "type_label", "flag",
                                  "length_m", "destination", "eta", "draught_m")}


def update(ships):
    prev = load_prev("port.json", {}) or {}
    calls = [c for c in prev.get("calls", []) if age_hours(c.get("last_seen")) < LOG_DAYS * 24]
    open_calls = {c["mmsi"]: c for c in calls if not c.get("departed")}
    now = iso()
    commercial = [s for s in ships if s.get("class") == "A" and s.get("category") != "Pleasure & sailing"]
    here = [s for s in commercial if s["age_h"] < 1 and in_port(s)]
    here_ids = {s["mmsi"] for s in here}
    for s in here:
        c = open_calls.get(s["mmsi"])
        if c is None:
            c = {**summary(s), "arrived": s.get("first_seen") if in_port_since_first(s) else s["last_pos"],
                 "last_seen": s["last_pos"], "departed": None}
            calls.append(c)
            open_calls[s["mmsi"]] = c
        c.update({**{k: v for k, v in summary(s).items() if v}, "last_seen": s["last_pos"],
                  "nav_status": s.get("nav_status_label"), "sog": s.get("sog")})
    by_id = {s["mmsi"]: s for s in commercial}
    for mmsi, c in list(open_calls.items()):
        if mmsi in here_ids:
            continue
        s = by_id.get(mmsi)
        seen_outside = s is not None and s["age_h"] < 1 and not in_port(s)
        if seen_outside or age_hours(c["last_seen"]) > 12:
            c["departed"] = c["last_seen"]
            c["next_destination"] = (s or {}).get("destination")
    for c in calls:
        a, d = parse_iso(c.get("arrived")), parse_iso(c.get("departed") or c.get("last_seen"))
        c["hours_in_port"] = round((d - a).total_seconds() / 3600, 1) if a and d else None
    expected = []
    for s in commercial:
        if s["mmsi"] in here_ids or s["age_h"] > 12 or not DEST.search(s.get("destination") or ""):
            continue
        d_nm = km_to_nm(haversine_km(s["lat"], s["lon"], *MALAKAL))
        est = round(d_nm / s["sog"], 1) if (s.get("sog") or 0) > 3 else None
        expected.append({**summary(s), "dist_nm": round(d_nm), "sog": s.get("sog"), "hours_away_est": est,
                         "last_pos": s.get("last_pos"), "lat": s["lat"], "lon": s["lon"]})
    expected.sort(key=lambda e: e["dist_nm"])
    calls.sort(key=lambda c: c.get("arrived") or "", reverse=True)
    out = {"updated": now, "port": "Malakal Harbor, Koror", "radius_nm": PORT_RADIUS_NM,
           "in_port": [c for c in calls if not c.get("departed")], "expected": expected, "calls": calls}
    write_json("port.json", out)
    return out


def in_port_since_first(s):
    t = s.get("trail") or []
    return bool(t) and km_to_nm(haversine_km(t[0][0], t[0][1], *MALAKAL)) <= PORT_RADIUS_NM
