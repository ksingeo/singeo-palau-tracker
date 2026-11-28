"""Shared helpers for the Palau tracker data pipeline (stdlib only)."""
from __future__ import annotations

import gzip
import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT, "data")
GEO_DIR = os.path.join(ROOT, "assets", "geo")
UA = "Mozilla/5.0 (compatible; PalauTracker/1.0; +https://github.com/)"

# Reference points
KOROR = (7.3426, 134.4789)          # lat, lon
ROR_AIRPORT = (7.3673, 134.5442)    # Roman Tmetuchl International (PTRO / ROR)
PALAU_CENTER = (7.5, 134.5)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now_utc()).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def http_get(url: str, headers: dict | None = None, timeout: int = 30, retries: int = 2,
             data: bytes | None = None, method: str | None = None) -> bytes:
    h = {"User-Agent": UA, "Accept-Encoding": "gzip"}
    h.update(headers or {})
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=h, data=data, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as e:  # don't retry client errors
            last = e
            if 400 <= e.code < 500 and e.code != 429:
                break
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url.split('?')[0]} failed: {last}")


def http_json(url: str, **kw):
    return json.loads(http_get(url, headers={"Accept": "application/json", **kw.pop("headers", {})}, **kw))


# ---------------------------------------------------------------- data files
def write_json(name: str, obj) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, path)


def load_prev(name: str, default=None):
    """Previous version of a data file: from the deployed site (PREV_BASE_URL)
    when running in GitHub Actions, otherwise from the local data/ folder."""
    base = os.environ.get("PREV_BASE_URL", "").rstrip("/")
    if base:
        try:
            return json.loads(http_get(f"{base}/data/{name}?t={int(time.time())}", timeout=20, retries=1))
        except Exception as e:  # noqa: BLE001
            print(f"  (no previous {name} from site: {e})")
    path = os.path.join(DATA_DIR, name)
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            pass
    return default


def age_hours(iso_str: str | None) -> float:
    dt = parse_iso(iso_str)
    return 1e9 if dt is None else (now_utc() - dt).total_seconds() / 3600


# ---------------------------------------------------------------- geography
def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def km_to_nm(km: float) -> float:
    return km / 1.852


def bearing_deg(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _load_polys(fname):
    with open(os.path.join(GEO_DIR, fname), encoding="utf-8") as f:
        fc = json.load(f)
    polys = []
    for feat in fc["features"]:
        g = feat["geometry"]
        polys += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return polys


def _in_ring(lon, lat, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def _in_polys(lon, lat, polys) -> bool:
    for poly in polys:
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


_EEZ = None
_TS = None


def in_eez(lat, lon) -> bool:
    global _EEZ
    if _EEZ is None:
        _EEZ = _load_polys("palau-eez.geojson")
    return _in_polys(lon, lat, _EEZ)


def in_territorial_sea(lat, lon) -> bool:
    """Inside the 12 NM territorial sea or the internal waters it encloses."""
    global _TS
    if _TS is None:
        _TS = _load_polys("palau-12nm.geojson")
    # treat the enclosed hole (internal waters) as inside too
    return any(_in_ring(lon, lat, p[0]) for p in _TS)


def eez_bbox(margin=0.5):
    global _EEZ
    if _EEZ is None:
        _EEZ = _load_polys("palau-eez.geojson")
    xs = [c[0] for p in _EEZ for c in p[0]]
    ys = [c[1] for p in _EEZ for c in p[0]]
    return min(ys) - margin, min(xs) - margin, max(ys) + margin, max(xs) + margin


def strip_html(s: str | None) -> str:
    import html
    import re
    if not s:
        return ""
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()
