"""Ships in and around Palau's EEZ from aisstream.io (free API key).

Listens to the aisstream.io WebSocket for AIS_LISTEN_SECONDS, then merges the
result with ships seen in the previous runs (kept for SHIP_MEMORY_HOURS) so the
map shows a fuller picture than one short listening window would.

aisstream.io is fed by terrestrial receivers. Ships far offshore, beyond any
receiver's reach, only appear on satellite AIS (paid) or, for fishing vessels,
in Global Fishing Watch data (see fetch_gfw.py)."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time

from ais_reference import NAV_STATUS, flag_from_mmsi, mmsi_kind, ship_type
from common import (KOROR, age_hours, eez_bbox, haversine_km, in_eez, in_territorial_sea, iso,
                    km_to_nm, load_prev, now_utc, write_json)

WS_URL = "wss://stream.aisstream.io/v0/stream"
SHIP_MEMORY_HOURS = float(os.environ.get("SHIP_MEMORY_HOURS", "24"))
TRAIL_POINTS = 40
# fields that describe the latest position report: always overwrite, even with None
POSITION_KEYS = {"lat", "lon", "sog", "cog", "heading", "nav_status", "last_pos"}

# Names of known state research / survey ships worth flagging (edit freely).
WATCH_NAME = re.compile(os.environ.get(
    "SHIP_WATCH_REGEX",
    r"XIANG ?YANG ?HONG|SHI ?YAN|TAN ?SUO|KE ?XUE|DA ?YANG|HAI ?YANG|SHEN ?HAI|YUAN ?WANG|"
    r"ZHONG ?SHAN ?DA ?XUE|DONG ?FANG ?HONG|SHI ?JIAN|HAI ?JING|HAIXUN|HAI ?XUN|KEXUE"), re.I)


def _f(v, none_vals=()):
    if v is None or v in none_vals:
        return None
    return v


async def _listen(key, seconds, bbox):
    import websockets  # pip install websockets

    lat1, lon1, lat2, lon2 = bbox
    sub = {"APIKey": key, "BoundingBoxes": [[[lat1, lon1], [lat2, lon2]]],
           "FilterMessageTypes": ["PositionReport", "StandardClassBPositionReport",
                                  "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"]}
    ships, msgs = {}, 0
    deadline = time.monotonic() + seconds
    async with websockets.connect(WS_URL, open_timeout=30, ping_interval=20, max_size=2 ** 22) as ws:
        await ws.send(json.dumps(sub))
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            m = json.loads(raw)
            if "error" in m:
                raise RuntimeError(f"aisstream: {m['error']}")
            msgs += 1
            handle_message(ships, m)
    return ships, msgs


def handle_message(ships, m):
    """Merge one aisstream.io message into the ships dict (keyed by MMSI)."""
    mt, meta = m.get("MessageType"), m.get("MetaData", {})
    body = m.get("Message", {}).get(mt, {})
    mmsi = meta.get("MMSI") or body.get("UserID")
    if not mmsi:
        return
    s = ships.setdefault(str(mmsi), {"mmsi": str(mmsi)})
    if meta.get("ShipName", "").strip():
        s.setdefault("name", meta["ShipName"].strip())
    if mt in ("PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"):
        lat, lon = body.get("Latitude", meta.get("latitude")), body.get("Longitude", meta.get("longitude"))
        if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
            return
        s.update({"lat": round(lat, 5), "lon": round(lon, 5),
                  "sog": _f(body.get("Sog"), (102.3,)), "cog": _f(body.get("Cog"), (360, 360.0)),
                  "heading": _f(body.get("TrueHeading"), (511,)),
                  "class": "A" if mt == "PositionReport" else "B",
                  "last_pos": iso()})
        if mt == "PositionReport":
            s["nav_status"] = body.get("NavigationalStatus")
        if mt == "ExtendedClassBPositionReport":
            if body.get("Name", "").strip():
                s["name"] = body["Name"].strip()
            if body.get("Type"):
                s["type_code"] = body["Type"]
    elif mt == "ShipStaticData":
        d = body.get("Dimension") or {}
        s.update({k: v for k, v in {
            "name": (body.get("Name") or "").strip() or None,
            "callsign": (body.get("CallSign") or "").strip() or None,
            "imo": body.get("ImoNumber") or None,
            "type_code": body.get("Type") or None,
            "destination": (body.get("Destination") or "").strip(" @") or None,
            "draught_m": body.get("MaximumStaticDraught") or None,
            "length_m": (d.get("A", 0) + d.get("B", 0)) or None,
            "beam_m": (d.get("C", 0) + d.get("D", 0)) or None,
            "eta": _eta(body.get("Eta")),
        }.items() if v})
        s["last_static"] = iso()
    elif mt == "StaticDataReport":
        a, b = body.get("ReportA") or {}, body.get("ReportB") or {}
        if a.get("Valid") and (a.get("Name") or "").strip():
            s["name"] = a["Name"].strip()
        if b.get("Valid"):
            d = b.get("Dimension") or {}
            s.update({k: v for k, v in {
                "type_code": b.get("ShipType") or None,
                "callsign": (b.get("CallSign") or "").strip() or None,
                "length_m": (d.get("A", 0) + d.get("B", 0)) or None,
                "beam_m": (d.get("C", 0) + d.get("D", 0)) or None}.items() if v})


def _eta(e):
    if not e or not e.get("Month") or not e.get("Day"):
        return None
    return f"{e['Month']:02d}-{e['Day']:02d} {e.get('Hour', 0):02d}:{e.get('Minute', 0):02d} UTC"


def enrich(s):
    cat, label = ship_type(s.get("type_code"))
    lat, lon = s.get("lat"), s.get("lon")
    s["category"], s["type_label"] = cat, label
    s["flag"] = flag_from_mmsi(s["mmsi"])
    s["kind"] = mmsi_kind(s["mmsi"])
    s["nav_status_label"] = NAV_STATUS.get(s.get("nav_status")) if s.get("nav_status") is not None else None
    if lat is not None:
        s["in_eez"] = in_eez(lat, lon)
        s["in_territorial_sea"] = in_territorial_sea(lat, lon)
        s["dist_koror_nm"] = round(km_to_nm(haversine_km(lat, lon, *KOROR)), 1)
    age = age_hours(s.get("last_pos"))
    s["age_h"] = round(age, 2)
    reasons = []
    if s.get("in_eez") and cat == "Fishing":
        reasons.append("Fishing vessel inside Palau's EEZ"
                       + ("" if s.get("in_territorial_sea") else " (outside the 12 NM territorial sea)"))
    if s.get("in_eez") and s.get("nav_status") == 7 and cat != "Fishing":
        reasons.append("Reports 'engaged in fishing' inside the EEZ")
    if cat == "Government & military":
        reasons.append(f"Government / {label.lower()} vessel")
    if WATCH_NAME.search(s.get("name") or ""):
        reasons.append("Name matches research / survey / coast-guard watch list")
    if s.get("in_eez") and age > 3:
        reasons.append(f"Not heard for {age:.0f} h while last seen inside the EEZ "
                       "(left receiver range or AIS switched off)")
    if s.get("nav_status") == 6:
        reasons.append("Reports aground")
    if s.get("nav_status") == 14 or s["kind"] in ("AIS-SART", "EPIRB", "MOB device"):
        reasons.append("Emergency beacon / SART")
    s["watch"] = reasons
    return s


def run():
    key = os.environ.get("AISSTREAM_API_KEY", "").strip()
    seconds = int(os.environ.get("AIS_LISTEN_SECONDS", "150"))
    prev = load_prev("ships.json", {}) or {}
    memory = {s["mmsi"]: s for s in prev.get("ships", []) if age_hours(s.get("last_pos")) < SHIP_MEMORY_HOURS}

    if not key:
        out = [enrich(s) for s in memory.values()]
        write_json("ships.json", {"updated": prev.get("updated"), "listen_seconds": 0, "messages": 0,
                                  "configured": False, "ships": out})
        return {"ok": False, "count": len(out), "configured": False,
                "message": "Not configured: add the AISSTREAM_API_KEY secret (free at aisstream.io)"}

    bbox = eez_bbox(margin=1.0)
    try:
        fresh, msgs = asyncio.run(_listen(key, seconds, bbox))
    except Exception as e:  # noqa: BLE001
        out = [enrich(s) for s in memory.values()]
        write_json("ships.json", {"updated": prev.get("updated"), "configured": True, "error": str(e)[:200],
                                  "ships": out})
        return {"ok": False, "count": len(out), "message": f"aisstream error: {str(e)[:160]}"}

    for mmsi, s in fresh.items():
        old = memory.get(mmsi, {})
        trail = old.get("trail", [])
        merged = {**old, **{k: v for k, v in s.items() if v is not None or k in POSITION_KEYS}}
        if s.get("lat") is not None:
            if not trail or abs(trail[-1][0] - s["lat"]) + abs(trail[-1][1] - s["lon"]) > 0.005:
                trail = (trail + [[s["lat"], s["lon"], s["last_pos"]]])[-TRAIL_POINTS:]
            merged.setdefault("first_seen", old.get("first_seen") or iso())
        merged["trail"] = trail
        memory[mmsi] = merged
    ships = [enrich(s) for s in memory.values() if s.get("lat") is not None]
    ships.sort(key=lambda s: (not s.get("in_eez"), s.get("dist_koror_nm") or 1e9))
    write_json("ships.json", {"updated": iso(), "listen_seconds": seconds, "messages": msgs,
                              "configured": True, "bbox": bbox, "memory_hours": SHIP_MEMORY_HOURS,
                              "ships": ships})
    live = sum(1 for s in ships if s["age_h"] < 1)
    in_e = sum(1 for s in ships if s.get("in_eez") and s["age_h"] < 6)
    return {"ok": True, "count": len(ships), "live": live, "in_eez": in_e,
            "fishing_in_eez": sum(1 for s in ships if s.get("in_eez") and s["category"] == "Fishing"
                                  and s["age_h"] < 6),
            "message": f"{msgs} AIS messages in {seconds}s; {live} ships heard this run, "
                       f"{len(ships)} in last {SHIP_MEMORY_HOURS:.0f} h ({in_e} in EEZ)"}


if __name__ == "__main__":
    print(run(), now_utc())
