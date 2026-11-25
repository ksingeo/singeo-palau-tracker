"""Run every fetcher, then write data/status.json and data/history.json.

Each fetcher is isolated: one failing source never stops the others."""
from __future__ import annotations

import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(__file__))

import fetch_flights  # noqa: E402
import fetch_gfw  # noqa: E402
import fetch_hazards  # noqa: E402
import fetch_news  # noqa: E402
import fetch_ocean  # noqa: E402
import fetch_ships  # noqa: E402
from common import age_hours, iso, load_prev, write_json  # noqa: E402

HISTORY_DAYS = 14
JOBS = [
    ("ships", "Ships (aisstream.io AIS)", fetch_ships.run),
    ("flights", "Flights (adsb.lol / adsb.fi)", fetch_flights.run),
    ("news", "News feeds", fetch_news.run),
    ("hazards", "Cyclones & tsunami (GDACS / NOAA)", fetch_hazards.run),
    ("ocean", "Coral heat stress (NOAA CRW)", fetch_ocean.run),
    ("gfw", "Fishing activity (Global Fishing Watch)", fetch_gfw.run),
]


def main(only=None):
    status = {"updated": iso(), "sources": {}}
    if only:  # partial run: keep the other sources' last status
        status["sources"] = (load_prev("status.json", {}) or {}).get("sources", {})
    results = {}
    for key, label, fn in JOBS:
        if only and key not in only:
            continue
        t0 = time.time()
        print(f"→ {label}")
        try:
            r = fn() or {}
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            r = {"ok": False, "message": f"{type(e).__name__}: {str(e)[:200]}"}
        r["seconds"] = round(time.time() - t0, 1)
        results[key] = r
        print(f"  {'OK ' if r.get('ok') else 'ERR'} {r.get('message')} ({r['seconds']}s)")
        status["sources"][key] = {"label": label, "ok": bool(r.get("ok")), "message": r.get("message"),
                                  "count": r.get("count"), "seconds": r["seconds"], "checked": iso(),
                                  "configured": r.get("configured", True)}
    write_json("status.json", status)

    # trend history for the charts
    prev = load_prev("history.json", {}) or {}
    rows = [r for r in prev.get("rows", []) if age_hours(r.get("t")) < HISTORY_DAYS * 24]
    s, f = results.get("ships", {}), results.get("flights", {})
    row = {"t": iso()}
    if s.get("ok"):
        row.update({"ships_live": s.get("live"), "ships_eez": s.get("in_eez"),
                    "fishing_eez": s.get("fishing_in_eez")})
    if f.get("ok"):
        row.update({"aircraft_palau": f.get("palau_count"), "aircraft_region": f.get("count")})
    if len(row) > 1 and not only:
        rows.append(row)
    write_json("history.json", {"updated": iso(), "rows": rows})
    return results


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
