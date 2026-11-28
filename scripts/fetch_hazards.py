"""Tropical cyclones (GDACS) and tsunami bulletins (NOAA PTWC/NTWC) relevant
to Palau. Earthquakes are fetched live in the browser from USGS."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import timedelta

from common import KOROR, haversine_km, http_get, http_json, iso, now_utc, strip_html, write_json

GDACS = "https://www.gdacs.org/gdacsapi/api"
TC_WATCH_KM = 4000          # list storms whose centre or track comes within this distance
TSUNAMI_FEEDS = [("PTWC (Pacific)", "https://www.tsunami.gov/events/xml/PHEBAtom.xml"),
                 ("NTWC", "https://www.tsunami.gov/events/xml/PAAQAtom.xml")]
CAT_LABEL = {"TD": "Tropical depression", "TS": "Tropical storm", "STS": "Severe tropical storm",
             "TY": "Typhoon", "STY": "Super typhoon", "Cat1": "Category 1", "Cat2": "Category 2",
             "Cat3": "Category 3", "Cat4": "Category 4", "Cat5": "Category 5", "H1": "Category 1",
             "H2": "Category 2", "HU": "Hurricane", "H3": "Category 3", "H4": "Category 4", "H5": "Category 5"}


def _thin(coords, n=80):
    step = max(1, len(coords) // n)
    out = coords[::step]
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return [[round(c[0], 3), round(c[1], 3)] for c in out]


def cyclones():
    today = now_utc().date()
    url = (f"{GDACS}/events/geteventlist/SEARCH?eventlist=TC&fromdate={(today - timedelta(days=10)).isoformat()}"
           f"&todate={today.isoformat()}&alertlevel=green;orange;red")
    fc = http_json(url, timeout=40)
    storms = []
    for f in fc.get("features", []):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        current = str(p.get("iscurrent")).lower() == "true"
        d_km = haversine_km(lat, lon, *KOROR)
        s = {"id": p.get("eventid"), "episode": p.get("episodeid"), "name": p.get("eventname") or p.get("name"),
             "title": p.get("name"), "alert": p.get("alertlevel"), "current": current,
             "lat": lat, "lon": lon, "dist_koror_km": round(d_km),
             "from": p.get("fromdate"), "to": p.get("todate"), "modified": p.get("datemodified"),
             "severity": (p.get("severitydata") or {}).get("severitytext"),
             "max_wind_kmh": (p.get("severitydata") or {}).get("severity"),
             "countries": [c.get("countryname") for c in p.get("affectedcountries") or [] if c.get("countryname")],
             "report": (p.get("url") or {}).get("report"), "source": p.get("source"),
             "track": [], "cone": None, "closest_km": round(d_km)}
        # only pull geometry for storms in the western Pacific / near Palau
        s["near"] = (90 <= lon <= 180 and -15 <= lat <= 45) or d_km <= TC_WATCH_KM
        if not s["near"]:
            if current:
                storms.append(s)
            continue
        try:
            g = http_json((p.get("url") or {}).get("geometry"), timeout=40)
            for gf in g.get("features", []):
                gp, geom = gf["properties"], gf["geometry"]
                cls = gp.get("Class", "")
                if cls.startswith("Line_") and geom["type"] == "LineString":
                    seg = geom["coordinates"]
                    s["track"].append({"coords": _thin(seg, 10), "cat": gp.get("polygonlabel"),
                                       "cat_label": CAT_LABEL.get(gp.get("polygonlabel"), gp.get("polygonlabel")),
                                       "forecast": bool(gp.get("forecast")), "time": gp.get("polygondate")})
                    for c in seg:
                        s["closest_km"] = min(s["closest_km"], round(haversine_km(c[1], c[0], *KOROR)))
                elif cls == "Poly_Cones" and geom["type"] == "Polygon":
                    s["cone"] = _thin(geom["coordinates"][0], 90)
        except Exception as e:  # noqa: BLE001
            s["geometry_error"] = str(e)[:120]
        s["near"] = s["closest_km"] <= TC_WATCH_KM
        if s["near"] or current:
            storms.append(s)
    storms.sort(key=lambda s: (not s["near"], not s["current"], s["closest_km"]))
    return storms


ATOM = "{http://www.w3.org/2005/Atom}"
GEO = "{http://www.w3.org/2003/01/geo/wgs84_pos#}"


def tsunami():
    out = []
    for name, url in TSUNAMI_FEEDS:
        root = ET.fromstring(http_get(url, timeout=30))
        feed_title = (root.findtext(f"{ATOM}title") or "").strip()
        for e in root.findall(f"{ATOM}entry"):
            summ = strip_html(ET.tostring(e.find(f"{ATOM}summary"), encoding="unicode", method="html")
                              if e.find(f"{ATOM}summary") is not None else "")
            cat = re.search(r"Category:\s*([A-Za-z ]+?)\s+Bulletin", summ)
            mag = re.search(r"Magnitude:\s*([\d.]+)\s*\((\w+)\)", summ)
            try:
                lat, lon = float(e.findtext(f"{GEO}lat")), float(e.findtext(f"{GEO}long"))
            except (TypeError, ValueError):
                lat = lon = None
            link = next((ln.get("href") for ln in e.findall(f"{ATOM}link") if ln.get("href")), None)
            out.append({"center": name, "bulletin": feed_title, "region": (e.findtext(f"{ATOM}title") or "").strip(),
                        "updated": e.findtext(f"{ATOM}updated"), "category": cat.group(1).strip() if cat else None,
                        "magnitude": float(mag.group(1)) if mag else None, "mag_type": mag.group(2) if mag else None,
                        "lat": lat, "lon": lon, "link": link,
                        "dist_koror_km": round(haversine_km(lat, lon, *KOROR)) if lat is not None else None,
                        "summary": summ[:500]})
    out.sort(key=lambda t: t.get("updated") or "", reverse=True)
    return out


def run():
    errors, storms, tsu = [], [], []
    try:
        storms = cyclones()
    except Exception as e:  # noqa: BLE001
        errors.append(f"GDACS: {str(e)[:160]}")
    try:
        tsu = tsunami()
    except Exception as e:  # noqa: BLE001
        errors.append(f"Tsunami: {str(e)[:160]}")
    write_json("hazards.json", {"updated": iso(), "cyclones": storms, "tsunami": tsu, "errors": errors})
    near = [s for s in storms if s["current"] and s["closest_km"] < 1500]
    return {"ok": len(errors) < 2, "count": len(storms),
            "message": f"{sum(s['current'] and s['near'] for s in storms)} active cyclones within "
                       f"{TC_WATCH_KM} km, {sum(s['current'] for s in storms)} worldwide"
                       f"{f' ({len(near)} within 1500 km of Koror)' if near else ''}; {len(tsu)} tsunami bulletins"
                       + (f"; errors: {'; '.join(errors)}" if errors else "")}


if __name__ == "__main__":
    print(run())
