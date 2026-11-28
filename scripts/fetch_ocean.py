"""Coral bleaching heat stress for Palau from NOAA Coral Reef Watch's
5 km virtual station (daily SST, SST anomaly, Degree Heating Weeks and
Bleaching Alert Area)."""
from __future__ import annotations

import re

from common import http_get, iso, write_json

URL = "https://coralreefwatch.noaa.gov/product/vs/data/palau.txt"
DAYS = 400
BAA = {0: "No stress", 1: "Bleaching watch", 2: "Bleaching warning", 3: "Alert level 1", 4: "Alert level 2",
       5: "Alert level 3", 6: "Alert level 4", 7: "Alert level 5"}


def run():
    txt = http_get(URL, timeout=60).decode("utf-8", "replace")
    mmm = re.search(r"Averaged Maximum Monthly Mean:\s*([\d.]+)", txt)
    monthly = re.search(r"Averaged Monthly Mean \(Jan-Dec\):\s*([\d.\s]+?)\n", txt)
    rows = []
    for line in txt.splitlines():
        parts = line.split()
        if len(parts) >= 10 and parts[0].isdigit() and len(parts[0]) == 4:
            try:
                y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
                rows.append([f"{y:04d}-{m:02d}-{d:02d}", float(parts[5]), float(parts[6]), float(parts[8]),
                             int(float(parts[9])), float(parts[3]), float(parts[4])])
            except ValueError:
                continue
    rows = rows[-DAYS:]
    latest = rows[-1] if rows else None
    out = {
        "updated": iso(), "source": URL,
        "mmm_c": float(mmm.group(1)) if mmm else None,
        "bleaching_threshold_c": round(float(mmm.group(1)) + 1, 2) if mmm else None,
        "monthly_mean_c": [float(x) for x in monthly.group(1).split()] if monthly else None,
        "baa_labels": BAA,
        "columns": ["date", "sst_c", "ssta_c", "dhw", "baa", "sst_min_c", "sst_max_c"],
        "rows": rows,
        "latest": dict(zip(["date", "sst_c", "ssta_c", "dhw", "baa", "sst_min_c", "sst_max_c"], latest)) if latest else None,
    }
    if out["latest"]:
        out["latest"]["baa_label"] = BAA.get(out["latest"]["baa"], str(out["latest"]["baa"]))
    write_json("ocean.json", out)
    lt = out["latest"] or {}
    return {"ok": bool(rows), "count": len(rows),
            "message": f"{lt.get('date')}: SST {lt.get('sst_c')} °C, DHW {lt.get('dhw')}, {lt.get('baa_label')}"}


if __name__ == "__main__":
    print(run())
