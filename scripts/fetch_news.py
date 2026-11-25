"""Palau news aggregator: local papers, government, regional outlets and news
search engines, filtered for relevance to the Republic of Palau."""
from __future__ import annotations

import hashlib
import re
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from common import age_hours, http_get, iso, load_prev, now_utc, strip_html, write_json

KEEP_DAYS = 45
MAX_ITEMS = 300


def gnews(q):
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})


def bing(q):
    return "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": q, "format": "rss"})


# kind: local (Palau outlet), government, regional, search (aggregator)
# trusted=True -> every item is about Palau, no relevance filter needed
SOURCES = [
    {"id": "islandtimes", "name": "Island Times", "kind": "local", "trusted": True,
     "urls": ["https://islandtimes.org/feed/", "https://islandtimes.org/feed/?paged=2"]},
    {"id": "palaugov", "name": "PalauGov.pw", "kind": "government", "trusted": True,
     "urls": ["https://www.palaugov.pw/feed/"]},
    {"id": "rnz", "name": "RNZ Pacific", "kind": "regional", "trusted": False,
     "urls": ["https://www.rnz.co.nz/rss/pacific.xml"]},
    {"id": "pit", "name": "Pacific Island Times", "kind": "regional", "trusted": False,
     "urls": ["https://www.pacificislandtimes.com/blog-feed.xml"]},
    {"id": "gnews", "name": "Google News", "kind": "search", "trusted": False, "urls": [
        gnews('"Republic of Palau" OR Koror OR "Surangel Whipps" OR "Palau\'s" OR Palauan when:14d'),
        gnews('Palau (Pacific OR Micronesia OR Taiwan OR China OR Compact OR island) '
              '-Barcelona -Barça -"Palau de" -"Palau Sant Jordi" -Blaugrana when:14d'),
        gnews('Palau (tourism OR fishing OR ocean OR navy OR "coast guard" OR typhoon) '
              '-Barcelona -Barça -"Palau de" when:14d'),
    ]},
    {"id": "bing", "name": "Bing News", "kind": "search", "trusted": False, "urls": [
        bing('"Republic of Palau"'), bing("Palau Koror"), bing("Palau President Whipps")]},
]

STRONG = re.compile(r"\b(palauan|koror|babeldaob|babelthuap|peleliu|angaur|kayangel|melekeok|ngerulmud|"
                    r"airai|ngarchelong|ngardmau|ngaraard|ngatpang|ngchesar|ngiwal|aimeliik|ngaremlengui|"
                    r"ngeremlengui|sonsorol|hatohobei|tobi|helen reef|olbiil era kelulau|surangel whipps|"
                    r"republic of palau|rock islands|jellyfish lake|malakal|belau)\b", re.I)
PALAU = re.compile(r"\bpalau\b", re.I)
EXCLUDE = re.compile(r"(barcelona|bar[çc]a\b|palau de |palau sant jordi|blaugrana|euroleague|"
                     r"palau-solit|palau de la m|flan factory|joseph palau|palau rib|valencia basket|"
                     r"\bkosher\b|obituary)", re.I)

TOPICS = [
    ("Diplomacy & Security", r"taiwan|china|chinese|beijing|united states|\bu\.s\.|\bUS\b|america|compact|cofa|"
     r"military|defen[cs]e|radar|navy|coast guard|army|marine corps|japan|australia|embassy|ambassador|"
     r"united nations|\bun\b|pacific islands forum|\bpif\b|diplomat|security|minister of state|treaty"),
    ("Environment & Climate", r"climate|ocean|reef|coral|sanctuary|pnms|conservation|cop3\d|plastic|shark|"
     r"turtle|el ni[ñn]o|drought|sea level|biodiversity|environment|marine protected|mangrove|dugong"),
    ("Economy & Tourism", r"touris|visitor|economy|economic|budget|debt|bank|stablecoin|crypto|investment|"
     r"airline|hotel|resort|\btax|revenue|business|\btrade\b|\bimf\b|\badb\b|world bank|funding|\bgrant|\$\d|prices?\b|inflation"),
    ("Government & Politics", r"president|vice president|senate|senator|house of delegates|olbiil|congress|"
     r"\boek\b|minister|ministry|election|governor|court|judge|law\b|bill\b|legislat|council of chiefs|"
     r"\bchief|cabinet|government"),
    ("Fishing & Maritime", r"fishing|fisher|tuna|vessel|\bships?\b|shipping|maritime|\biuu\b|\bboats?\b|"
     r"\bport\b|harbou?r|seafarer|maritime surveillance|patrol boat|\beez\b|\bdock\b"),
    ("Health & Society", r"health|hospital|covid|dengue|disease|school|education|student|culture|youth|"
     r"women|church|community|water crisis|drug|meth|police|crime|arrest"),
    ("Weather & Hazards", r"typhoon|storm|tropical depression|earthquake|tsunami|flood|weather|rain|"
     r"small craft|warning|emergency|nemo"),
    ("Sports", r"\bsport|olympic|games\b|football|soccer|basketball|baseball|swim|athlet|tournament|"
     r"micronesian games|pacific games"),
]
TOPICS = [(n, re.compile(p.replace(r"\bUS\b", r"(?-i:\bUS\b)"), re.I)) for n, p in TOPICS]
COUNTRIES = [
    ("United States", r"united states|\bu\.s\.|\bUS\b|america|washington|pentagon|trump|us congress"),
    ("Taiwan", r"taiwan|taipei|\broc\b"), ("China", r"china|chinese|beijing|\bprc\b"),
    ("Japan", r"japan|tokyo"), ("Australia", r"australia|canberra"),
    ("Philippines", r"philippin|manila"), ("Indonesia", r"indonesia|jakarta"),
    ("South Korea", r"korea|seoul"), ("Micronesia (FSM)", r"micronesia|\bfsm\b|yap\b|pohnpei|chuuk"),
    ("Guam", r"\bguam\b"), ("Israel", r"israel"),
]
COUNTRIES = [(n, re.compile(p.replace(r"\bUS\b", r"(?-i:\bUS\b)"), re.I)) for n, p in COUNTRIES]


def _text(el, tag):
    x = el.find(tag)
    return (x.text or "").strip() if x is not None and x.text else ""


def parse_feed(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for it in root.iter("item"):
        src = it.find("source")
        items.append({
            "title": strip_html(_text(it, "title")),
            "link": _text(it, "link"),
            "date": _text(it, "pubDate"),
            "desc": _text(it, "description") or _text(it, "{http://purl.org/rss/1.0/modules/content/}encoded"),
            "publisher": (src.text or "").strip() if src is not None and src.text else "",
            "categories": [c.text for c in it.findall("category") if c.text],
            "image": next((m.get("url") for m in it.iter() if m.tag.endswith("}content") and m.get("url")), None),
        })
    return items


def parse_date(s):
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).astimezone(tz=None).astimezone(now_utc().tzinfo)
    except Exception:  # noqa: BLE001
        return None


def clean_title(title, publisher):
    # Google/Bing append " - Publisher"
    if publisher and title.endswith(" - " + publisher):
        return title[: -len(publisher) - 3].strip()
    return title


def classify(text):
    scored = sorted(((len(rx.findall(text)), n) for n, rx in TOPICS), reverse=True)
    top = scored[0][0] if scored else 0
    topics = [n for c, n in scored if c and (c >= 2 or c == top)][:2]
    countries = [n for n, rx in COUNTRIES if rx.search(text)]
    return topics or ["General"], countries[:4]


def relevance(title, desc, trusted):
    blob = f"{title} {desc}"
    if EXCLUDE.search(title):
        return None
    if trusted:
        return "high" if (PALAU.search(blob) or STRONG.search(blob)) else "regional"
    t_hits = bool(PALAU.search(title) or STRONG.search(title))
    if t_hits:
        return "high"
    if STRONG.search(desc) or len(PALAU.findall(desc)) >= 2:
        return "medium"
    if PALAU.search(desc) and not EXCLUDE.search(blob):
        return "mention"
    return None


def norm_key(title):
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:90]


def run():
    status = {}
    prev = load_prev("news.json", {}) or {}
    items = {i["id"]: i for i in prev.get("items", []) if age_hours(i.get("published")) < KEEP_DAYS * 24}
    seen_titles = {norm_key(i["title"]): i["id"] for i in items.values()}
    for src in SOURCES:
        n_new, errs = 0, []
        for url in src["urls"]:
            try:
                raw = parse_feed(http_get(url, timeout=25))
            except Exception as e:  # noqa: BLE001
                errs.append(str(e)[:160])
                continue
            for r in raw:
                title = clean_title(r["title"], r["publisher"])
                if not title or not r["link"]:
                    continue
                desc = strip_html(r["desc"])
                if desc.startswith(title):
                    desc = desc[len(title):].strip(" - ")
                if r["publisher"] and desc.strip() == r["publisher"]:
                    desc = ""
                rel = relevance(title, desc, src["trusted"])
                if rel is None or (src["kind"] == "search" and rel == "mention"):
                    continue
                dt = parse_date(r["date"])
                if dt is None or age_hours(iso(dt)) > KEEP_DAYS * 24:
                    continue
                key = norm_key(title)
                if key in seen_titles:
                    # prefer the local/trusted copy of a duplicated story
                    old = items.get(seen_titles[key])
                    if old and src["trusted"] and not old.get("trusted"):
                        del items[old["id"]]
                    else:
                        continue
                topics, countries = classify(f"{title} {desc} {' '.join(r['categories'])}")
                iid = hashlib.sha1(key.encode()).hexdigest()[:12]
                items[iid] = {
                    "id": iid, "title": title, "link": r["link"],
                    "source": r["publisher"] or src["name"], "via": src["name"], "kind": src["kind"],
                    "trusted": src["trusted"], "published": iso(dt),
                    "summary": (desc[:420] + "…") if len(desc) > 420 else desc,
                    "topics": topics, "countries": countries, "relevance": rel,
                    "image": r["image"],
                }
                seen_titles[key] = iid
                n_new += 1
        status[src["id"]] = {"name": src["name"], "ok": not errs or n_new > 0,
                             "new": n_new, "errors": errs}
    out = sorted(items.values(), key=lambda i: i["published"], reverse=True)[:MAX_ITEMS]
    write_json("news.json", {"updated": iso(), "count": len(out), "sources": status, "items": out})
    ok = sum(1 for s in status.values() if s["ok"])
    return {"ok": ok > 0, "count": len(out),
            "message": f"{ok}/{len(status)} feeds OK, {len(out)} stories",
            "details": status}


if __name__ == "__main__":
    print(run())
