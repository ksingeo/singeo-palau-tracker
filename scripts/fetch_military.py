"""US military activity in Palau:
- Defense contracts performed in Palau (USAspending.gov, no key needed), e.g.
  TACMOR radar infrastructure, Navy construction, airfield work
- Defense spending in Palau by fiscal year
- A filtered news feed about US/allied military projects in Palau"""
from __future__ import annotations

import hashlib
import os
import re

from common import age_hours, http_get, iso, load_prev, write_json
from fetch_news import classify, clean_title, gnews, norm_key, parse_date, parse_feed, strip_html
from fetch_policy import CONTRACTS, spending_by_year, top_awards

REFRESH_HOURS = float(os.environ.get("MILITARY_REFRESH_HOURS", "3"))
QUERIES = [
    gnews('Palau (military OR "U.S. Army" OR Navy OR Marines OR "Air Force" OR "Coast Guard" OR Pentagon OR '
          '"Department of Defense" OR INDOPACOM OR Seabees) -Barcelona -Barça when:30d'),
    gnews('Palau (TACMOR OR radar OR Angaur OR Peleliu OR airfield OR runway OR "Valiant Shield" OR exercise) '
          '-Barcelona when:60d'),
    gnews('site:dvidshub.net Palau'),
]
MIL = re.compile(r"military|army|navy|naval|marine corps|marines|air force|coast guard|pentagon|defen[cs]e|indopacom|"
                 r"seabee|radar|tacmor|airfield|runway|exercise|troops|soldier|sailor|warship|destroyer|base\b|"
                 r"homeland security|shiprider|patrol", re.I)
PALAU = re.compile(r"\bpalau|koror|angaur|peleliu|babeldaob|melekeok|airai|ngaraard|kayangel", re.I)
EXCLUDE = re.compile(r"barcelona|bar[çc]a\b|palau de |palau sant jordi|blaugrana", re.I)


def news():
    items, seen = {}, set()
    for url in QUERIES:
        for r in parse_feed(http_get(url, timeout=25)):
            title = clean_title(r["title"], r["publisher"])
            desc = strip_html(r["desc"])
            blob = f"{title} {desc}"
            if EXCLUDE.search(title) or not PALAU.search(blob) or not MIL.search(blob):
                continue
            k = norm_key(title)
            dt = parse_date(r["date"])
            if k in seen or dt is None:
                continue
            seen.add(k)
            iid = hashlib.sha1(k.encode()).hexdigest()[:12]
            items[iid] = {"id": iid, "title": title, "link": r["link"], "source": r["publisher"] or "Google News",
                          "published": iso(dt), "countries": classify(blob)[1]}
    # also pick up defense stories already collected by the main news feed (Island Times etc.)
    prev_news = load_prev("news.json", {}) or {}
    for i in prev_news.get("items", []):
        if MIL.search(f"{i['title']} {i.get('summary', '')}") and i.get("relevance") != "regional" \
                and norm_key(i["title"]) not in seen:
            items[i["id"]] = {k: i[k] for k in ("id", "title", "link", "source", "published", "countries")}
    return sorted(items.values(), key=lambda i: i["published"], reverse=True)[:60]


def run():
    prev = load_prev("military.json", {}) or {}
    if prev.get("updated") and age_hours(prev["updated"]) < REFRESH_HOURS and not os.environ.get("FORCE"):
        write_json("military.json", prev)
        return {"ok": True, "message": f"Cached (refreshes every {REFRESH_HOURS:.0f} h)", "count": len(prev.get("news", []))}
    out, errors = {"updated": iso()}, []
    dod = "Department of Defense"
    jobs = (("contracts_top", lambda: top_awards(CONTRACTS, years=5, limit=20, agency=dod)),
            ("contracts_recent", lambda: top_awards(CONTRACTS, years=2, limit=20, agency=dod, sort="Start Date")),
            ("dod_by_year", lambda: spending_by_year({"agencies": [{"type": "awarding", "tier": "toptier", "name": dod}]}, 2012)),
            ("news", news))
    for name, fn in jobs:
        try:
            out[name] = fn()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {str(e)[:140]}")
            out[name] = prev.get(name, [])
    out["errors"] = errors
    write_json("military.json", out)
    return {"ok": len(errors) < len(jobs), "count": len(out.get("news", [])),
            "message": f"{len(out.get('contracts_top', []))} DoD contracts, {len(out.get('news', []))} defense stories"
                       + (f"; errors: {errors[0]}" if errors else "")}


if __name__ == "__main__":
    print(run())
