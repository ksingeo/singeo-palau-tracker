"""Arrivals / departures board for Roman Tmetuchl International Airport
(ICAO PTRO, IATA ROR) from AeroDataBox (via RapidAPI; free "Basic" plan).

Set AERODATABOX_API_KEY. Each refresh makes 2 requests (two 12-hour windows),
every AIRPORT_REFRESH_HOURS (default 6 h) = ~240 requests a month. Check your
plan's monthly quota and raise the interval if needed.

Without a key the dashboard falls back to flights observed by ADS-B."""
from __future__ import annotations

import json
import os
import urllib.parse
from datetime import timedelta, timezone

from common import age_hours, http_get, iso, load_prev, now_utc, write_json

KEY = os.environ.get("AERODATABOX_API_KEY", "").strip()
HOST = "aerodatabox.p.rapidapi.com"
REFRESH_HOURS = float(os.environ.get("AIRPORT_REFRESH_HOURS", "6"))
PALAU_TZ = timezone(timedelta(hours=9))


def _window(start, end):
    q = urllib.parse.urlencode({"withLeg": "true", "direction": "Both", "withCancelled": "true",
                                "withCodeshared": "false", "withCargo": "true", "withPrivate": "false",
                                "withLocation": "false"})
    url = f"https://{HOST}/flights/airports/icao/PTRO/{start:%Y-%m-%dT%H:%M}/{end:%Y-%m-%dT%H:%M}?{q}"
    raw = http_get(url, headers={"X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST}, timeout=40, retries=1)
    return json.loads(raw) if raw.strip() else {}


def _t(obj, key):
    x = (obj or {}).get(key) or {}
    return x.get("utc") or x.get("local") if isinstance(x, dict) else x


def _norm(f, direction):
    # withLeg=true -> "departure" and "arrival" objects; older shape -> "movement"
    here = f.get("arrival" if direction == "arrival" else "departure") or f.get("movement") or {}
    other = f.get("departure" if direction == "arrival" else "arrival") or {}
    other_ap = (other.get("airport") if other else None) or (f.get("movement") or {}).get("airport") or {}
    ac, al = f.get("aircraft") or {}, f.get("airline") or {}
    return {
        "direction": direction, "number": f.get("number"), "callsign": f.get("callSign"),
        "status": f.get("status"), "airline": al.get("name"), "airline_iata": al.get("iata"),
        "other_airport": other_ap.get("name") or other_ap.get("municipalityName"),
        "other_iata": other_ap.get("iata"), "other_icao": other_ap.get("icao"),
        "scheduled": _t(here, "scheduledTime"), "revised": _t(here, "revisedTime"),
        "runway_time": _t(here, "runwayTime"), "terminal": here.get("terminal"), "gate": here.get("gate"),
        "other_scheduled": _t(other, "scheduledTime"),
        "aircraft": ac.get("model"), "reg": ac.get("reg"), "modes": (ac.get("modeS") or "").lower() or None,
        "cargo": f.get("isCargo"),
    }


def run():
    prev = load_prev("airport.json", {}) or {}
    if not KEY:
        write_json("airport.json", {**prev, "configured": False})
        return {"ok": False, "configured": False,
                "message": "Not configured: add the AERODATABOX_API_KEY secret (RapidAPI, free Basic plan)"}
    if prev.get("configured") and age_hours(prev.get("updated")) < REFRESH_HOURS and not os.environ.get("FORCE"):
        write_json("airport.json", prev)
        return {"ok": True, "message": f"Cached (refreshes every {REFRESH_HOURS:.0f} h)",
                "count": len(prev.get("flights", []))}
    now_local = now_utc().astimezone(PALAU_TZ).replace(tzinfo=None, second=0, microsecond=0)
    windows = [(now_local - timedelta(hours=6), now_local + timedelta(hours=6)),
               (now_local + timedelta(hours=6), now_local + timedelta(hours=18))]
    flights, errors = {}, []
    for a, b in windows:
        try:
            d = _window(a, b)
        except Exception as e:  # noqa: BLE001
            errors.append(str(e)[:160])
            continue
        for direction, key in (("arrival", "arrivals"), ("departure", "departures")):
            for f in d.get(key) or []:
                n = _norm(f, direction)
                flights[(direction, n["number"], n["scheduled"])] = n
    if not flights and errors:
        write_json("airport.json", {**prev, "errors": errors, "configured": True})
        return {"ok": False, "message": f"AeroDataBox error: {errors[0]}"}
    out = sorted(flights.values(), key=lambda f: f["scheduled"] or "")
    write_json("airport.json", {"updated": iso(), "configured": True, "airport": "Roman Tmetuchl Intl (ROR / PTRO)",
                                "window": [iso(windows[0][0].replace(tzinfo=PALAU_TZ)), iso(windows[-1][1].replace(tzinfo=PALAU_TZ))],
                                "flights": out, "errors": errors})
    arr = sum(f["direction"] == "arrival" for f in out)
    return {"ok": True, "count": len(out), "message": f"{arr} arrivals, {len(out) - arr} departures in the next ~18 h"}


if __name__ == "__main__":
    print(run())
