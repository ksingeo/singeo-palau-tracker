"""Monthly visitor arrivals from the Palau Visitors Authority (PVA).

PVA publishes a "Visitors Arrival Summary Report" PDF each month. This reads
the summary text of each report: total arrivals, arrivals by key market
(China, Taiwan, Japan, ...), the year-to-date total and the year-on-year
change. Parsed months are cached, so each PDF is only read once."""
from __future__ import annotations

import io
import json
import re

from common import age_hours, http_get, iso, load_prev, write_json

API = "https://pristineparadisepalau.com/wp-json/wp/v2/media-publication"
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
MARKETS = {"China": r"China", "Taiwan": r"Taiwan", "Japan": r"Japan", "South Korea": r"(?:South )?Korea",
           "USA/Canada": r"USA\s*/\s*Canada|U\.S\./Canada|United States", "Europe": r"Europe",
           "Australia": r"Australia", "Others": r"Others"}
REFRESH_HOURS = 24
NUM = r"([\d][\d,]*)"


def _int(s):
    return int(s.replace(",", "")) if s else None


def pdf_text(raw: bytes, pages=1) -> str:
    from pypdf import PdfReader  # pip install pypdf
    r = PdfReader(io.BytesIO(raw))
    return "\n".join((r.pages[i].extract_text() or "") for i in range(min(pages, len(r.pages))))


def parse_report(text: str) -> dict:
    t = re.sub(r"[ \t]+", " ", text.replace("’", "'").replace("–", "-"))
    flat = re.sub(r"\s*\n\s*", " ", t)
    out = {}
    m = re.search(r"(\w+) (\d{4}) visitor arrivals (?:totaled|totalled|reached|were|stood at|amounted to) " + NUM, flat, re.I)
    if m:
        out["total"] = _int(m.group(3))
    # the first market-breakdown sentence describes the month itself
    k = re.search(r"largest source market|led (?:all markets )?with|top source market", flat, re.I)
    if k:
        seg = flat[max(0, k.start() - 120): k.start() + 520]
        seg = re.split(r"Compared with|For January|Year-to-date|Fiscal year", seg)[0]
        markets = {}
        for name, rx in MARKETS.items():
            mm = (re.search(rf"(?:{rx})\s*\(\s*{NUM}\s*\)", seg) or re.search(rf"(?:{rx})[^.()]{{0,60}}?with {NUM} visitors", seg)
                  or re.search(rf"{NUM} (?:visitors )?from (?:{rx})", seg))
            if mm:
                markets[name] = _int(mm.group(1))
        if markets:
            out["markets"] = markets
    y = re.search(r"January (?:through|to|-) \w+ (\d{4}), total visitor arrivals (?:reached|totaled|were) " + NUM, flat, re.I)
    if y:
        out["ytd"] = _int(y.group(2))
    c = re.search(r"Compared with \w+ \d{4}, arrivals (increased|decreased|rose|fell|declined) by " + NUM + r" visitors?, or (\d+(?:\.\d+)?)%", flat, re.I)
    if c:
        sign = -1 if c.group(1).lower() in ("decreased", "fell", "declined") else 1
        out["yoy_change"] = sign * _int(c.group(2))
        out["yoy_pct"] = sign * float(c.group(3))
    pm = re.search(r"from (" + "|".join(MONTHS) + r")'s " + NUM, flat, re.I)
    if pm:
        out["prev_month_name"], out["prev_month_total"] = pm.group(1).lower(), _int(pm.group(2))
    out["mentioned"] = [[f"{int(y)}-{MONTHS.index(mn.lower()) + 1:02d}", _int(v)] for mn, y, v in
                        re.findall(r"(" + "|".join(MONTHS) + r") (\d{4}) (?:low|high|peak|total) of " + NUM, flat, re.I)]
    # summary: the opening paragraph, from the "<Month> <Year> visitor arrivals totaled" sentence on
    start = m.start() if m else 0
    para = flat[start:start + 900]
    sentences = re.split(r"(?<=[.])\s+", para)
    out["summary"] = " ".join(sentences[:3]).strip()[:600] if m else ""
    # sanity check: market split must add up to the total (else drop it rather than show wrong numbers)
    if out.get("markets") and out.get("total"):
        tot = sum(out["markets"].values())
        if abs(tot - out["total"]) > max(25, 0.02 * out["total"]):
            out["markets_note"] = f"market split did not add up ({tot} vs {out['total']}); omitted"
            out.pop("markets")
    return out


def month_key(title: str):
    m = re.search(r"(" + "|".join(MONTHS) + r")\s+(\d{4})", title, re.I)
    return f"{m.group(2)}-{MONTHS.index(m.group(1).lower()) + 1:02d}" if m else None


def run():
    prev = load_prev("tourism.json", {}) or {}
    months = {m["month"]: m for m in prev.get("months", []) if m.get("total") and not m.get("derived_from")}
    if prev.get("updated") and age_hours(prev["updated"]) < REFRESH_HOURS and months:
        write_json("tourism.json", prev)
        return {"ok": True, "count": len(months), "message": f"Cached; latest {max(months)} (refreshes daily)"}
    posts = json.loads(http_get(f"{API}?search=Visitors%20Arrival%20Summary&per_page=30&_fields=id,date,link,title",
                                timeout=40))
    errors, new = [], 0
    for p in posts:
        title = re.sub(r"<[^>]+>", "", p["title"]["rendered"])
        key = month_key(title)
        if not key or key in months:
            continue
        try:
            page = http_get(p["link"], timeout=40).decode("utf-8", "replace")
            pdfs = re.findall(r"https://pristineparadisepalau\.com/wp-content/uploads/[^\"'\s]+?\.pdf", page)
            if not pdfs:
                raise RuntimeError("no PDF link on page")
            parsed = parse_report(pdf_text(http_get(pdfs[0], timeout=90), pages=1))
            if not parsed.get("total"):
                raise RuntimeError("total not found in PDF text")
            months[key] = {"month": key, "title": title, "published": p["date"], "link": p["link"], "pdf": pdfs[0], **parsed}
            new += 1
        except Exception as e:  # noqa: BLE001
            msg = str(e)[:120]
            errors.append(f"{title}: {msg}" if "total not found" not in msg else f"{title}: summary is an image (no text)")
    # Older reports are images; fill gaps with figures that newer reports state about earlier months.
    for m in list(months.values()):
        y, mo = map(int, m["month"].split("-"))
        if m.get("prev_month_total") and m.get("prev_month_name"):
            pk = f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
            if pk not in months and MONTHS[int(pk[5:]) - 1] == m["prev_month_name"]:
                months[pk] = {"month": pk, "total": m["prev_month_total"], "derived_from": m["title"], "link": m.get("link")}
        for mk, val in m.get("mentioned") or []:
            if mk not in months and val:
                months[mk] = {"month": mk, "total": val, "derived_from": m["title"], "link": m.get("link")}
        if m.get("total") and m.get("yoy_change") is not None:
            lk = f"{y - 1}-{mo:02d}"
            if lk not in months:
                months[lk] = {"month": lk, "total": m["total"] - m["yoy_change"], "derived_from": m["title"], "link": m.get("link")}
    out = {"updated": iso(), "source": "Palau Visitors Authority monthly arrival reports",
           "months": sorted(months.values(), key=lambda m: m["month"]), "errors": errors}
    write_json("tourism.json", out)
    latest = out["months"][-1] if out["months"] else {}
    return {"ok": bool(out["months"]), "count": len(out["months"]),
            "message": f"{len(out['months'])} months ({new} new); latest {latest.get('month')}: "
                       f"{latest.get('total'):,} visitors" if latest else "No reports parsed"
                       + (f"; {len(errors)} errors" if errors else "")}


if __name__ == "__main__":
    print(run())
