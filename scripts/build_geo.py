"""One-off helper: download Palau maritime boundaries from Marine Regions
(VLIZ, CC-BY 4.0) and write simplified GeoJSON used by the dashboard and the
data scripts. Run manually: python scripts/build_geo.py"""
import json
import os
import urllib.parse
import urllib.request

WFS = "https://geo.vliz.be/geoserver/MarineRegions/wfs"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "geo")


def wfs(type_name, cql):
    q = urllib.parse.urlencode({
        "service": "WFS", "version": "1.0.0", "request": "GetFeature",
        "typeName": type_name, "outputFormat": "application/json", "cql_filter": cql,
    })
    with urllib.request.urlopen(f"{WFS}?{q}", timeout=120) as r:
        return json.load(r)


def perp_dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return ((x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2) ** 0.5


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    stack, keep = [(0, len(pts) - 1)], {0, len(pts) - 1}
    while stack:
        s, e = stack.pop()
        best, idx = 0, None
        for i in range(s + 1, e):
            d = perp_dist(pts[i], pts[s], pts[e])
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep.add(idx)
            stack += [(s, idx), (idx, e)]
    return [[round(pts[i][0], 4), round(pts[i][1], 4)] for i in sorted(keep)]


def polys(geom):
    return geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]


def simplify_polygons(fc, tol, min_pts=4, keep_holes=False):
    out = []
    for f in fc["features"]:
        for poly in polys(f["geometry"]):
            rings = poly if keep_holes else poly[:1]
            new = [simplify(r, tol) for r in rings]
            new = [r for r in new if len(r) >= min_pts]
            if new:
                out.append(new)
    return out


def main():
    eez = wfs("MarineRegions:eez", "mrgid=8315")
    props = eez["features"][0]["properties"]
    eez_polys = simplify_polygons(eez, 0.004)
    feature = {"type": "Feature", "properties": {
        "name": props["geoname"], "mrgid": 8315, "area_km2": props.get("area_km2"),
        "source": "Marine Regions (VLIZ) EEZ v12, CC-BY 4.0"},
        "geometry": {"type": "MultiPolygon", "coordinates": eez_polys}}
    json.dump({"type": "FeatureCollection", "features": [feature]},
              open(os.path.join(OUT, "palau-eez.geojson"), "w"), separators=(",", ":"))

    ts = wfs("MarineRegions:eez_12nm", "mrgid=49045")
    ts_polys = simplify_polygons(ts, 0.001, keep_holes=True)
    json.dump({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "name": "Palauan 12 NM Territorial Sea", "mrgid": 49045},
        "geometry": {"type": "MultiPolygon", "coordinates": ts_polys}}]},
        open(os.path.join(OUT, "palau-12nm.geojson"), "w"), separators=(",", ":"))

    b = wfs("MarineRegions:eez_boundaries", "territory1='Palau' OR territory2='Palau'")
    feats = []
    for f in b["features"]:
        p = f["properties"]
        if p.get("line_type") in ("Straight baseline", "200 NM"):
            continue
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        feats.append({"type": "Feature", "properties": {
            "line_type": p.get("line_type"), "name": p.get("line_name"),
            "territory1": p.get("territory1"), "territory2": p.get("territory2")},
            "geometry": {"type": "MultiLineString", "coordinates": [simplify(l, 0.004) for l in lines]}})
    json.dump({"type": "FeatureCollection", "features": feats},
              open(os.path.join(OUT, "palau-boundaries.geojson"), "w"), separators=(",", ":"))
    print("EEZ rings:", len(eez_polys), "points:", sum(len(p[0]) for p in eez_polys))
    print("props:", {k: props[k] for k in ("area_km2",) if k in props})


if __name__ == "__main__":
    main()
