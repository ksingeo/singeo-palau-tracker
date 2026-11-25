// Panels: ROR airport board, Malakal port calls, king tides & sea level,
// visitor arrivals, US policy & funding, US military activity, vessel watch list.
import { barChart, empty, hbarChart, lineChart } from "./charts.js";
import { WATCHLIST_DEFAULTS } from "./config.js";
import * as M from "./map.js";
import { ago, clear, cssVar, fetchJSON, fmt, h, palauTime, pill, setTip, store, tt, when } from "./util.js";

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const money = (v) => (v == null ? "–" : Math.abs(v) >= 1e9 ? `$${fmt(v / 1e9, 2)}B` : Math.abs(v) >= 1e6 ? `$${fmt(v / 1e6, 1)}M` : Math.abs(v) >= 1e3 ? `$${fmt(v / 1e3, 0)}K` : `$${fmt(v)}`);
export { money };

function tabs(containerId, names, onPick, active) {
  const box = clear($(containerId));
  names.forEach(([key, label]) => box.append(h("button", { class: `tab ${key === active ? "active" : ""}`, role: "tab", onclick: () => onPick(key) }, label)));
}
function row({ icon, title, meta, right, tip, onclick, href }) {
  const el = h(href ? "a" : "div", { class: "row", tabindex: 0, onclick, href, target: href ? "_blank" : null, rel: href ? "noopener" : null },
    h("span", { class: "ico" }, icon || ""), h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, title), meta ? h("div", { class: "meta" }, meta) : null),
    h("div", { class: "right" }, right || ""));
  if (tip) setTip(el, tip);
  return el;
}
function setupCard(title, steps, note) {
  return h("div", { class: "setup" }, h("b", null, title), h("ol", null, steps.map((s) => h("li", null, s))), note ? h("p", { class: "note" }, note) : null);
}
const secret = (name) => ["In GitHub: Settings → Secrets and variables → Actions → New secret ", h("code", null, name), "."];

/* ================================================================= airport */
let airportTab = "arrival";
export function renderAirport(state) {
  const ap = state.airport || {}, box = clear($("airportList")), log = state.flights?.log || [];
  tabs("airportTabs", [["arrival", "Arrivals"], ["departure", "Departures"], ["observed", "Seen by ADS-B"]], (k) => { airportTab = k; renderAirport(state); }, airportTab);
  const live = Object.fromEntries((state.flights?.aircraft || []).filter((a) => a.callsign).map((a) => [a.callsign.replace(/\s/g, ""), a]));
  if (airportTab === "observed" || !ap.configured) {
    if (!ap.configured && airportTab !== "observed") {
      box.append(setupCard("Scheduled arrivals and departures need a free AeroDataBox key", [
        ["Sign up at ", h("a", { href: "https://rapidapi.com/aedbx-aedbx/api/aerodatabox", target: "_blank", rel: "noopener" }, "RapidAPI → AeroDataBox"), " and subscribe to the free Basic plan."],
        secret("AERODATABOX_API_KEY"), "The board refreshes every 6 hours (about 240 requests a month)."],
        "Meanwhile the \"Seen by ADS-B\" tab lists flights actually tracked near the airport."));
    }
    const near = log.filter((f) => f.min_dist_nm < 60);
    if (airportTab === "observed" && !near.length) box.append(h("div", { class: "empty" }, "No flights tracked within 60 NM of ROR in the last 24 h. ADS-B coverage at Palau is limited."));
    if (airportTab === "observed") near.forEach((f) => box.append(row({ icon: f.landed_ror ? "🛬" : f.inbound_ror ? "⬇" : "✈", title: f.callsign || f.reg || f.hex, meta: [f.desc || f.type, f.operator].filter(Boolean).join(" · "), right: [`${fmt(f.min_dist_nm)} NM`, h("br"), ago(f.last_seen)], onclick: () => M.focus(`ac:${f.hex}`), tip: tt({ title: f.callsign || f.hex, sub: "Observed by community ADS-B", rows: [["First seen", when(f.first_seen)], ["Last seen", when(f.last_seen)], ["Closest to ROR", `${fmt(f.min_dist_nm)} NM`], ["Landed at ROR", f.landed_ror ? "Yes" : null]] }) })));
    $("airportNote").textContent = ap.configured ? "" : "";
    return;
  }
  const list = (ap.flights || []).filter((f) => f.direction === airportTab);
  if (!list.length) box.append(h("div", { class: "empty" }, `No scheduled ${airportTab === "arrival" ? "arrivals" : "departures"} in this window.`));
  list.forEach((f) => {
    const st = (f.status || "").toLowerCase();
    const lvl = /cancel/.test(st) ? "critical" : /delay/.test(st) ? "warning" : /arrived|departed|landed/.test(st) ? "good" : "neutral";
    const t = f.revised || f.scheduled, a = live[(f.callsign || "").replace(/\s/g, "")];
    box.append(row({
      icon: airportTab === "arrival" ? "🛬" : "🛫",
      title: `${f.number || f.callsign || "?"} ${airportTab === "arrival" ? "from" : "to"} ${f.other_iata || f.other_airport || "?"}`,
      meta: [f.airline, f.aircraft, f.cargo ? "cargo" : null].filter(Boolean).join(" · "),
      right: [palauTime(t, { month: undefined, day: undefined }), h("br"), pill(lvl, f.status || "Scheduled")],
      onclick: a ? () => M.focus(`ac:${a.hex}`) : null,
      tip: tt({ title: `${f.number} · ${f.airline || ""}`, sub: `${airportTab === "arrival" ? "From" : "To"} ${f.other_airport || ""} (${f.other_iata || f.other_icao || "?"})`, rows: [
        ["Status", f.status], ["Scheduled", f.scheduled ? `${palauTime(f.scheduled)} Palau` : null], ["Revised", f.revised ? `${palauTime(f.revised)} Palau` : null],
        ["Runway time", f.runway_time ? `${palauTime(f.runway_time)} Palau` : null], [airportTab === "arrival" ? "Departed origin" : "Arrives", f.other_scheduled ? `${palauTime(f.other_scheduled)} Palau (scheduled)` : null],
        ["Aircraft", [f.aircraft, f.reg].filter(Boolean).join(" · ") || null], ["Terminal / gate", [f.terminal, f.gate].filter(Boolean).join(" / ") || null],
        ["Live position", a ? `${fmt(a.dist_ror_nm)} NM from ROR, ${a.on_ground ? "on ground" : `${fmt(a.alt_ft)} ft`}` : null]], foot: "AeroDataBox schedule. Click to show the aircraft on the map if ADS-B sees it." }),
    }));
  });
  $("airportNote").textContent = `Schedule from AeroDataBox, updated ${ago(ap.updated)}. Times are Palau time.`;
}

/* ================================================================= port */
let portTab = "in";
export function renderPort(state) {
  const p = state.port, box = clear($("portList"));
  tabs("portTabs", [["in", `In port (${p?.in_port?.length ?? 0})`], ["expected", `Expected (${p?.expected?.length ?? 0})`], ["calls", "Port calls (45 d)"]], (k) => { portTab = k; renderPort(state); }, portTab);
  if (!p) {
    box.append(setupCard("Port activity is worked out from ship AIS data", [["Add the free ", h("code", null, "AISSTREAM_API_KEY"), " secret (see the Ships panel)."], "Port calls then build up automatically: ships within 4 NM of Malakal Harbor count as in port."]));
    return;
  }
  const callTip = (c) => tt({ title: c.name || c.mmsi, sub: [c.type_label || c.category, c.flag].filter(Boolean).join(" · "), rows: [
    ["Arrived", c.arrived ? when(c.arrived) : null], ["Departed", c.departed ? when(c.departed) : "Still in port"], ["Time in port", c.hours_in_port != null ? `${fmt(c.hours_in_port, 1)} h` : null],
    ["Status", c.nav_status], ["Next destination", c.next_destination || c.destination], ["Length", c.length_m ? `${fmt(c.length_m)} m` : null], ["Draught", c.draught_m ? `${fmt(c.draught_m, 1)} m` : null],
    ["IMO", c.imo], ["MMSI", c.mmsi]], foot: `Port zone: ${p.radius_nm} NM around Malakal Harbor. AIS class A ships only.` });
  if (portTab === "in") {
    if (!p.in_port.length) box.append(h("div", { class: "empty" }, "No commercial ships reporting from Malakal right now."));
    p.in_port.forEach((c) => box.append(row({ icon: "⚓", title: c.name || c.mmsi, meta: [c.type_label || c.category, c.flag].filter(Boolean).join(" · "), right: [`${fmt(c.hours_in_port, 0)} h in port`, h("br"), `since ${palauTime(c.arrived)}`], onclick: () => M.focus(`ship:${c.mmsi}`, 11), tip: callTip(c) })));
  } else if (portTab === "expected") {
    if (!p.expected.length) box.append(h("div", { class: "empty" }, "No ships currently report Palau / Koror / Malakal as their AIS destination."));
    p.expected.forEach((e) => box.append(row({ icon: "⏩", title: e.name || e.mmsi, meta: [e.type_label || e.category, e.flag, `dest "${e.destination}"`].filter(Boolean).join(" · "),
      right: [`${fmt(e.dist_nm)} NM`, h("br"), e.hours_away_est != null ? `~${fmt(e.hours_away_est, 0)} h away` : e.eta ? `ETA ${e.eta}` : ""],
      onclick: () => M.focus(`ship:${e.mmsi}`),
      tip: tt({ title: e.name || e.mmsi, sub: "Heading for Palau (from its AIS destination)", rows: [["Destination", e.destination], ["Reported ETA", e.eta], ["Distance to Malakal", `${fmt(e.dist_nm)} NM`], ["Speed", e.sog != null ? `${fmt(e.sog, 1)} kn` : null], ["Estimate at current speed", e.hours_away_est != null ? `${fmt(e.hours_away_est, 1)} h` : null], ["Type", e.type_label || e.category], ["Flag", e.flag], ["Last report", when(e.last_pos)]], foot: "Crews type the AIS destination by hand, so it can be stale or misspelt." }) })));
  } else {
    if (!p.calls.length) box.append(h("div", { class: "empty" }, "No port calls logged yet. The log builds up as the scheduled job runs."));
    p.calls.forEach((c) => box.append(row({ icon: c.departed ? "↗" : "⚓", title: c.name || c.mmsi, meta: [c.type_label || c.category, c.flag].filter(Boolean).join(" · "), right: [palauTime(c.arrived, { hour: undefined, minute: undefined }), h("br"), c.departed ? `${fmt(c.hours_in_port, 0)} h` : "in port"], tip: callTip(c) })));
  }
  $("portNote").textContent = `Derived from AIS, updated ${ago(p.updated)}. ${p.calls.length} calls logged in 45 days.`;
}

/* ================================================================= king tides */
export function renderSeaLevel(state) {
  const s = state.sealevel, box = clear($("kingTideList"));
  if (!s?.king_tides) { box.append(h("div", { class: "empty" }, "Tide predictions not available yet.")); empty($("chartResidual"), "Sea level vs. tide prediction", "No data yet"); return; }
  const k = s.king_tides;
  $("sealevelMeta").textContent = `NOAA predictions · ${s.station.split(" (")[0]}`;
  const up = k.upcoming.filter((u) => new Date(u.time) > Date.now() - 6 * 3600000);
  const lab = { king: ["serious", "King tide"], very_high: ["warning", "Very high"], very_low: ["neutral", "Very low"] };
  box.append(h("div", { class: "coral-status" },
    h("div", { class: "wx-stat", tip: tt({ title: "King-tide threshold", text: `High tides above ${fmt(k.p98_m, 2)} m (top 2% of all high tides, past and next 12 months) count as king tides; above ${fmt(k.p95_m, 2)} m (top 5%) as very high.`, rows: [["Average high tide", `${fmt(k.mean_high_m, 2)} m`], ["Highest in next 12 months", `${fmt(k.year_max.height_m, 2)} m on ${palauTime(k.year_max.time)}`]], foot: "Heights above Mean Lower Low Water (MLLW), Malakal Harbor." }) }, h("div", { class: "l" }, "King tide ≥"), h("div", { class: "v" }, fmt(k.p98_m, 2), h("small", null, " m"))),
    h("div", { class: "wx-stat", tip: tt({ text: "Number of king or very high tides predicted in the next 30 days." }) }, h("div", { class: "l" }, "High tides, 30 d"), h("div", { class: "v" }, fmt(up.filter((u) => u.level !== "very_low" && new Date(u.time) < Date.now() + 30 * DAY).length)))));
  if (!up.length) box.append(h("div", { class: "empty" }, "No king or very high tides predicted in the next 6 months."));
  up.slice(0, 14).forEach((u) => {
    const [lvl, name] = lab[u.level];
    box.append(row({ icon: u.level === "very_low" ? "⬇" : "🌊", title: `${name} · ${fmt(u.height_m, 2)} m`, meta: palauTime(u.time, { weekday: "short" }) + " Palau", right: pill(lvl, ago(u.time)),
      tip: tt({ title: `${name}: ${fmt(u.height_m, 2)} m above MLLW`, sub: `${palauTime(u.time, { weekday: "long" })} Palau`, rows: [["vs. average high tide", `${u.height_m - k.mean_high_m > 0 ? "+" : ""}${fmt((u.height_m - k.mean_high_m) * 100)} cm`]],
        text: u.level === "very_low" ? "Extreme low tide: exposed reef flats, shallow channels may be hard to navigate." : "Higher than usual water: possible coastal flooding in low-lying areas, especially with strong winds, swell or rain.", foot: "Astronomical prediction only; weather can add tens of centimetres." }) }));
  });
  const o = s.observed;
  if (o?.daily_residual_cm?.length) {
    lineChart($("chartResidual"), { title: "Sea level vs. tide prediction (daily, cm)", sub: `UH Sea Level Center, Malakal. Data to ${palauTime(o.last_obs, { hour: undefined, minute: undefined })}: these observations arrive ~1–2 months late`,
      x: o.daily_residual_cm.map((d) => new Date(`${d[0]}T12:00:00Z`)), height: 130, series: [{ name: "Observed minus predicted", values: o.daily_residual_cm.map((d) => d[1]), color: "--s1", area: true }],
      yFmt: (v) => `${v > 0 ? "+" : ""}${fmt(v)}`, tipTitle: (i) => o.daily_residual_cm[i][0],
      tipExtra: () => h("div", { class: "tt-foot" }, "Positive = sea higher than the tide tables predict (e.g. La Niña, storms, seasonal swell).") });
  } else empty($("chartResidual"), "Sea level vs. tide prediction", "Observations unavailable");
}
export function nextKingTide(state) {
  return (state.sealevel?.king_tides?.upcoming || []).find((u) => u.level === "king" && new Date(u.time) > Date.now() - 3 * 3600000);
}

/* ================================================================= tourism */
export function renderTourism(state) {
  const t = state.tourism, body = clear($("tourismBody"));
  if (!t?.months?.length) { body.append(h("div", { class: "empty" }, "Visitor arrival reports not loaded yet.")); return; }
  // continuous month axis: gaps (months PVA only published as images) stay visible as empty slots
  const have = Object.fromEntries(t.months.map((m) => [m.month, m]));
  const ms = [];
  for (let [y, mo] = t.months[0].month.split("-").map(Number); ; mo === 12 ? (y++, mo = 1) : mo++) {
    const k = `${y}-${String(mo).padStart(2, "0")}`;
    ms.push(have[k] || { month: k, total: null, missing: true });
    if (k === t.months[t.months.length - 1].month) break;
  }
  const last = [...t.months].reverse().find((m) => !m.derived_from) || t.months[t.months.length - 1];
  const mname = (k) => new Date(`${k}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  $("tourismMeta").textContent = `Palau Visitors Authority · latest ${mname(last.month)}`;
  const tile = (l, v, tip) => h("div", { class: "wx-stat", tip: tt(tip) }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
  body.append(h("div", { class: "coral-status" },
    tile(`Visitors, ${mname(last.month).split(" ")[0]}`, fmt(last.total), { title: `${mname(last.month)}: ${fmt(last.total)} visitors`, text: last.summary, foot: "Palau Visitors Authority monthly report (Division of Immigration data)" }),
    tile("vs. a year ago", last.yoy_pct != null ? [last.yoy_pct > 0 ? "+" : "", fmt(last.yoy_pct), h("small", null, " %")] : "–", { title: "Year-on-year change", rows: [["Change", last.yoy_change != null ? `${last.yoy_change > 0 ? "+" : ""}${fmt(last.yoy_change)} visitors` : null]] }),
    tile("Year to date", last.ytd ? fmt(last.ytd) : "–", { title: `January–${mname(last.month).split(" ")[0]} total`, text: "Cumulative visitor arrivals this calendar year, as stated in the report." }),
    tile("Top market", last.markets ? Object.entries(last.markets).sort((a, b) => b[1] - a[1])[0][0] : "–", { title: "Largest source market this month", rows: Object.entries(last.markets || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${fmt(v)} (${fmt((v / last.total) * 100)}%)`]) }),
  ));
  const grid = h("div", { class: "gfw-grid" }), c1 = h("div", { class: "chart" }), c2 = h("div", { class: "chart" });
  grid.append(c1, c2); body.append(grid);
  barChart(c1, { title: "Visitor arrivals by month", height: 160, labels: ms.map((m) => new Date(`${m.month}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })),
    values: ms.map((m) => m.total), color: (i) => (ms[i].derived_from ? "--seq-2" : "--s3"), yFmt: (v) => fmt(v),
    tip: (i) => ms[i].missing ? tt({ title: mname(ms[i].month), text: "No machine-readable figure: PVA's report for this month is an image." }) : tt({ title: `${mname(ms[i].month)}: ${fmt(ms[i].total)} visitors`, rows: [["Year on year", ms[i].yoy_pct != null ? `${ms[i].yoy_pct > 0 ? "+" : ""}${ms[i].yoy_pct}%` : null], ["Year to date", ms[i].ytd ? fmt(ms[i].ytd) : null]], text: ms[i].derived_from ? `Taken from figures quoted in the ${ms[i].derived_from.replace("Palau ", "")} (the original report is an image).` : null, foot: "Lighter bars: values quoted in later reports." }) });
  const mk = Object.entries(last.markets || {}).sort((a, b) => b[1] - a[1]);
  hbarChart(c2, { title: `Arrivals by market, ${mname(last.month)}`, color: "--s3", fmt: (v) => fmt(v), emptyMsg: "Market split not available for this month",
    rows: mk.map(([k, v]) => ({ label: k, value: v, tip: tt({ title: `${k}: ${fmt(v)} visitors`, rows: [["Share", `${fmt((v / last.total) * 100, 1)}%`]] }) })) });
  body.append(h("p", { class: "note" }, "Source: ", h("a", { href: last.pdf || last.link, target: "_blank", rel: "noopener" }, "PVA monthly report ↗"), ". The chart grows as PVA publishes each month; older reports are images and can't be read automatically."));
}

/* ================================================================= policy */
let policyTab = "bills";
export function renderPolicy(state) {
  const p = state.policy, body = clear($("policyBody"));
  tabs("policyTabs", [["bills", "Congress"], ["fr", "Federal Register"], ["funding", "Federal funding"]], (k) => { policyTab = k; renderPolicy(state); }, policyTab);
  if (!p) { body.append(h("div", { class: "empty" }, "Not loaded yet.")); return; }
  $("policyMeta").textContent = `updated ${ago(p.updated)}${p.key === "demo" ? " · demo key" : ""}`;
  if (policyTab === "bills") {
    const list = h("div", { class: "list", style: { maxHeight: "420px" } });
    (p.bills || []).forEach((b) => list.append(row({ href: b.url, icon: "📜", title: `${b.label} · ${b.title}`, meta: b.latest_action ? `${b.latest_action_date}: ${b.latest_action}` : `${b.version} · ${b.congress}th Congress`, right: b.date,
      tip: tt({ title: `${b.label}: ${b.title}`, sub: `${b.congress}th Congress · ${b.chamber}`, rows: [["Latest text", `${b.version} (${b.date})`], ["Sponsor", b.sponsor], ["Introduced", b.introduced], ["Cosponsors", b.cosponsors], ["Policy area", b.policy_area], ["Latest action", b.latest_action ? `${b.latest_action_date}: ${b.latest_action}` : null]], foot: "Click to open on Congress.gov. Status detail needs the DATA_GOV_API_KEY secret." }) })));
    if (!(p.bills || []).length) list.append(h("div", { class: "empty" }, "No bills found."));
    body.append(list);
    if (p.key === "demo") body.append(h("p", { class: "note" }, "Add a free ", h("a", { href: "https://api.data.gov/signup/", target: "_blank", rel: "noopener" }, "api.data.gov key"), " as the DATA_GOV_API_KEY secret for reliable updates and each bill's latest action."));
  } else if (policyTab === "fr") {
    const list = h("div", { class: "list", style: { maxHeight: "420px" } });
    (p.federal_register || []).forEach((r) => list.append(row({ href: r.url, icon: "🏛", title: r.title, meta: `${r.type} · ${(r.agencies || []).slice(0, 2).join(", ")}`, right: r.date, tip: tt({ title: r.title, sub: `${r.type} · ${r.date}`, text: r.abstract || null, rows: [["Agencies", (r.agencies || []).join(", ")]], foot: "Federal Register. Click to read." }) })));
    if (!(p.federal_register || []).length) list.append(h("div", { class: "empty" }, "No recent Palau-specific notices."));
    body.append(list);
  } else {
    const yrs = p.spending_by_year || [], grid = h("div", { class: "gfw-grid" }), c1 = h("div", { class: "chart" }), c2 = h("div", { class: "chart" });
    grid.append(c1, c2); body.append(grid);
    barChart(c1, { title: "Federal obligations in Palau by fiscal year", sub: "All agencies, place of performance Palau", height: 170, labels: yrs.map((r) => `FY${String(r.fy).slice(2)}`), values: yrs.map((r) => r.total), color: (i) => (yrs[i].fy === p.fiscal_year ? "--seq-2" : "--s1"), yFmt: money,
      tip: (i) => tt({ title: `FY${yrs[i].fy}: ${money(yrs[i].total)}`, rows: [["Grants", money(yrs[i].grants)], ["Contracts", money(yrs[i].contracts)], ["Direct payments", money(yrs[i].direct)], ["Loans", money(yrs[i].loans)], ["Other", money(yrs[i].other)]], foot: yrs[i].fy === p.fiscal_year ? "Fiscal year in progress (lighter bar)." : "USAspending.gov obligations (Oct–Sep)." }) });
    hbarChart(c2, { title: "By agency, last 3 fiscal years", fmt: money, color: "--s1", rows: (p.spending_by_agency || []).slice(0, 8).map((a) => ({ label: a.agency.replace("Department of the ", "").replace("Department of ", ""), value: a.amount, tip: tt({ title: a.agency, rows: [["Obligated", money(a.amount)]], foot: a.agency === "Department of the Interior" ? "Interior's Office of Insular Affairs channels Compact of Free Association economic assistance." : null }) })) });
    body.append(h("div", { class: "sub-head" }, "Largest grants, last 3 fiscal years"));
    const list = h("div", { class: "list compact" });
    (p.top_grants || []).forEach((g) => list.append(row({ href: g.url, icon: "💵", title: `${money(g.amount)} · ${g.sub_agency || g.agency}`, meta: g.description, right: g.start,
      tip: tt({ title: `${money(g.amount)} grant`, sub: [g.agency, g.sub_agency].filter(Boolean).join(" · "), text: g.description, rows: [["Recipient", g.recipient], ["Period", `${g.start || "?"} → ${g.end || "?"}`], ["Assistance listing", g.cfda], ["Award ID", g.id]], foot: "USAspending.gov. Click for the award page." }) })));
    body.append(list);
  }
}

/* ================================================================= military */
let milTab = "news";
export function renderMilitary(state) {
  const m = state.military, body = clear($("militaryBody"));
  tabs("militaryTabs", [["news", "News"], ["recent", "New contracts"], ["top", "Largest contracts"], ["trend", "DoD spending"]], (k) => { milTab = k; renderMilitary(state); }, milTab);
  if (!m) { body.append(h("div", { class: "empty" }, "Not loaded yet.")); return; }
  $("militaryMeta").textContent = `updated ${ago(m.updated)}`;
  const cTip = (c) => tt({ title: `${money(c.amount)} · ${c.recipient}`, sub: [c.agency, c.sub_agency].filter(Boolean).join(" · "), text: c.description, rows: [["Period", `${c.start || "?"} → ${c.end || "?"}`], ["Award ID", c.id]], foot: "Department of Defense contract performed in Palau (USAspending.gov). Click for details." });
  const list = h("div", { class: "list", style: { maxHeight: "430px" } });
  if (milTab === "news") {
    (m.news || []).forEach((n) => list.append(row({ href: n.link, icon: "🎖", title: n.title, meta: n.source, right: ago(n.published), tip: tt({ title: n.title, sub: `${n.source} · ${palauTime(n.published)} Palau`, rows: [["Countries", (n.countries || []).join(", ") || null]], foot: "Filtered for military / defense stories that mention Palau. Click to read." }) })));
    if (!(m.news || []).length) list.append(h("div", { class: "empty" }, "No recent defense stories."));
  } else if (milTab === "recent" || milTab === "top") {
    (milTab === "recent" ? m.contracts_recent : m.contracts_top || []).forEach((c) => list.append(row({ href: c.url, icon: "🏗", title: `${money(c.amount)} · ${c.recipient}`, meta: `${(c.sub_agency || "").replace("Department of the ", "")} · ${c.description}`, right: c.start, tip: cTip(c) })));
  } else {
    const yrs = m.dod_by_year || [], c = h("div", { class: "chart" });
    body.append(c);
    barChart(c, { title: "Defense obligations in Palau by fiscal year", height: 190, labels: yrs.map((r) => `FY${String(r.fy).slice(2)}`), values: yrs.map((r) => r.total), color: "--s8", yFmt: money,
      tip: (i) => tt({ title: `FY${yrs[i].fy}: ${money(yrs[i].total)}`, rows: [["Contracts", money(yrs[i].contracts)], ["Grants", money(yrs[i].grants)]], foot: "Department of Defense, place of performance Palau (USAspending.gov)." }) });
    return;
  }
  body.append(list);
}

/* ================================================================= vessel watch list */
let fileWatch = [];
export async function loadWatchFile() {
  try { fileWatch = (await fetchJSON("assets/watchlist.json", { bust: true })).vessels || []; } catch { fileWatch = []; }
}
export function watchEntries() { return [...WATCHLIST_DEFAULTS, ...fileWatch, ...store.get("pt-watch", [])]; }
export function matchWatch(s) {
  const out = [];
  for (const w of watchEntries()) {
    const v = String(w.value || "").trim();
    if (!v) continue;
    const hit = /^\d{9}$/.test(v) ? s.mmsi === v || String(s.imo || "") === v : (s.name || "").toUpperCase().includes(v.toUpperCase());
    if (hit) out.push(`On your watch list${w.note ? `: ${w.note}` : ""}`);
  }
  return out;
}
export function openWatchDialog(onChange) {
  const dlg = $("watchDialog");
  const draw = () => {
    clear(dlg);
    const mine = store.get("pt-watch", []);
    dlg.append(h("h3", null, "Vessel watch list"), h("p", { class: "note" }, "Flag ships by MMSI (9 digits), IMO number or part of the name. Flagged ships get a gold ring on the map and appear in the Watch tab and alerts. Entries here are saved in this browser; to share a list across devices, edit assets/watchlist.json in the repo."));
    [...WATCHLIST_DEFAULTS, ...fileWatch].forEach((w) => dlg.append(h("div", { class: "fb-row" }, h("span", null, `${w.value}${w.note ? ` · ${w.note}` : ""}`), h("span", { class: "muted", style: { flex: "none" } }, "from repo"))));
    mine.forEach((w, i) => dlg.append(h("div", { class: "fb-row" }, h("span", null, `${w.value}${w.note ? ` · ${w.note}` : ""}`),
      h("button", { class: "btn sm", onclick: () => { store.set("pt-watch", mine.filter((_, k) => k !== i)); draw(); onChange(); } }, "Remove"))));
    const v = h("input", { type: "text", placeholder: "MMSI, IMO or name, e.g. XIANG YANG HONG", "aria-label": "Vessel" });
    const n = h("input", { type: "text", placeholder: "Note (optional)", "aria-label": "Note" });
    dlg.append(h("form", { onsubmit: (e) => { e.preventDefault(); const val = v.value.trim(); if (val.length < 3) { v.setCustomValidity("Enter at least 3 characters"); v.reportValidity(); return; } store.set("pt-watch", [...mine, { value: val, note: n.value.trim() }]); draw(); onChange(); } }, v, n, h("button", { class: "btn", type: "submit" }, "Add")));
    dlg.append(h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: "12px" } }, h("button", { class: "btn", onclick: () => dlg.close() }, "Done")));
  };
  draw(); dlg.showModal();
}
export function missingWatched(ships) {
  return watchEntries().filter((w) => !ships.some((s) => matchWatch(s).length && (/^\d{9}$/.test(w.value) ? s.mmsi === w.value || String(s.imo) === w.value : (s.name || "").toUpperCase().includes(String(w.value).toUpperCase()))));
}
export { cssVar };
