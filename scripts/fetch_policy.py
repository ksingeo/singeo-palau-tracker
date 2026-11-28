"""US policy & funding for Palau:
- Bills in Congress about Palau / the Compact of Free Association (GovInfo, plus
  latest action from Congress.gov when a key is set)
- Federal Register notices and rules that concern Palau
- Federal spending in Palau by fiscal year and by agency (USAspending.gov), the
  closest public proxy for Compact (COFA) assistance flows

A free api.data.gov key (DATA_GOV_API_KEY) covers both GovInfo and Congress.gov.
Without it the shared DEMO_KEY is used, which is heavily rate-limited."""
from __future__ import annotations

import json
import os
import re
import urllib.parse
from datetime import date

from common import age_hours, http_get, iso, load_prev, now_utc, write_json

KEY = os.environ.get("DATA_GOV_API_KEY", "").strip() or "DEMO_KEY"
REFRESH_HOURS = float(os.environ.get("POLICY_REFRESH_HOURS", "12"))
USA = "https://api.usaspending.gov/api/v2"
PALAU = [{"country": "PLW"}]
TYPE_NAMES = {"hr": "H.R.", "s": "S.", "hres": "H.Res.", "sres": "S.Res.", "hjres": "H.J.Res.",
              "sjres": "S.J.Res.", "hconres": "H.Con.Res.", "sconres": "S.Con.Res."}
TYPE_SLUG = {"hr": "house-bill", "s": "senate-bill", "hres": "house-resolution", "sres": "senate-resolution",
             "hjres": "house-joint-resolution", "sjres": "senate-joint-resolution",
             "hconres": "house-concurrent-resolution", "sconres": "senate-concurrent-resolution"}
VERSION = {"ih": "Introduced in House", "is": "Introduced in Senate", "rh": "Reported in House",
           "rs": "Reported in Senate", "eh": "Passed House", "es": "Passed Senate", "enr": "Enrolled (sent to President)",
           "rfs": "Referred in Senate", "rfh": "Referred in House", "pcs": "Placed on Senate calendar",
           "ats": "Agreed to (Senate)", "ath": "Agreed to (House)", "eas": "Senate amendment", "eah": "House amendment"}
RELEVANT = re.compile(r"palau|compact of free association|freely associated|koror|cofa\b", re.I)


def post_json(url, body, timeout=60):
    return json.loads(http_get(url, headers={"Content-Type": "application/json", "Accept": "application/json"},
                               data=json.dumps(body).encode(), method="POST", timeout=timeout, retries=1))


def fiscal_year(d=None):
    d = d or now_utc().date()
    return d.year + 1 if d.month >= 10 else d.year


# ---------------------------------------------------------------- Congress
def bills():
    body = {"query": "title:(Palau) collection:BILLS", "pageSize": 60, "offsetMark": "*",
            "sorts": [{"field": "publishdate", "sortOrder": "DESC"}]}
    d = post_json(f"https://api.govinfo.gov/search?api_key={KEY}", body)
    out = {}
    for r in d.get("results", []):
        m = re.match(r"BILLS-(\d+)([a-z]+?)(\d+)([a-z]+)$", r.get("packageId", ""))
        if not m:
            continue
        congress, btype, num, ver = m.groups()
        bid = f"{congress}-{btype}-{num}"
        if bid in out:          # results are newest first; keep the latest text version
            out[bid]["versions"].append(VERSION.get(ver, ver))
            continue
        out[bid] = {"id": bid, "congress": int(congress), "type": btype, "number": int(num),
                    "label": f"{TYPE_NAMES.get(btype, btype.upper())} {num}", "title": r.get("title"),
                    "date": r.get("dateIssued"), "version": VERSION.get(ver, ver), "versions": [VERSION.get(ver, ver)],
                    "chamber": ", ".join(r.get("governmentAuthor") or []),
                    "url": f"https://www.congress.gov/bill/{congress}th-congress/{TYPE_SLUG.get(btype, btype)}/{num}",
                    "text_url": f"https://www.govinfo.gov/app/details/{r.get('packageId')}"}
    items = sorted(out.values(), key=lambda b: b["date"] or "", reverse=True)
    if KEY != "DEMO_KEY":       # enrich the most recent ones with status from Congress.gov
        for b in items[:15]:
            try:
                d = json.loads(http_get(f"https://api.congress.gov/v3/bill/{b['congress']}/{b['type']}/{b['number']}"
                                        f"?format=json&api_key={KEY}", timeout=30, retries=1)).get("bill", {})
                la = d.get("latestAction") or {}
                sp = (d.get("sponsors") or [{}])[0]
                b.update({"latest_action": la.get("text"), "latest_action_date": la.get("actionDate"),
                          "introduced": d.get("introducedDate"), "sponsor": sp.get("fullName"),
                          "cosponsors": (d.get("cosponsors") or {}).get("count"),
                          "policy_area": (d.get("policyArea") or {}).get("name")})
            except Exception as e:  # noqa: BLE001
                b["status_error"] = str(e)[:80]
    return items


# ---------------------------------------------------------------- Federal Register
def federal_register():
    q = urllib.parse.urlencode([("conditions[term]", '"Palau" | "Compact of Free Association" | "Freely Associated States"'),
                                ("order", "newest"), ("per_page", "100")] +
                               [("fields[]", f) for f in ("title", "type", "abstract", "publication_date", "html_url",
                                                          "agencies", "document_number", "excerpts")])
    d = json.loads(http_get(f"https://www.federalregister.gov/api/v1/documents.json?{q}", timeout=40))
    out = []
    for r in d.get("results", []):
        blob = f"{r.get('title', '')} {r.get('abstract') or ''}"
        if not RELEVANT.search(blob):
            continue  # skip documents that only list Palau among many jurisdictions
        out.append({"title": r.get("title"), "type": r.get("type"), "date": r.get("publication_date"),
                    "url": r.get("html_url"), "abstract": (r.get("abstract") or "")[:600],
                    "agencies": [a.get("name") for a in r.get("agencies") or [] if a.get("name")]})
    return out[:40]


# ---------------------------------------------------------------- USAspending
def spending_by_year(extra_filters=None, start_fy=2008):
    fy = fiscal_year()
    f = {"place_of_performance_locations": PALAU,
         "time_period": [{"start_date": f"{start_fy - 1}-10-01", "end_date": f"{fy}-09-30"}], **(extra_filters or {})}
    d = post_json(f"{USA}/search/spending_over_time/", {"group": "fiscal_year", "filters": f})
    rows = []
    for r in d.get("results", []):
        rows.append({"fy": int(r["time_period"]["fiscal_year"]), "total": round(r.get("aggregated_amount") or 0),
                     "grants": round(r.get("Grant_Obligations") or 0), "contracts": round((r.get("Contract_Obligations") or 0) + (r.get("Idv_Obligations") or 0)),
                     "direct": round(r.get("Direct_Obligations") or 0), "loans": round(r.get("Loan_Obligations") or 0),
                     "other": round(r.get("Other_Obligations") or 0)})
    return sorted(rows, key=lambda r: r["fy"])


def spending_by_agency(years=3):
    fy = fiscal_year()
    f = {"place_of_performance_locations": PALAU,
         "time_period": [{"start_date": f"{fy - years}-10-01", "end_date": f"{fy}-09-30"}]}
    d = post_json(f"{USA}/search/spending_by_category/awarding_agency/", {"filters": f, "limit": 12, "page": 1})
    return [{"agency": r.get("name"), "amount": round(r.get("amount") or 0)} for r in d.get("results", [])]


def top_awards(award_types, years=3, limit=15, agency=None, sort="Award Amount"):
    fy = fiscal_year()
    f = {"place_of_performance_locations": PALAU, "award_type_codes": award_types,
         "time_period": [{"start_date": f"{fy - years}-10-01", "end_date": f"{fy}-09-30"}]}
    if agency:
        f["agencies"] = [{"type": "awarding", "tier": "toptier", "name": agency}]
    is_contract = award_types[0] in ("A", "B", "C", "D")
    fields = ["Award ID", "Recipient Name", "Award Amount", "Description", "Awarding Agency", "Awarding Sub Agency",
              "Start Date", "End Date", "generated_internal_id"]
    if not is_contract:
        fields.append("CFDA Number")
    d = post_json(f"{USA}/search/spending_by_award/", {"filters": f, "fields": fields, "sort": sort, "order": "desc",
                                                         "limit": limit, "page": 1})
    out = []
    for r in d.get("results", []):
        out.append({"id": r.get("Award ID"), "recipient": r.get("Recipient Name"), "amount": round(r.get("Award Amount") or 0),
                    "description": (r.get("Description") or "")[:300], "agency": r.get("Awarding Agency"),
                    "sub_agency": r.get("Awarding Sub Agency"), "start": r.get("Start Date"), "end": r.get("End Date"),
                    "cfda": r.get("CFDA Number"),
                    "url": f"https://www.usaspending.gov/award/{r.get('generated_internal_id')}" if r.get("generated_internal_id") else None})
    return out


GRANTS = ["02", "03", "04", "05"]
CONTRACTS = ["A", "B", "C", "D"]


def run():
    prev = load_prev("policy.json", {}) or {}
    if prev.get("updated") and age_hours(prev["updated"]) < REFRESH_HOURS and not os.environ.get("FORCE"):
        write_json("policy.json", prev)
        return {"ok": True, "message": f"Cached (refreshes every {REFRESH_HOURS:.0f} h)", "count": len(prev.get("bills", []))}
    out, errors = {"updated": iso(), "key": "personal" if KEY != "DEMO_KEY" else "demo"}, []
    for name, fn in (("bills", bills), ("federal_register", federal_register), ("spending_by_year", spending_by_year),
                     ("spending_by_agency", spending_by_agency),
                     ("top_grants", lambda: top_awards(GRANTS)), ("top_contracts", lambda: top_awards(CONTRACTS))):
        try:
            out[name] = fn()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {str(e)[:140]}")
            out[name] = prev.get(name, [])   # keep the last good copy
    out["errors"] = errors
    out["fiscal_year"] = fiscal_year()
    write_json("policy.json", out)
    return {"ok": len(errors) < 4, "count": len(out.get("bills", [])),
            "message": f"{len(out.get('bills', []))} bills, {len(out.get('federal_register', []))} Federal Register items, "
                       f"{len(out.get('spending_by_year', []))} fiscal years of spending"
                       + (f"; {len(errors)} errors ({errors[0]})" if errors else "")
                       + ("; using DEMO_KEY (add DATA_GOV_API_KEY)" if KEY == "DEMO_KEY" else "")}


if __name__ == "__main__":
    print(run(), date.today())
