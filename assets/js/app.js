// Palau Tracker: wires data sources to the map, KPI tiles, lists and charts.
import { EMBEDS, FACEBOOK_PAGES, MAP, QUAKES, STALE_MINUTES, WEATHER } from "./config.js";
import { barChart, empty, hbarChart, lineChart, scatterChart } from "./charts.js";
import * as M from "./map.js";
import * as P from "./panels2.js";
import { aircraftTip, gfwEventTip, gfwLabel, quakeTip, SHIP_CATEGORIES, shipTip, shipVar } from "./tips.js";
import {
  ago, clear, compass, cssVar, fetchJSON, fmt, h, haversineKm, initTooltips, kmToNm, palauTime, pill,
  registerTip, ROR, setTip, store, tt, utcTime, when,
} from "./util.js";

const $ = (id) => document.getElementById(id);
const state = { client: {} };
const DAY = 86400000;

/* ================================================================= boot */
async function boot() {
  initTooltips();
  setupHeader();
  setupTabs();
  M.initMap();
  try { await M.loadBoundaries(); } catch (e) { console.warn("boundaries", e); }
  setupLegend();
  setupFacebook();
  setupEmbeds();
  $("fitEez").addEventListener("click", M.fitEez);
  $("refreshBtn").addEventListener("click", () => { loadServer(); loadClient(); });
  ["shipSearch", "shipFilter"].forEach((id) => $(id).addEventListener("input", renderShips));
  $("flightFilter").addEventListener("input", renderFlights);
  ["newsSearch", "newsRange", "newsSource", "newsPalauOnly"].forEach((id) => $(id).addEventListener("input", renderNews));
  $("quakeMin").addEventListener("input", renderQuakes);
  $("liveFlights").addEventListener("change", toggleLiveFlights);
  const onWatchChange = () => { applyWatch(); renderShips(); renderKpis(); renderAlerts(); };
  ["watchEdit", "watchEdit2"].forEach((id) => $(id).addEventListener("click", () => P.openWatchDialog(onWatchChange)));
  await P.loadWatchFile();
  await Promise.allSettled([loadServer(), loadClient()]);
  setInterval(loadServer, 5 * 60000);
  setInterval(loadClient, 15 * 60000);
  setInterval(renderFreshness, 60000);
}

/* ================================================================= header */
function setupHeader() {
  const tick = () => {
    $("clock").querySelector(".clock-time").textContent = new Date().toLocaleTimeString("en-US", { timeZone: "Pacific/Palau", hour: "2-digit", minute: "2-digit", hour12: false });
  };
  tick(); setInterval(tick, 15000);
  registerTip("clock", () => {
    const now = new Date();
    return tt({ title: "Palau time (UTC+9, no daylight saving)", rows: [
      ["Palau", now.toLocaleString("en-US", { timeZone: "Pacific/Palau", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })],
      ["UTC", utcTime(now)],
      ["Your time", now.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" })],
    ], foot: "All times on this dashboard are Palau time unless marked UTC." });
  });
  registerTip("freshness", () => {
    const st = state.status;
    if (!st) return tt({ title: "Data freshness", text: "Waiting for data…" });
    return tt({ title: "Server data", sub: `Collected ${when(st.updated)}`,
      rows: Object.values(st.sources || {}).map((x) => [x.label, x.ok ? "OK" : x.configured === false ? "Not set up" : "Error"]),
      foot: "A GitHub Action refreshes server data about every 20 minutes. Weather, tides and earthquakes load live in your browser." });
  });
  $("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pt-theme", next); } catch { /* private mode */ }
    location.reload();
  });
}

function setupTabs() {
  document.querySelectorAll("#sideTabs .tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll("#sideTabs .tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".side-card .tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
  }));
}

function setupLegend() {
  const el = $("mapLegend");
  const sw = (v) => h("span", { class: "sw", style: { background: cssVar(v) } });
  SHIP_CATEGORIES.forEach((c) => el.append(h("span", { class: "key", tip: tt({ title: `${c} vessels`, text: c === "Government & military" ? "Drawn as diamonds: military, law enforcement, search and rescue, medical and other state vessels." : "Arrow = under way (points along the course), dot = stopped. Faded = no report in the last hour. Gold ring = flagged on the watch list." }) }, sw(shipVar(c)), c)));
  el.append(h("span", { class: "key", tip: tt({ title: "Aircraft", text: "Plane icons point along the aircraft's track. Red = military (ADS-B database flag). Faded = outside 250 NM of Palau." }) }, "✈ Aircraft"));
  el.append(h("span", { class: "key", tip: tt({ title: "Earthquake depth", text: "Orange: shallow (< 70 km), gold: intermediate (70–300 km), blue: deep (> 300 km). Size grows with magnitude." }) }, sw("--s2"), sw("--s4"), sw("--s1"), "Quakes by depth"));
  el.append(h("span", { class: "key", tip: tt({ title: "Boundaries", text: "Solid blue: EEZ (200 NM). Dashed blue: 12 NM territorial sea. Dashed orange: provisional median lines with the Philippines and Indonesia (not settled). Green: treaty boundary with FSM." }) }, h("span", { class: "ln", style: { borderColor: cssVar("--accent") } }), "EEZ", h("span", { class: "ln dash", style: { borderColor: cssVar("--s2") } }), "Unsettled boundary"));
}

/* ================================================================= loading */
async function loadServer() {
  const files = ["status", "ships", "flights", "news", "hazards", "ocean", "gfw", "history", "port", "airport", "sealevel", "tourism", "policy", "military"];
  const res = await Promise.allSettled(files.map((f) => fetchJSON(`data/${f}.json`, { bust: true })));
  res.forEach((r, i) => { if (r.status === "fulfilled") state[files[i]] = r.value; else console.warn(files[i], r.reason); });
  if (state.liveAircraft && $("liveFlights").checked) state.flights = { ...state.flights, aircraft: state.liveAircraft };
  state.shipsRaw = state.ships ? JSON.parse(JSON.stringify(state.ships.ships || [])) : [];
  applyWatch();
  renderAllServer();
}
/** Add the viewer's watch-list matches to each ship's watch reasons. */
function applyWatch() {
  if (!state.ships) return;
  state.ships.ships = (state.shipsRaw || []).map((sh) => {
    const extra = P.matchWatch(sh);
    return extra.length ? { ...sh, watch: [...extra, ...(sh.watch || [])], user_watch: true } : sh;
  });
}
const panelFns = [() => P.renderAirport(state), () => P.renderPort(state), () => P.renderSeaLevel(state), () => P.renderTourism(state), () => P.renderPolicy(state), () => P.renderMilitary(state)];
function renderAllServer() {
  for (const fn of [renderFreshness, renderShips, renderFlights, renderNews, renderHazards, renderOcean, renderGfw, renderTrends, ...panelFns, renderStatus, renderKpis, renderAlerts]) {
    try { fn(); } catch (e) { console.error(fn.name, e); }
  }
}
async function loadClient() {
  await Promise.allSettled([loadWeather(), loadQuakes(), loadTides()]);
  for (const fn of [renderWeather, renderQuakes, renderOcean, renderStatus, renderKpis, renderAlerts]) {
    try { fn(); } catch (e) { console.error(fn.name, e); }
  }
}
function clientStatus(key, label, ok, message) { state.client[key] = { label, ok, message, checked: new Date().toISOString() }; }

function renderFreshness() {
  const el = $("freshness"), st = state.status;
  if (!st) { el.textContent = "No server data yet"; return; }
  const mins = (Date.now() - new Date(st.updated)) / 60000;
  clear(el).append(mins > STALE_MINUTES ? pill("warning", `Data ${ago(st.updated)}`) : document.createTextNode(`Updated ${ago(st.updated)}`));
}

/* ================================================================= ships */
function shipsFresh() { return (state.ships?.ships || []).filter((s) => s.age_h < 6); }
function renderShips() {
  const data = state.ships || {};
  const all = data.ships || [];
  M.setShips(all);
  const q = $("shipSearch").value.trim().toLowerCase(), f = $("shipFilter").value;
  let list = all.filter((s) => {
    if (f === "eez" && !s.in_eez) return false;
    if (f === "fishing" && s.category !== "Fishing") return false;
    if (f === "gov" && s.category !== "Government & military") return false;
    if (f === "watch" && !(s.watch && s.watch.length)) return false;
    if (f === "port" && !(state.port?.in_port || []).some((c) => c.mmsi === s.mmsi)) return false;
    if (q && ![s.name, s.mmsi, s.flag, s.callsign, s.destination, s.type_label].some((x) => x && String(x).toLowerCase().includes(q))) return false;
    return true;
  });
  $("shipsBadge").textContent = shipsFresh().filter((s) => s.in_eez).length;
  const box = clear($("shipList"));
  if (!data.configured && !all.length) {
    box.append(h("div", { class: "setup" },
      h("b", null, "Ship tracking needs a free aisstream.io key"),
      h("ol", null,
        h("li", null, "Sign up at ", h("a", { href: "https://aisstream.io/authenticate", target: "_blank", rel: "noopener" }, "aisstream.io"), " (free) and create an API key."),
        h("li", null, "In GitHub: repo Settings → Secrets and variables → Actions → New secret ", h("code", null, "AISSTREAM_API_KEY"), "."),
        h("li", null, "Run the \"Update data & deploy\" workflow, or wait for the next scheduled run.")),
      h("p", { class: "note" }, "Until then, use the VesselFinder / MarineTraffic backup maps below.")));
  } else if (!list.length) {
    box.append(h("div", { class: "empty" }, h("b", null, "No ships match. "), f === "eez" ? "No AIS reports from inside the EEZ in the last 24 h. Try \"All in area\" or the backup maps." : "Try another filter."));
  }
  list.slice(0, 300).forEach((s) => {
    const c = cssVar(shipVar(s.category));
    const row = h("div", { class: "row", tabindex: 0, onclick: () => M.focus(`ship:${s.mmsi}`) },
      h("span", { class: "ico" }, h("span", { style: { width: "10px", height: "10px", borderRadius: s.category === "Government & military" ? "2px" : "50%", background: c, display: "inline-block", outline: s.watch?.length ? `2px solid ${cssVar("--warning")}` : null, outlineOffset: "2px", opacity: s.age_h > 1 ? 0.5 : 1 } })),
      h("div", { style: { minWidth: 0 } },
        h("div", { class: "title" }, s.name || `MMSI ${s.mmsi}`, s.watch?.length ? " ⚠" : ""),
        h("div", { class: "meta" }, [s.type_label || s.category, s.flag, s.sog != null ? `${fmt(s.sog, 1)} kn` : null, s.destination ? `→ ${s.destination}` : null].filter(Boolean).join(" · "))),
      h("div", { class: "right" }, s.dist_koror_nm != null ? `${fmt(s.dist_koror_nm)} NM` : "", h("br"), ago(s.last_pos), " ",
        h("a", { href: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`, target: "_blank", rel: "noopener", tip: tt({ text: "Open this vessel on MarineTraffic" }), onclick: (e) => e.stopPropagation() }, "↗")));
    setTip(row, () => shipTip(s));
    box.append(row);
  });
  const note = $("shipNote");
  note.textContent = data.configured
    ? `AIS snapshot ${data.updated ? ago(data.updated) : "pending"} (${fmt(data.listen_seconds)} s listening, ${fmt(data.messages)} messages). Ships stay listed for ${fmt(data.memory_hours || 24)} h after their last report. Coverage depends on shore receivers, so ships far offshore may not appear: check the backup maps and Global Fishing Watch.`
    : "";
}

/* ================================================================= flights */
function renderFlights() {
  const fl = state.flights || {};
  const ac = fl.aircraft || [];
  M.setAircraft(ac, fl.log || []);
  const mode = $("flightFilter").value;
  const box = clear($("flightList"));
  const near = ac.filter((a) => a.region === "palau");
  $("flightsBadge").textContent = near.length;
  if (mode === "log") {
    const log = fl.log || [];
    if (!log.length) box.append(h("div", { class: "empty" }, h("b", null, "No flights logged in the last 24 h. "), "The log fills in as the scheduled job runs. ADS-B coverage around Palau is thin, so flights are often only caught near the airport."));
    log.forEach((f) => {
      const row = h("div", { class: "row", tabindex: 0, onclick: () => M.focus(`ac:${f.hex}`) },
        h("span", { class: "ico" }, f.landed_ror ? "🛬" : f.inbound_ror ? "⬇" : "✈"),
        h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, f.callsign || f.reg || f.hex), h("div", { class: "meta" }, [f.desc || f.type, f.operator].filter(Boolean).join(" · ") || "Unknown type")),
        h("div", { class: "right" }, `${fmt(f.min_dist_nm)} NM`, h("br"), ago(f.last_seen)));
      setTip(row, () => tt({ title: f.callsign || f.reg || f.hex, sub: [f.desc || f.type, f.operator, f.reg].filter(Boolean).join(" · "), rows: [["First seen", when(f.first_seen)], ["Last seen", when(f.last_seen)], ["Closest to ROR", `${fmt(f.min_dist_nm)} NM`], ["Highest altitude", f.max_alt_ft ? `${fmt(f.max_alt_ft)} ft` : null], ["Landed at ROR", f.landed_ror ? "Yes (seen on the ground near the airport)" : null], ["Heading for ROR", f.inbound_ror ? "Yes, at some point" : null], ["Military", f.military ? "Yes" : null], ["ICAO hex", f.hex]] }));
      box.append(row);
    });
  } else {
    const list = mode === "palau" ? near : ac;
    if (!list.length) box.append(h("div", { class: "empty" }, h("b", null, "No aircraft in range right now. "), "Palau sees a few flights a day (mainly from Guam, Manila, Taipei and Seoul), and ADS-B receiver coverage there is limited. Tick \"Live flights (OpenSky)\" or open the ADS-B backup map below."));
    list.forEach((a) => {
      const row = h("div", { class: "row", tabindex: 0, onclick: () => M.focus(`ac:${a.hex}`) },
        h("span", { class: "ico", style: { color: a.military ? cssVar("--s8") : null } }, a.inbound_ror ? "⬇" : a.on_ground ? "▭" : "✈"),
        h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, a.callsign || a.reg || a.hex, a.military ? " · MIL" : ""),
          h("div", { class: "meta" }, [a.desc || a.type, a.on_ground ? "on ground" : a.alt_ft != null ? `${fmt(a.alt_ft)} ft` : null, a.gs_kt != null ? `${fmt(a.gs_kt)} kn` : null].filter(Boolean).join(" · "))),
        h("div", { class: "right" }, `${fmt(a.dist_ror_nm)} NM`, h("br"),
          h("a", { href: `https://globe.adsb.lol/?icao=${a.hex}`, target: "_blank", rel: "noopener", tip: tt({ text: "Open on the adsb.lol live globe" }), onclick: (e) => e.stopPropagation() }, "↗")));
      setTip(row, () => aircraftTip(a));
      box.append(row);
    });
  }
  $("flightNote").textContent = `${$("liveFlights").checked ? "Live from OpenSky" : `Snapshot ${fl.updated ? ago(fl.updated) : "pending"} from adsb.lol / adsb.fi`}. Distances are from Roman Tmetuchl International Airport (ROR).`;
}

let liveTimer = null;
async function toggleLiveFlights() {
  clearInterval(liveTimer);
  if (!$("liveFlights").checked) { state.liveAircraft = null; loadServer(); return; }
  const run = async () => {
    const b = MAP.openskyBox;
    try {
      const d = await fetchJSON(`https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`, { timeout: 20000 });
      const known = Object.fromEntries((state.flights?.aircraft || []).concat(state.flights?.log || []).map((a) => [a.hex, a]));
      state.liveAircraft = (d.states || []).filter((x) => x[5] != null && x[6] != null).map((x) => {
        const k = known[x[0]] || {}, lat = x[6], lon = x[5];
        const dist = kmToNm(haversineKm([lat, lon], ROR));
        return { hex: x[0], callsign: (x[1] || "").trim() || null, reg: k.reg, type: k.type, desc: k.desc, operator: k.operator,
          lat, lon, on_ground: x[8], alt_ft: x[7] != null ? Math.round(x[7] * 3.28084) : null, gs_kt: x[9] != null ? x[9] * 1.94384 : null,
          track: x[10], vrate_fpm: x[11] != null ? Math.round(x[11] * 196.85) : null, squawk: x[14], military: k.military,
          seen_s: Math.round(Date.now() / 1000 - (x[4] || 0)), dist_ror_nm: Math.round(dist * 10) / 10, region: dist <= 250 ? "palau" : "region",
          in_eez: M.inEez(lat, lon), source: `OpenSky (${x[2] || "?"} registered)`, origin_country: x[2] };
      }).sort((a, b2) => a.dist_ror_nm - b2.dist_ror_nm);
      state.flights = { ...(state.flights || {}), aircraft: state.liveAircraft, updated: new Date().toISOString() };
      clientStatus("opensky", "Live flights (OpenSky)", true, `${state.liveAircraft.length} aircraft in box`);
    } catch (e) {
      clientStatus("opensky", "Live flights (OpenSky)", false, `OpenSky unavailable (${e.message}). Anonymous access is rate-limited; the server snapshot is shown instead.`);
    }
    renderFlights(); renderKpis(); renderStatus(); renderAlerts();
  };
  await run();
  liveTimer = setInterval(() => { if (!document.hidden) run(); }, MAP.openskyRefreshMs);
}

/* ================================================================= news */
let activeTopic = "";
function renderNews() {
  const data = state.news || { items: [] };
  const days = +$("newsRange").value, q = $("newsSearch").value.trim().toLowerCase();
  const src = $("newsSource").value, palauOnly = $("newsPalauOnly").checked;
  const cutoff = Date.now() - days * DAY;
  const sel = $("newsSource");
  if (sel.options.length <= 1) {
    [...new Set(data.items.map((i) => i.source))].sort().forEach((s) => sel.append(h("option", { value: s }, s)));
  }
  const base = data.items.filter((i) => new Date(i.published) >= cutoff && (!palauOnly || i.relevance !== "regional") && (!src || i.source === src)
    && (!q || `${i.title} ${i.summary}`.toLowerCase().includes(q)));
  const counts = {};
  base.forEach((i) => i.topics.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const chips = clear($("newsTopics"));
  chips.append(h("button", { class: `chip ${activeTopic ? "" : "active"}`, onclick: () => { activeTopic = ""; renderNews(); } }, "All", h("span", { class: "n" }, base.length)));
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => chips.append(h("button", { class: `chip ${activeTopic === t ? "active" : ""}`, onclick: () => { activeTopic = activeTopic === t ? "" : t; renderNews(); } }, t, h("span", { class: "n" }, n))));
  const items = base.filter((i) => !activeTopic || i.topics.includes(activeTopic));
  $("newsMeta").textContent = `${items.length} stories · updated ${data.updated ? ago(data.updated) : "–"}`;
  const box = clear($("newsList"));
  if (!items.length) box.append(h("div", { class: "empty" }, "No stories match these filters."));
  items.slice(0, 150).forEach((i) => {
    const card = h("a", { class: `news-item kind-${i.kind}`, href: i.link, target: "_blank", rel: "noopener" },
      h("div", { class: "src" }, h("b", null, i.source), h("span", null, ago(i.published))),
      h("div", { class: "hl" }, i.title),
      h("div", { class: "tags" }, i.topics.map((t) => h("span", { class: "tag" }, t)), i.relevance === "regional" ? h("span", { class: "tag" }, "Regional") : null));
    setTip(card, () => tt({ title: i.title, sub: `${i.source}${i.via !== i.source ? ` via ${i.via}` : ""} · ${palauTime(i.published)} Palau (${ago(i.published)})`,
      text: i.summary || "No summary in the feed. Click to read the full story.",
      rows: [["Topics", i.topics.join(", ")], ["Countries", i.countries.length ? i.countries.join(", ") : null], ["Source type", { local: "Palau newspaper", government: "Palau government", regional: "Regional outlet", search: "News search" }[i.kind]], ["Relevance", { high: "About Palau", medium: "Mentions Palau", regional: "Regional story (no Palau mention)" }[i.relevance] || i.relevance]],
      foot: "Click to open the article." }));
    box.append(card);
  });
}

/* ================================================================= facebook */
function fbPages() { return store.get("pt-fb-pages", null) || FACEBOOK_PAGES; }
let fbActive = 0;
function setupFacebook() { renderFbTabs(); $("fbManage").addEventListener("click", openFbDialog); }
function renderFbTabs() {
  const pages = fbPages(), tabs = clear($("fbTabs"));
  fbActive = Math.min(fbActive, pages.length - 1);
  pages.forEach((p, i) => {
    const t = h("button", { class: `tab ${i === fbActive ? "active" : ""}`, role: "tab", onclick: () => { fbActive = i; renderFbTabs(); } }, p.name);
    setTip(t, () => tt({ title: p.name, text: p.about || "", rows: [["Page", `facebook.com/${p.handle}`]] }));
    tabs.append(t);
  });
  const frame = clear($("fbFrame"));
  const p = pages[fbActive];
  if (!p) { frame.append(h("div", { class: "empty" }, "No Facebook pages. Click \"Edit pages\" to add some.")); return; }
  const url = `https://www.facebook.com/${encodeURIComponent(p.handle)}`;
  const src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(url)}&tabs=timeline&width=500&height=620&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false`;
  frame.append(h("div", { style: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", padding: "8px" } },
    h("a", { href: url, target: "_blank", rel: "noopener" }, `Open ${p.name} on Facebook ↗`),
    h("iframe", { src, title: `${p.name} Facebook posts`, loading: "lazy", allow: "encrypted-media", scrolling: "yes" })));
}
function openFbDialog() {
  const dlg = $("fbDialog");
  const draw = () => {
    clear(dlg);
    const pages = fbPages();
    dlg.append(h("h3", null, "Facebook pages"), h("p", { class: "note" }, "Saved in this browser only. Use a public page's handle, e.g. islandtimespw, or paste its full URL."));
    pages.forEach((p, i) => dlg.append(h("div", { class: "fb-row" }, h("span", null, `${p.name} · ${p.handle}`),
      h("button", { class: "btn sm", onclick: () => { const n = pages.filter((_, k) => k !== i); store.set("pt-fb-pages", n); draw(); renderFbTabs(); } }, "Remove"))));
    const nameI = h("input", { type: "text", placeholder: "Display name", "aria-label": "Display name" });
    const handleI = h("input", { type: "text", placeholder: "Handle or facebook.com URL", "aria-label": "Facebook handle" });
    dlg.append(h("form", { onsubmit: (e) => {
      e.preventDefault();
      let handle = handleI.value.trim().replace(/^https?:\/\/(www\.|m\.)?facebook\.com\//i, "").replace(/[/?#].*$/, "");
      if (!/^[A-Za-z0-9.\-_]{2,80}$/.test(handle)) { handleI.setCustomValidity("Enter a valid page handle"); handleI.reportValidity(); return; }
      store.set("pt-fb-pages", [...pages, { name: nameI.value.trim() || handle, handle }]); draw(); renderFbTabs();
    } }, nameI, handleI, h("button", { class: "btn", type: "submit" }, "Add")));
    dlg.append(h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: "12px" } },
      h("button", { class: "btn sm", onclick: () => { store.set("pt-fb-pages", null); draw(); renderFbTabs(); } }, "Reset to defaults"),
      h("button", { class: "btn", onclick: () => dlg.close() }, "Done")));
  };
  draw(); dlg.showModal();
}

/* ================================================================= weather */
const WMO = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Rime fog"],
  51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  80: ["🌦️", "Light showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Violent showers"], 95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm, hail"], 99: ["⛈️", "Severe thunderstorm"] };
const wmo = (c) => WMO[c] || ["🌡️", `Code ${c}`];
async function loadWeather() {
  const [lat, lon] = WEATHER.point, [mlat, mlon] = WEATHER.marinePoint;
  try {
    state.wx = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,uv_index&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset&timezone=Pacific%2FPalau&forecast_days=7&wind_speed_unit=kn`);
    clientStatus("wx", "Weather (Open-Meteo)", true, `Current conditions ${state.wx.current?.time} Palau`);
  } catch (e) { clientStatus("wx", "Weather (Open-Meteo)", false, e.message); }
  try {
    state.marine = await fetchJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${mlat}&longitude=${mlon}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction&hourly=wave_height,swell_wave_height,wave_period&timezone=Pacific%2FPalau&forecast_days=7`);
    clientStatus("marine", "Sea state (Open-Meteo Marine)", true, "Waves, swell and SST loaded");
  } catch (e) { clientStatus("marine", "Sea state (Open-Meteo Marine)", false, e.message); }
}
async function loadTides() {
  const d = new Date(), ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const base = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${WEATHER.tideStation}&product=predictions&datum=MLLW&units=metric&time_zone=gmt&format=json&begin_date=${ymd}&range=72`;
  try {
    const [hourly, hilo] = await Promise.all([fetchJSON(`${base}&interval=h`), fetchJSON(`${base}&interval=hilo`)]);
    state.tides = { hourly: hourly.predictions || [], hilo: hilo.predictions || [] };
    clientStatus("tides", "Tides (NOAA CO-OPS)", true, `${WEATHER.tideStationName}, ${state.tides.hilo.length} high/low tides in 72 h`);
  } catch (e) { clientStatus("tides", "Tides (NOAA CO-OPS)", false, e.message); }
}
const palauLocal = (s) => new Date(`${s}:00+09:00`);   // Open-Meteo local ISO without zone
function renderWeather() {
  const wx = state.wx, mar = state.marine;
  const now = clear($("wxNow"));
  if (!wx) { now.append(h("div", { class: "empty" }, "Weather unavailable right now.")); return; }
  const c = wx.current, [ico, label] = wmo(c.weather_code);
  const stat = (l, v, tip) => h("div", { class: "wx-stat", tip: tt(tip) }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
  now.append(
    stat("Now", [ico, " ", fmt(c.temperature_2m, 1), h("small", null, " °C")], { title: `${label}, ${fmt(c.temperature_2m, 1)} °C`, rows: [["Feels like", `${fmt(c.apparent_temperature, 1)} °C`], ["Cloud cover", `${c.cloud_cover}%`], ["Observed", `${c.time.replace("T", " ")} Palau`]], foot: "Open-Meteo model analysis for Koror" }),
    stat("Humidity", [fmt(c.relative_humidity_2m), h("small", null, " %")], { title: "Relative humidity", text: "Above ~75% combined with 30 °C+ makes the heat index climb quickly." }),
    stat("Wind", [fmt(c.wind_speed_10m), h("small", null, ` kn ${compass(c.wind_direction_10m).split(" ")[1]}`)], { title: "Wind at 10 m", rows: [["Speed", `${fmt(c.wind_speed_10m, 1)} kn`], ["Gusts", `${fmt(c.wind_gusts_10m, 1)} kn`], ["From", compass(c.wind_direction_10m)]], foot: "Small-craft advisories usually start around 20–25 kn sustained." }),
    stat("Rain now", [fmt(c.precipitation, 1), h("small", null, " mm")], { title: "Precipitation in the last 15 minutes", text: "Koror averages well over 3,500 mm of rain a year; showers are frequent and brief." }),
    stat("Pressure", [fmt(c.pressure_msl), h("small", null, " hPa")], { title: "Sea-level pressure", text: "A steady fall below ~1005 hPa can signal a developing tropical system nearby." }),
    stat("UV index", fmt(c.uv_index, 1), { title: "UV index", text: "8–10 is very high, 11+ is extreme. Near the equator the midday UV index is often 10+." }),
  );
  if (mar?.current) {
    const m = mar.current;
    now.append(stat("Waves", [fmt(m.wave_height, 1), h("small", null, " m")], { title: "Significant wave height", rows: [["From", compass(m.wave_direction)], ["Period", `${fmt(m.wave_period, 1)} s`], ["Swell", `${fmt(m.swell_wave_height, 1)} m from ${compass(m.swell_wave_direction)}, ${fmt(m.swell_wave_period, 1)} s`], ["Wind waves", `${fmt(m.wind_wave_height, 1)} m`], ["Current", m.ocean_current_velocity != null ? `${fmt(m.ocean_current_velocity, 1)} km/h toward ${compass(m.ocean_current_direction)}` : null]], foot: `Open water west of Malakal (${WEATHER.marinePoint.join(", ")})` }),
      stat("Sea temp", [fmt(m.sea_surface_temperature, 1), h("small", null, " °C")], { title: "Sea surface temperature", text: "Model SST off Koror. See Ocean & coral health for the NOAA satellite record and bleaching threshold." }));
  }
  const days = clear($("wxDays")), d = wx.daily;
  d.time.forEach((t, i) => {
    const [di, dl] = wmo(d.weather_code[i]);
    const date = new Date(`${t}T12:00:00+09:00`);
    const card = h("div", { class: "wx-day" }, h("div", { class: "d" }, i === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short", timeZone: "Pacific/Palau" })),
      h("div", { class: "i" }, di), h("div", { class: "t" }, h("b", null, `${fmt(d.temperature_2m_max[i])}°`), ` ${fmt(d.temperature_2m_min[i])}°`), h("div", { class: "d" }, `${d.precipitation_probability_max[i] ?? "–"}% ☂`));
    setTip(card, () => tt({ title: `${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "Pacific/Palau" })}: ${dl}`, rows: [
      ["High / low", `${fmt(d.temperature_2m_max[i], 1)} / ${fmt(d.temperature_2m_min[i], 1)} °C`], ["Rain", `${fmt(d.precipitation_sum[i], 1)} mm (${d.precipitation_probability_max[i] ?? "–"}% chance)`],
      ["Wind", `up to ${fmt(d.wind_speed_10m_max[i])} kn, gusts ${fmt(d.wind_gusts_10m_max[i])} kn from ${compass(d.wind_direction_10m_dominant[i])}`], ["UV max", fmt(d.uv_index_max[i], 1)],
      ["Sunrise / sunset", `${d.sunrise[i].slice(11)} / ${d.sunset[i].slice(11)}`]] }));
    days.append(card);
  });
  const hr = wx.hourly, nowMs = Date.now();
  const idx = hr.time.map((t, i) => [palauLocal(t), i]).filter(([t]) => t >= nowMs - 3600000 && t <= nowMs + 48 * 3600000);
  lineChart($("chartTemp"), { title: "Temperature, next 48 h", x: idx.map(([t]) => t), height: 140,
    series: [{ name: "Air temperature", values: idx.map(([, i]) => hr.temperature_2m[i]), color: "--s2" }, { name: "Feels like", values: idx.map(([, i]) => hr.apparent_temperature[i]), color: "--s2", dash: true }],
    yFmt: (v) => `${fmt(v)}°`, tipExtra: (k) => h("div", { class: "tt-foot" }, wmo(hr.weather_code[idx[k][1]]).join(" ")) });
  barChart($("chartRain"), { title: "Chance of rain, next 48 h", height: 140, labels: idx.map(([t]) => t.toLocaleTimeString("en-US", { timeZone: "Pacific/Palau", hour: "2-digit", hour12: false })),
    values: idx.map(([, i]) => hr.precipitation_probability[i]), color: "--s1", yMax: 100, yFmt: (v) => `${v}%`, xLabelEvery: 6,
    tip: (k) => tt({ title: `${palauTime(idx[k][0])} Palau`, rows: [["Chance of rain", `${hr.precipitation_probability[idx[k][1]]}%`], ["Expected", `${fmt(hr.precipitation[idx[k][1]], 1)} mm`], ["Sky", wmo(hr.weather_code[idx[k][1]]).join(" ")]] }) });
  if (mar?.hourly) {
    const mh = mar.hourly;
    lineChart($("chartWaves"), { title: "Waves, next 7 days", sub: "Significant wave height vs swell, metres", x: mh.time.map(palauLocal), height: 140,
      series: [{ name: "Total waves", values: mh.wave_height, color: "--s1" }, { name: "Swell", values: mh.swell_wave_height, color: "--s3" }],
      yFmt: (v) => `${fmt(v, 1)} m`, fromZero: true, yMin: 0, tipExtra: (k) => h("div", { class: "tt-foot" }, `Wave period ${fmt(mh.wave_period[k], 1)} s`) });
  } else empty($("chartWaves"), "Waves", "Marine forecast unavailable");
  renderTides();
}
function renderTides() {
  const t = state.tides;
  if (!t || !t.hourly.length) return empty($("chartTide"), "Tide, Malakal Harbor", "Tide predictions unavailable");
  const x = t.hourly.map((p) => new Date(`${p.t.replace(" ", "T")}:00Z`));
  const markers = t.hilo.map((p) => ({ x: new Date(`${p.t.replace(" ", "T")}:00Z`), y: +p.v, label: `${p.type === "H" ? "H" : "L"} ${(+p.v).toFixed(1)}`, below: p.type === "L" }));
  const next = t.hilo.find((p) => new Date(`${p.t.replace(" ", "T")}:00Z`) > Date.now());
  lineChart($("chartTide"), { title: `Tide, ${WEATHER.tideStationName}`, sub: next ? `Next ${next.type === "H" ? "high" : "low"} ${(+next.v).toFixed(2)} m at ${palauTime(`${next.t.replace(" ", "T")}:00Z`, { month: undefined, day: undefined })}` : "Predicted height above MLLW", x, height: 140,
    series: [{ name: "Predicted tide", values: t.hourly.map((p) => +p.v), color: "--s3", area: true, markers }], yFmt: (v) => `${fmt(v, 1)} m`,
    tipExtra: (k) => { const near = t.hilo.find((p) => Math.abs(new Date(`${p.t.replace(" ", "T")}:00Z`) - x[k]) < 3600000); return near ? h("div", { class: "tt-foot" }, `${near.type === "H" ? "High" : "Low"} tide ${(+near.v).toFixed(2)} m at ${palauTime(`${near.t.replace(" ", "T")}:00Z`)}`) : null; } });
  $("wxMeta").textContent = `Open-Meteo · NOAA tides · ${ago(state.client.wx?.checked)}`;
}

/* ================================================================= hazards */
async function loadQuakes() {
  const start = new Date(Date.now() - QUAKES.days * DAY).toISOString().slice(0, 10);
  try {
    const d = await fetchJSON(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${QUAKES.center[0]}&longitude=${QUAKES.center[1]}&maxradiuskm=${QUAKES.radiusKm}&minmagnitude=4&starttime=${start}&orderby=time`);
    state.quakes = d.features || [];
    clientStatus("usgs", "Earthquakes (USGS)", true, `${state.quakes.length} M4+ quakes within ${fmt(QUAKES.radiusKm)} km in ${QUAKES.days} days`);
  } catch (e) { clientStatus("usgs", "Earthquakes (USGS)", false, e.message); }
}
function renderQuakes() {
  const min = +$("quakeMin").value, list = (state.quakes || []).filter((f) => f.properties.mag >= min);
  M.setQuakes(list);
  scatterChart($("chartQuakes"), { title: "Magnitude over time", height: 130, t0: Date.now() - QUAKES.days * DAY, t1: Date.now(), yMin: min, yFmt: (v) => `M${v}`,
    emptyMsg: `No M${min}+ earthquakes within ${fmt(QUAKES.radiusKm)} km in ${QUAKES.days} days`,
    points: list.map((f) => ({ t: f.properties.time, y: f.properties.mag, r: Math.max(3, (f.properties.mag - 3) * 2.6), color: f.geometry.coordinates[2] < 70 ? "--s2" : f.geometry.coordinates[2] < 300 ? "--s4" : "--s1", tip: quakeTip(f), onClick: () => M.focus(`eq:${f.id}`, 6) })) });
  const box = clear($("quakeList"));
  list.slice(0, 40).forEach((f) => {
    const p = f.properties, [lon, lat, depth] = f.geometry.coordinates;
    const row = h("div", { class: "row", tabindex: 0, onclick: () => M.focus(`eq:${f.id}`, 6) },
      h("span", { class: "ico" }, h("span", { style: { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", background: M.quakeColor(depth) } })),
      h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, `M ${fmt(p.mag, 1)} · ${p.place || ""}`), h("div", { class: "meta" }, `${fmt(depth)} km deep · ${fmt(haversineKm([7.3426, 134.4789], [lat, lon]))} km from Koror`)),
      h("div", { class: "right" }, ago(p.time)));
    setTip(row, () => quakeTip(f));
    box.append(row);
  });
  if (!list.length) box.append(h("div", { class: "empty" }, "None."));
}
function renderHazards() {
  const hz = state.hazards || {};
  const storms = hz.cyclones || [];
  M.setCyclones(storms);
  const cb = clear($("cycloneList"));
  const near = storms.filter((s) => s.near);
  if (!near.length) cb.append(h("div", { class: "empty" }, pill("good", "None"), " No tropical cyclones within 4,000 km of Palau.", storms.length ? ` ${storms.length} active elsewhere in the world.` : ""));
  storms.forEach((s) => {
    const lvl = !s.current ? "neutral" : s.closest_km < 600 ? "critical" : s.closest_km < 1500 ? "serious" : s.near ? "warning" : "neutral";
    const row = h("a", { class: "row", href: s.report, target: "_blank", rel: "noopener", onclick: (e) => { if (s.near && M.focus(`tc:${s.id}`, 5)) e.preventDefault(); } },
      h("span", { class: "ico" }, "🌀"),
      h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, s.name), h("div", { class: "meta" }, `${s.severity || ""} · ${fmt(s.dist_koror_km)} km from Koror`)),
      h("div", { class: "right" }, pill(lvl, s.near ? `${fmt(s.closest_km)} km` : "far")));
    setTip(row, () => M.cycloneTip(s));
    cb.append(row);
  });
  const tb = clear($("tsunamiList"));
  const tsu = hz.tsunami || [];
  if (!tsu.length) tb.append(h("div", { class: "empty" }, "No current bulletins."));
  tsu.forEach((t) => {
    const cat = (t.category || "").toLowerCase();
    const lvl = /warning|threat/.test(cat) ? "critical" : /watch/.test(cat) ? "serious" : /advisory/.test(cat) ? "warning" : "neutral";
    const row = h("a", { class: "row", href: t.link || "https://www.tsunami.gov", target: "_blank", rel: "noopener" },
      h("span", { class: "ico" }, "🌊"),
      h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, t.region || t.bulletin), h("div", { class: "meta" }, `${t.center} · M${t.magnitude ?? "?"} · ${t.dist_koror_km != null ? `${fmt(t.dist_koror_km)} km from Koror` : ""}`)),
      h("div", { class: "right" }, pill(lvl, t.category || "Bulletin"), h("br"), ago(t.updated)));
    setTip(row, () => tt({ title: t.bulletin, sub: `${t.center} · ${palauTime(t.updated)} Palau (${ago(t.updated)})`, text: t.summary, rows: [["Distance to Koror", t.dist_koror_km != null ? `${fmt(t.dist_koror_km)} km` : null]], foot: "Information statements mean no tsunami threat. Always follow Palau NEMO and the National Weather Service." }));
    tb.append(row);
  });
}

/* ================================================================= ocean */
function renderOcean() {
  const o = state.ocean, box = clear($("coralStatus"));
  if (!o || !o.rows?.length) { box.append(h("div", { class: "empty" }, "Coral Reef Watch data not available yet.")); return; }
  const L = o.latest, baaLvl = L.baa >= 3 ? "critical" : L.baa === 2 ? "serious" : L.baa === 1 ? "warning" : "good";
  const tile = (l, v, tip) => h("div", { class: "wx-stat", tip: tt(tip) }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
  box.append(
    tile("Bleaching alert", pill(baaLvl, L.baa_label), { title: `NOAA Bleaching Alert Area: ${L.baa_label}`, text: "Watch: SST at or above the bleaching threshold. Warning: heat stress building (DHW > 0). Alert level 1: DHW ≥ 4, significant bleaching likely. Alert level 2: DHW ≥ 8, severe bleaching and some mortality likely.", foot: `Satellite data for ${L.date}` }),
    tile("Reef SST", [fmt(L.sst_c, 2), h("small", null, " °C")], { title: "Sea surface temperature (5 km satellite, reef pixels)", rows: [["Bleaching threshold", `${fmt(o.bleaching_threshold_c, 2)} °C (MMM + 1)`], ["Max monthly mean", `${fmt(o.mmm_c, 2)} °C`], ["Range today", `${fmt(L.sst_min_c, 2)}–${fmt(L.sst_max_c, 2)} °C`]] }),
    tile("SST anomaly", [L.ssta_c > 0 ? "+" : "", fmt(L.ssta_c, 2), h("small", null, " °C")], { title: "Anomaly vs. the long-term mean for this date", text: "Positive values mean warmer than normal." }),
    tile("Heat stress", [fmt(L.dhw, 1), h("small", null, " DHW")], { title: "Degree Heating Weeks", text: "Accumulated heat stress over the past 12 weeks (°C-weeks above the bleaching threshold). 4+ means significant bleaching is likely, 8+ severe bleaching." }),
  );
  const x = o.rows.map((r) => new Date(`${r[0]}T00:00:00Z`));
  lineChart($("chartSst"), { title: "Reef sea surface temperature, 13 months", sub: "NOAA Coral Reef Watch, Palau virtual station", x, height: 150,
    series: [{ name: "SST (°C)", values: o.rows.map((r) => r[1]), color: "--s1" }], threshold: { value: o.bleaching_threshold_c, label: `Bleaching threshold ${fmt(o.bleaching_threshold_c, 1)} °C` },
    yFmt: (v) => `${fmt(v, 1)}°`, tipTitle: (i) => o.rows[i][0], tipExtra: (i) => h("div", { class: "tt-foot" }, `Anomaly ${o.rows[i][2] > 0 ? "+" : ""}${fmt(o.rows[i][2], 2)} °C · ${o.baa_labels[o.rows[i][4]]}`) });
  lineChart($("chartDhw"), { title: "Accumulated heat stress (Degree Heating Weeks)", x, height: 130,
    series: [{ name: "DHW", values: o.rows.map((r) => r[3]), color: "--s2", area: true }], threshold: { value: 4, label: "Alert level 1 (4 DHW)" }, yMin: 0,
    yFmt: (v) => fmt(v, 0), tipTitle: (i) => o.rows[i][0], tipExtra: (i) => h("div", { class: "tt-foot" }, o.baa_labels[o.rows[i][4]]) });
  $("oceanMeta").textContent = `NOAA CRW · data for ${L.date}`;
}

/* ================================================================= fishing (GFW) */
function renderGfw() {
  const g = state.gfw || {}, body = clear($("gfwBody"));
  if (!g.configured) {
    M.setGfw([], []);
    body.append(h("div", { class: "setup" }, h("b", null, "Connect Global Fishing Watch (free) to see fishing, encounters, loitering and AIS gaps in Palau's EEZ"),
      h("ol", null,
        h("li", null, "Request a free API token at ", h("a", { href: "https://globalfishingwatch.org/our-apis/tokens", target: "_blank", rel: "noopener" }, "globalfishingwatch.org/our-apis"), "."),
        h("li", null, "Add it as the GitHub Actions secret ", h("code", null, "GFW_TOKEN"), "."),
        h("li", null, "The next scheduled run fills this panel and the map layers.")),
      h("p", { class: "note" }, "GFW combines terrestrial and satellite AIS, so it catches fishing vessels far offshore that shore receivers miss. Its data runs ~3–5 days behind real time.")));
    return;
  }
  const ev = g.events || [];
  M.setGfw(ev, g.effort_cells_30d);
  $("gfwMeta").textContent = `${g.window?.start} → ${g.window?.end} · updated ${ago(g.updated)}`;
  const types = ["fishing", "encounter", "loitering", "gap", "port_visit"];
  const desc = { fishing: "Periods when a vessel's movement looks like fishing, from AIS track patterns.", encounter: "Two vessels close together at low speed for a while: possible transshipment of catch, fuel or crew.", loitering: "A carrier vessel moving slowly in open water, possibly waiting to meet fishing vessels.", gap: "The vessel's AIS went silent for 12 h+ where reception was good: possibly switched off on purpose.", port_visit: "Vessel visits to ports and anchorages." };
  body.append(h("div", { class: "coral-status" }, types.map((t) => h("div", { class: "wx-stat", tip: tt({ title: gfwLabel(t), text: desc[t], rows: [["Events (30 d)", fmt((g.counts || {})[t] || 0)]] }) },
    h("div", { class: "l" }, gfwLabel(t).split(" (")[0]), h("div", { class: "v" }, fmt((g.counts || {})[t] || 0))))));
  const grid = h("div", { class: "gfw-grid" }), c1 = h("div", { class: "chart" }), c2 = h("div", { class: "chart" });
  grid.append(c1, c2); body.append(grid);
  const flags = Object.entries(g.effort_by_flag_30d || {}).slice(0, 10);
  const total = flags.reduce((a, [, v]) => a + v, 0);
  hbarChart(c1, { title: "Apparent fishing hours by flag, 30 days", fmt: (v) => fmt(v), color: "--s2", emptyMsg: "No fishing effort recorded",
    rows: flags.map(([k, v]) => ({ label: k, value: v, tip: tt({ title: `${k}: ${fmt(v, 1)} fishing hours`, rows: [["Share", `${fmt((v / (total || 1)) * 100, 1)}%`]], foot: "ISO 3166 alpha-3 flag code. Global Fishing Watch." }) })) });
  const months = Object.keys(g.effort_monthly || {}).sort();
  lineChart(c2, { title: "Monthly fishing hours in the EEZ", x: months.map((m) => new Date(`${m.length === 7 ? m : m.slice(0, 7)}-15T00:00:00Z`)), height: 150, yMin: 0, emptyMsg: "No monthly data",
    series: [{ name: "Fishing hours", values: months.map((m) => Object.values(g.effort_monthly[m]).reduce((a, b) => a + b, 0)), color: "--s2", area: true }],
    yFmt: (v) => fmt(v), tipTitle: (i) => months[i], tipExtra: (i) => h("div", { class: "tt-foot" }, Object.entries(g.effort_monthly[months[i]]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")) });
  body.append(h("div", { class: "sub-head" }, "Latest events"));
  const list = h("div", { class: "list compact" });
  ev.slice(0, 60).forEach((e) => {
    const row = h("div", { class: "row", tabindex: 0, onclick: () => M.focus(`gfw:${e.id}`, 7) },
      h("span", { class: "ico" }, h("span", { style: { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", border: `2px solid ${cssVar(M.GFW_COLORS[e.type])}` } })),
      h("div", { style: { minWidth: 0 } }, h("div", { class: "title" }, `${gfwLabel(e.type)} · ${e.vessel?.name || e.vessel?.mmsi || "Unknown vessel"}`), h("div", { class: "meta" }, [e.vessel?.flag, e.vessel?.type].filter(Boolean).join(" · "))),
      h("div", { class: "right" }, ago(e.start)));
    setTip(row, () => gfwEventTip(e));
    list.append(row);
  });
  if (!ev.length) list.append(h("div", { class: "empty" }, (g.errors || []).length ? `GFW returned errors: ${g.errors[0]}` : "No events in the last 30 days."));
  body.append(list);
}

/* ================================================================= trends */
function renderTrends() {
  const rows = state.history?.rows || [];
  if (rows.length < 2) {
    empty($("chartShipsTrend"), "Ships in the EEZ", "Trends build up as the scheduled job runs (about every 20 min).");
    empty($("chartAirTrend"), "Aircraft near Palau", "Trends build up as the scheduled job runs.");
    return;
  }
  const x = rows.map((r) => new Date(r.t));
  lineChart($("chartShipsTrend"), { title: "Ships in the EEZ", sub: "Heard in the last 6 h, per run", x, height: 150, yMin: 0,
    series: [{ name: "All ships", values: rows.map((r) => r.ships_eez ?? null), color: "--s1" }, { name: "Fishing vessels", values: rows.map((r) => r.fishing_eez ?? null), color: "--s2" }], yFmt: (v) => fmt(v) });
  lineChart($("chartAirTrend"), { title: "Aircraft near Palau", sub: "Within 250 NM of ROR, per run", x, height: 150, yMin: 0,
    series: [{ name: "Aircraft", values: rows.map((r) => r.aircraft_palau ?? null), color: "--s7" }], yFmt: (v) => fmt(v) });
}

/* ================================================================= embeds */
function setupEmbeds() {
  const tabs = document.querySelectorAll("#embedTabs .tab");
  let loaded = false;
  const show = (k) => {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.embed === k));
    const box = clear($("embedFrame")), e = EMBEDS;
    if (k === "vesselfinder") {
      box.append(h("iframe", { title: "VesselFinder live map", sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", srcdoc: `<!doctype html><html><body style="margin:0"><script>var width="100%";var height="460";var names=true;var latitude="${e.vesselfinder.lat}";var longitude="${e.vesselfinder.lon}";var zoom="${e.vesselfinder.zoom}";</script><script src="https://www.vesselfinder.com/aismap.js"></script></body></html>` }));
      $("embedNote").textContent = "VesselFinder's live AIS map (terrestrial and some satellite AIS). Hover ships inside the map for details.";
    } else if (k === "marinetraffic") {
      box.append(h("iframe", { title: "MarineTraffic live map", sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", srcdoc: `<!doctype html><html><body style="margin:0"><script>width="100%";height="460";border="0";shownames="false";latitude="${e.marinetraffic.lat}";longitude="${e.marinetraffic.lon}";zoom="${e.marinetraffic.zoom}";maptype="1";trackvessel="0";fleet="";</script><script src="https://www.marinetraffic.com/js/embed.js"></script></body></html>` }));
      $("embedNote").textContent = "MarineTraffic's embeddable live map.";
    } else {
      box.append(h("iframe", { title: "adsb.lol live flight map", src: e.adsb, loading: "lazy" }));
      clear($("embedNote")).append("adsb.lol live globe, centred on Palau. If it stays blank, ", h("a", { href: e.adsb, target: "_blank", rel: "noopener" }, "open it in a new tab ↗"), ".");
    }
  };
  tabs.forEach((t) => {
    t.addEventListener("click", () => show(t.dataset.embed));
    setTip(t, () => tt({ text: { vesselfinder: "Third-party live ship map. Useful when our AIS key isn't set up or ships are out of shore-receiver range.", marinetraffic: "Third-party live ship map, satellite base map.", adsb: "Live community ADS-B globe for flights." }[t.dataset.embed] }));
  });
  new IntersectionObserver((ents, obs) => { if (ents.some((e) => e.isIntersecting) && !loaded) { loaded = true; show("vesselfinder"); obs.disconnect(); } }, { rootMargin: "200px" }).observe($("embedFrame"));
}

/* ================================================================= status */
const HINTS = { ships: "Needs the AISSTREAM_API_KEY repository secret.", gfw: "Needs the GFW_TOKEN repository secret.",
  airport: "Needs the AERODATABOX_API_KEY repository secret (RapidAPI).", policy: "Add the DATA_GOV_API_KEY secret (free at api.data.gov) to avoid DEMO_KEY limits." };
function renderStatus() {
  const grid = clear($("statusGrid"));
  const items = [...Object.entries(state.status?.sources || {}).map(([k, v]) => ({ key: k, ...v, where: "Server (GitHub Action)" })),
    ...Object.entries(state.client).map(([k, v]) => ({ key: k, ...v, where: "Your browser" }))];
  items.forEach((it) => {
    const lvl = it.ok ? "good" : it.configured === false ? "warning" : "critical";
    const lab = it.ok ? "OK" : it.configured === false ? "Not set up" : "Error";
    const el = h("div", { class: "status-item" }, h("div", { class: "n" }, h("span", null, it.label), pill(lvl, lab)), h("div", { class: "m" }, it.message || ""), h("div", { class: "m" }, `${it.where} · ${ago(it.checked)}`));
    setTip(el, () => tt({ title: it.label, sub: it.where, text: it.message, rows: [["Checked", when(it.checked)], ["Items", it.count != null ? fmt(it.count) : null], ["Took", it.seconds != null ? `${it.seconds} s` : null]], foot: !it.ok ? HINTS[it.key] || "Will retry on the next run." : null }));
    grid.append(el);
  });
}

/* ================================================================= KPIs */
function kpi(label, value, foot, tip, onclick) {
  const el = h("div", { class: "kpi", tabindex: 0, onclick }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), h("div", { class: "kfoot" }, foot));
  setTip(el, tip);
  return el;
}
const goto = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
function renderKpis() {
  const box = clear($("kpis"));
  // ships
  const sd = state.ships || {}, fresh = shipsFresh(), inE = fresh.filter((s) => s.in_eez);
  const byCat = {}; inE.forEach((s) => { byCat[s.category] = (byCat[s.category] || 0) + 1; });
  const flagged = fresh.filter((s) => s.watch?.length).length;
  box.append(kpi("🚢 Ships in EEZ", sd.configured ? fmt(inE.length) : "–", sd.configured ? `${fmt(byCat.Fishing || 0)} fishing · ${fmt(flagged)} flagged` : "Add aisstream.io key",
    () => tt({ title: "Ships inside Palau's EEZ", sub: "AIS reports in the last 6 h", rows: Object.entries(byCat).sort((a, b) => b[1] - a[1]), text: sd.configured ? null : "Ship tracking isn't set up yet (needs the free AISSTREAM_API_KEY secret).", foot: `${fmt(fresh.length)} ships heard in the wider area. Shore-based AIS misses ships far offshore.` }),
    () => { document.querySelector('#sideTabs [data-tab="ships"]').click(); goto("mapCard")(); }));
  // aircraft
  const ac = state.flights?.aircraft || [], near = ac.filter((a) => a.region === "palau"), log = state.flights?.log || [];
  box.append(kpi("✈ Aircraft near Palau", fmt(near.length), `${fmt(near.filter((a) => a.inbound_ror).length)} heading for ROR · ${fmt(log.length)} in 24 h`,
    () => tt({ title: "Aircraft within 250 NM of ROR", rows: near.slice(0, 8).map((a) => [a.callsign || a.hex, `${a.desc || a.type || ""} ${a.on_ground ? "on ground" : `${fmt(a.alt_ft)} ft`} · ${fmt(a.dist_ror_nm)} NM`]), text: near.length ? null : "None in ADS-B range right now.", foot: $("liveFlights").checked ? "Live from OpenSky" : `Snapshot ${ago(state.flights?.updated)}` }),
    () => { document.querySelector('#sideTabs [data-tab="flights"]').click(); goto("mapCard")(); }));
  // weather
  const wx = state.wx?.current;
  if (wx) {
    const [ico, lab] = wmo(wx.weather_code);
    box.append(kpi(`${ico} Koror now`, [fmt(wx.temperature_2m, 1), h("small", null, " °C")], `${lab} · wind ${fmt(wx.wind_speed_10m)} kn`,
      () => tt({ title: `${lab}, ${fmt(wx.temperature_2m, 1)} °C`, rows: [["Feels like", `${fmt(wx.apparent_temperature, 1)} °C`], ["Humidity", `${wx.relative_humidity_2m}%`], ["Wind", `${fmt(wx.wind_speed_10m, 1)} kn from ${compass(wx.wind_direction_10m)}, gusts ${fmt(wx.wind_gusts_10m)} kn`], ["UV index", fmt(wx.uv_index, 1)]] }), goto("wxNow")));
  }
  const mar = state.marine?.current;
  if (mar) box.append(kpi("🌊 Sea state", [fmt(mar.wave_height, 1), h("small", null, " m")], `${fmt(mar.wave_period, 1)} s from ${compass(mar.wave_direction).split(" ")[1]} · SST ${fmt(mar.sea_surface_temperature, 1)} °C`,
    () => tt({ title: "Waves off Koror", rows: [["Significant height", `${fmt(mar.wave_height, 2)} m`], ["Swell", `${fmt(mar.swell_wave_height, 2)} m, ${fmt(mar.swell_wave_period, 1)} s`], ["Direction", compass(mar.wave_direction)], ["Sea temperature", `${fmt(mar.sea_surface_temperature, 1)} °C`]] }), goto("chartWaves")));
  // cyclones
  const storms = (state.hazards?.cyclones || []).filter((s) => s.current && s.near);
  const closest = storms.reduce((m, s) => (!m || s.closest_km < m.closest_km ? s : m), null);
  box.append(kpi("🌀 Tropical cyclones", closest ? pill(closest.closest_km < 600 ? "critical" : closest.closest_km < 1500 ? "serious" : "warning", `${storms.length} active`) : pill("good", "None nearby"),
    closest ? `${closest.name} · ${fmt(closest.closest_km)} km` : "Within 4,000 km of Palau",
    () => tt({ title: "Tropical cyclones near Palau", rows: storms.map((s) => [s.name, `${s.severity || ""} · closest ${fmt(s.closest_km)} km`]), text: storms.length ? null : "GDACS lists no active storms within 4,000 km. Typhoon season in the western North Pacific peaks July–November, though Palau's low latitude means direct hits are uncommon.", foot: "GDACS" }), goto("cycloneList")));
  // quakes
  const qs = (state.quakes || []).filter((f) => Date.now() - f.properties.time < 7 * DAY);
  const big = qs.reduce((m, f) => (!m || f.properties.mag > m.properties.mag ? f : m), null);
  box.append(kpi("🌐 Largest quake (7 d)", big ? `M${fmt(big.properties.mag, 1)}` : "–", big ? `${big.properties.place} · ${ago(big.properties.time)}` : "None M4+ within 1,500 km",
    () => (big ? quakeTip(big) : tt({ text: "No M4+ earthquakes within 1,500 km in the last 7 days." })), goto("chartQuakes")));
  // coral
  const o = state.ocean?.latest;
  if (o) box.append(kpi("🪸 Coral heat stress", pill(o.baa >= 3 ? "critical" : o.baa === 2 ? "serious" : o.baa === 1 ? "warning" : "good", o.baa_label), `DHW ${fmt(o.dhw, 1)} · SST ${fmt(o.sst_c, 1)} °C`,
    () => tt({ title: `Bleaching alert: ${o.baa_label}`, rows: [["Degree Heating Weeks", fmt(o.dhw, 2)], ["SST", `${fmt(o.sst_c, 2)} °C`], ["Anomaly", `${o.ssta_c > 0 ? "+" : ""}${fmt(o.ssta_c, 2)} °C`], ["Threshold", `${fmt(state.ocean.bleaching_threshold_c, 2)} °C`]], foot: `NOAA Coral Reef Watch, ${o.date}` }), goto("coralStatus")));
  // news
  const items = state.news?.items || [], today = items.filter((i) => Date.now() - new Date(i.published) < DAY && i.relevance !== "regional");
  const wk = items.filter((i) => Date.now() - new Date(i.published) < 7 * DAY && i.relevance !== "regional");
  box.append(kpi("📰 Palau news", fmt(wk.length), `${fmt(today.length)} in last 24 h`,
    () => tt({ title: "Latest Palau headlines", extra: h("div", null, wk.slice(0, 6).map((i) => h("div", { class: "tt-p" }, `• ${i.title} `, h("span", { style: { color: "var(--text-secondary)" } }, `(${i.source}, ${ago(i.published)})`)))) }), goto("newsCard")));
  // port
  const pt = state.port;
  if (pt) box.append(kpi("⚓ In port · Malakal", fmt(pt.in_port.length), `${fmt(pt.expected.length)} expected · ${fmt(pt.calls.filter((c) => Date.now() - new Date(c.arrived) < 7 * DAY).length)} calls in 7 d`,
    () => tt({ title: "Commercial ships at Malakal Harbor", rows: pt.in_port.map((c) => [c.name || c.mmsi, `${c.type_label || c.category || ""} · ${fmt(c.hours_in_port, 0)} h`]), text: pt.in_port.length ? null : "No AIS class-A ships within 4 NM of Malakal right now.", foot: "Derived from AIS" }), goto("portCard")));
  // king tide
  const kt = P.nextKingTide(state);
  if (state.sealevel?.king_tides) box.append(kpi("🌊 Next king tide", kt ? [fmt(kt.height_m, 2), h("small", null, " m")] : "None", kt ? `${palauTime(kt.time, { weekday: "short" })} · ${ago(kt.time)}` : "in the next 6 months",
    () => tt({ title: "King tides at Malakal Harbor", text: `High tides above ${fmt(state.sealevel.king_tides.p98_m, 2)} m (top 2%). Low-lying coastal areas can flood, especially with wind or swell.`, rows: (state.sealevel.king_tides.upcoming || []).filter((u) => u.level === "king").slice(0, 5).map((u) => [palauTime(u.time, { weekday: "short" }), `${fmt(u.height_m, 2)} m`]) }), goto("sealevelCard")));
  // tourism
  const tm = (state.tourism?.months || []).filter((m) => !m.derived_from).slice(-1)[0];
  if (tm) box.append(kpi("🧳 Visitors", fmt(tm.total), `${new Date(`${tm.month}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}${tm.yoy_pct != null ? ` · ${tm.yoy_pct > 0 ? "+" : ""}${tm.yoy_pct}% YoY` : ""}`,
    () => tt({ title: `Visitor arrivals, ${tm.month}`, text: tm.summary, rows: [["Year to date", tm.ytd ? fmt(tm.ytd) : null]] }), goto("tourismCard")));
  // fishing
  const g = state.gfw;
  if (g?.configured) {
    const recent = (g.events || []).filter((e) => Date.now() - new Date(e.start) < 7 * DAY);
    box.append(kpi("🎣 Fishing events (7 d)", fmt(recent.length), `${fmt(recent.filter((e) => e.type === "encounter").length)} encounters · ${fmt(recent.filter((e) => e.type === "gap").length)} AIS gaps`,
      () => tt({ title: "Global Fishing Watch, last 7 days of available data", rows: ["fishing", "encounter", "loitering", "gap", "port_visit"].map((t) => [gfwLabel(t), fmt(recent.filter((e) => e.type === t).length)]), foot: "GFW data lags ~3–5 days" }), goto("gfwBody")));
  }
}

/* ================================================================= alerts */
function collectAlerts() {
  const out = [];
  shipsFresh().filter((s) => s.watch?.length).forEach((s) => out.push({ level: s.category === "Fishing" && s.in_eez ? "serious" : "warning", label: `🚢 ${s.name || s.mmsi}: ${s.watch[0]}`, tip: () => shipTip(s), go: () => M.focus(`ship:${s.mmsi}`) }));
  (state.flights?.aircraft || []).forEach((a) => {
    if (["7500", "7600", "7700"].includes(a.squawk) || a.emergency) out.push({ level: "critical", label: `✈ ${a.callsign || a.hex}: emergency squawk ${a.squawk || a.emergency}`, tip: () => aircraftTip(a), go: () => M.focus(`ac:${a.hex}`) });
    else if (a.military && a.region === "palau") out.push({ level: "neutral", label: `✈ Military aircraft ${a.callsign || a.hex}`, tip: () => aircraftTip(a), go: () => M.focus(`ac:${a.hex}`) });
  });
  (state.hazards?.cyclones || []).filter((s) => s.current && s.closest_km < 1500).forEach((s) => out.push({ level: s.closest_km < 600 ? "critical" : "serious", label: `🌀 ${s.name} within ${fmt(s.closest_km)} km`, tip: () => M.cycloneTip(s), go: () => M.focus(`tc:${s.id}`, 5) }));
  (state.hazards?.tsunami || []).filter((t) => Date.now() - new Date(t.updated) < DAY && (/(warning|watch|advisory|threat)/i.test(t.category || "") || (t.dist_koror_km ?? 1e9) < 2000)).forEach((t) => out.push({ level: /warning|threat/i.test(t.category) ? "critical" : /watch/i.test(t.category) ? "serious" : "warning", label: `🌊 Tsunami ${t.category}: ${t.region}`, tip: () => tt({ title: t.bulletin, text: t.summary }), go: goto("tsunamiList") }));
  (state.quakes || []).filter((f) => f.properties.mag >= 6 && Date.now() - f.properties.time < 7 * DAY && haversineKm([7.34, 134.48], [f.geometry.coordinates[1], f.geometry.coordinates[0]]) < 1000).forEach((f) => out.push({ level: "warning", label: `🌐 M${fmt(f.properties.mag, 1)} ${f.properties.place}`, tip: () => quakeTip(f), go: () => M.focus(`eq:${f.id}`, 6) }));
  const o = state.ocean?.latest;
  if (o && o.baa >= 2) out.push({ level: o.baa >= 3 ? "serious" : "warning", label: `🪸 Coral ${o.baa_label} (DHW ${fmt(o.dhw, 1)})`, tip: () => tt({ title: o.baa_label, text: "Heat stress is building on Palau's reefs." }), go: goto("coralStatus") });
  (state.gfw?.events || []).filter((e) => ["encounter", "gap"].includes(e.type) && Date.now() - new Date(e.start) < 7 * DAY).slice(0, 10).forEach((e) => out.push({ level: "warning", label: `🎣 ${gfwLabel(e.type).split(" (")[0]}: ${e.vessel?.name || e.vessel?.mmsi}`, tip: () => gfwEventTip(e), go: () => M.focus(`gfw:${e.id}`, 7) }));
  const kt = P.nextKingTide(state);
  if (kt && new Date(kt.time) - Date.now() < 3 * DAY) out.push({ level: "warning", label: `🌊 King tide ${fmt(kt.height_m, 2)} m · ${palauTime(kt.time, { weekday: "short" })}`, tip: () => tt({ title: "King tide", text: "Higher-than-usual high tide at Malakal Harbor. Watch low-lying roads and shorelines, especially with strong winds or swell.", rows: [["Predicted", `${fmt(kt.height_m, 2)} m above MLLW`], ["When", `${palauTime(kt.time, { weekday: "long" })} Palau`]] }), go: goto("sealevelCard") });
  (state.airport?.flights || []).filter((f) => /cancel|delay/i.test(f.status || "") && Math.abs(new Date(f.scheduled) - Date.now()) < DAY).forEach((f) => out.push({ level: /cancel/i.test(f.status) ? "serious" : "warning", label: `✈ ${f.number} ${f.direction === "arrival" ? "from" : "to"} ${f.other_iata || "?"}: ${f.status}`, tip: () => tt({ title: `${f.number} ${f.status}`, rows: [["Scheduled", `${palauTime(f.scheduled)} Palau`], ["Revised", f.revised ? `${palauTime(f.revised)} Palau` : null], ["Airline", f.airline]] }), go: goto("airportCard") }));
  (state.policy?.bills || []).filter((b) => Date.now() - new Date(b.latest_action_date || b.date) < 14 * DAY).forEach((b) => out.push({ level: "neutral", label: `📜 ${b.label}: ${b.title.slice(0, 60)}`, tip: () => tt({ title: `${b.label}: ${b.title}`, rows: [["Latest", b.latest_action ? `${b.latest_action_date}: ${b.latest_action}` : `${b.version} (${b.date})`]] }), go: goto("policyCard") }));
  (state.military?.contracts_recent || []).filter((c) => Date.now() - new Date(c.start) < 14 * DAY).forEach((c) => out.push({ level: "neutral", label: `🏗 New DoD contract ${P.money(c.amount)}: ${c.recipient}`, tip: () => tt({ title: c.recipient, text: c.description, rows: [["Amount", P.money(c.amount)], ["Agency", c.sub_agency]] }), go: goto("militaryCard") }));
  const rank = { critical: 0, serious: 1, warning: 2, neutral: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
function renderAlerts() {
  const alerts = collectAlerts(), bar = clear($("alertsBar")), list = clear($("watchList"));
  $("watchBadge").textContent = alerts.length;
  bar.hidden = !alerts.length;
  if (alerts.length) {
    bar.append(h("b", null, "Watch list:"));
    alerts.slice(0, 8).forEach((a) => bar.append(h("button", { class: "alert-chip", onclick: a.go, tip: a.tip }, a.label)));
    if (alerts.length > 8) bar.append(h("button", { class: "alert-chip", onclick: () => document.querySelector('#sideTabs [data-tab="watch"]').click() }, `+${alerts.length - 8} more`));
  }
  if (!alerts.length) list.append(h("div", { class: "empty" }, pill("good", "All clear"), " Nothing flagged right now. The watch list picks up fishing vessels in the EEZ, government vessels, research ships, AIS gaps, emergency squawks, nearby cyclones, tsunami bulletins, large quakes and coral alerts."));
  const missing = P.missingWatched(state.ships?.ships || []);
  if (missing.length) {
    list.append(h("div", { class: "sub-head" }, "Watched vessels not heard in the last 24 h"));
    missing.forEach((w) => list.append(h("div", { class: "row", tip: tt({ title: w.value, text: w.note || "On your watch list", foot: "Not in current AIS data: out of receiver range, AIS off, or elsewhere." }) }, h("span", { class: "ico" }, "★"), h("div", { class: "title" }, w.value, w.note ? h("span", { class: "muted" }, ` · ${w.note}`) : null), h("span"))));
    list.append(h("div", { class: "sub-head" }, "Alerts"));
  }
  alerts.forEach((a) => {
    const row = h("div", { class: "row", tabindex: 0, onclick: a.go }, h("span", { class: "ico" }, pill(a.level, "")), h("div", { class: "title", style: { whiteSpace: "normal" } }, a.label), h("span"));
    setTip(row, a.tip);
    list.append(row);
  });
}

boot();
