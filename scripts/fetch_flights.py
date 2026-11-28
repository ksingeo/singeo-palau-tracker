"""Aircraft near Palau from community ADS-B networks (adsb.lol, adsb.fi).

Coverage around Palau depends on volunteer receivers, so aircraft far from a
receiver will not appear. A 24 h log keeps every flight seen near Palau."""
from __future__ import annotations

from common import (ROR_AIRPORT, age_hours, bearing_deg, haversine_km, http_json, in_eez, iso,
                    km_to_nm, load_prev, write_json)

PALAU_RADIUS_NM = 250
# Wider circles catch traffic on the Guam/Yap, Manila and Taipei/Seoul approaches.
CIRCLES = [
    ("palau", 7.4, 134.5, PALAU_RADIUS_NM),
    ("east", 10.5, 139.0, 250),
    ("northwest", 12.0, 130.0, 250),
]
PROVIDERS = [
    ("adsb.lol", "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{d}"),
    ("adsb.fi", "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{d}"),
]
LOG_HOURS = 24

CATEGORY = {"A1": "Light", "A2": "Small", "A3": "Large", "A4": "High-vortex large", "A5": "Heavy",
            "A6": "High performance", "A7": "Rotorcraft", "B1": "Glider", "B2": "Balloon",
            "B4": "Ultralight", "B6": "UAV / drone", "C1": "Emergency vehicle", "C2": "Service vehicle"}


def norm(ac, provider, region):
    lat, lon = ac.get("lat"), ac.get("lon")
    if lat is None or lon is None:
        lat, lon = ac.get("lastPosition", {}).get("lat"), ac.get("lastPosition", {}).get("lon")
    if lat is None or lon is None:
        return None
    alt = ac.get("alt_baro")
    on_ground = alt == "ground"
    d_km = haversine_km(lat, lon, *ROR_AIRPORT)
    brg_to_ror = bearing_deg(lat, lon, *ROR_AIRPORT)
    track = ac.get("track")
    inbound = False
    if track is not None and not on_ground and km_to_nm(d_km) < 300:
        diff = abs((track - brg_to_ror + 180) % 360 - 180)
        vr = ac.get("baro_rate") or ac.get("geom_rate") or 0
        inbound = diff < 20 and (vr < -300 or km_to_nm(d_km) < 120)
    db = ac.get("dbFlags") or 0
    return {
        "hex": ac.get("hex"), "callsign": (ac.get("flight") or "").strip() or None,
        "reg": ac.get("r"), "type": ac.get("t"), "desc": ac.get("desc"),
        "operator": ac.get("ownOp"), "year": ac.get("year"),
        "lat": round(lat, 4), "lon": round(lon, 4),
        "alt_ft": None if on_ground else alt, "alt_geom_ft": ac.get("alt_geom"), "on_ground": on_ground,
        "gs_kt": ac.get("gs"), "track": track, "vrate_fpm": ac.get("baro_rate") or ac.get("geom_rate"),
        "squawk": ac.get("squawk"), "emergency": ac.get("emergency") if ac.get("emergency") not in (None, "none") else None,
        "category": CATEGORY.get(ac.get("category"), ac.get("category")),
        "military": bool(db & 1), "interesting": bool(db & 2), "pia": bool(db & 4),
        "seen_s": ac.get("seen_pos", ac.get("seen")),
        "dist_ror_nm": round(km_to_nm(d_km), 1), "bearing_from_ror": round(bearing_deg(*ROR_AIRPORT, lat, lon)),
        "in_eez": in_eez(lat, lon), "inbound_ror": inbound,
        "region": region, "source": provider,
    }


def run():
    aircraft, errs, ok_calls = {}, [], 0
    for region, lat, lon, d in CIRCLES:
        for prov, tmpl in PROVIDERS:
            try:
                data = http_json(tmpl.format(lat=lat, lon=lon, d=d), timeout=25, retries=1)
                ok_calls += 1
            except Exception as e:  # noqa: BLE001
                errs.append(f"{prov}/{region}: {str(e)[:120]}")
                continue
            for ac in data.get("ac") or data.get("aircraft") or []:
                a = norm(ac, prov, region)
                if not a or not a["hex"]:
                    continue
                if a["dist_ror_nm"] <= PALAU_RADIUS_NM:
                    a["region"] = "palau"
                cur = aircraft.get(a["hex"])
                if cur is None or (a["seen_s"] or 99) < (cur["seen_s"] or 99):
                    aircraft[a["hex"]] = a
    ac_list = sorted(aircraft.values(), key=lambda a: a["dist_ror_nm"])

    # rolling 24 h log of flights seen within the Palau circle
    prev = load_prev("flights.json", {}) or {}
    log = {f["hex"]: f for f in prev.get("log", []) if age_hours(f.get("last_seen")) < LOG_HOURS}
    now = iso()
    for a in ac_list:
        if a["region"] != "palau":
            continue
        e = log.get(a["hex"]) or {"hex": a["hex"], "first_seen": now, "min_dist_nm": a["dist_ror_nm"],
                                  "max_alt_ft": 0, "positions": []}
        e.update({"callsign": a["callsign"] or e.get("callsign"), "reg": a["reg"] or e.get("reg"),
                  "type": a["type"] or e.get("type"), "desc": a["desc"] or e.get("desc"),
                  "operator": a["operator"] or e.get("operator"), "military": a["military"],
                  "last_seen": now, "min_dist_nm": min(e["min_dist_nm"], a["dist_ror_nm"]),
                  "max_alt_ft": max(e.get("max_alt_ft") or 0, a["alt_ft"] or 0),
                  "inbound_ror": a["inbound_ror"] or e.get("inbound_ror", False),
                  "landed_ror": e.get("landed_ror", False) or (a["on_ground"] and a["dist_ror_nm"] < 5)})
        e["positions"] = (e.get("positions", []) + [[a["lat"], a["lon"], a["alt_ft"] or 0, now]])[-30:]
        log[a["hex"]] = e
    log_list = sorted(log.values(), key=lambda f: f["last_seen"], reverse=True)

    write_json("flights.json", {"updated": now, "count": len(ac_list),
                                "palau_count": sum(a["region"] == "palau" for a in ac_list),
                                "aircraft": ac_list, "log": log_list, "errors": errs})
    return {"ok": ok_calls > 0, "count": len(ac_list),
            "message": f"{len(ac_list)} aircraft ({sum(a['region'] == 'palau' for a in ac_list)} near Palau), "
                       f"{len(log_list)} logged in 24 h" + (f"; {len(errs)} provider errors" if errs else ""),
            "palau_count": sum(a["region"] == "palau" for a in ac_list)}


if __name__ == "__main__":
    print(run())
