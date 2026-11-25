// Leaflet map: boundaries, landmarks, ships, aircraft, quakes, cyclones,
// fishing events and satellite layers, every feature with a hover tooltip.
/* global L */
import { MAP } from "./config.js";
import { ago, cssVar, fmt, palauTime, tt, when } from "./util.js";
import { shipTip, aircraftTip, quakeTip, gfwEventTip, SHIP_COLORS } from "./tips.js";

let map, eezLayer, eezRings = [], layers = {}, registry = new Map(), layerControl;
const tipOpts = { className: "pt-tip", sticky: true, direction: "top", offset: [0, -8], opacity: 1 };
const bindTip = (layer, fn) => layer.bindTooltip(() => fn(), tipOpts);

const LANDMARKS = [
  { name: "Koror", pos: [7.3426, 134.4789], text: "Palau's largest town and commercial centre, on Koror Island. Most government offices, hotels and the main dive operators are here." },
  { name: "Ngerulmud (capital)", pos: [7.5006, 134.6242], text: "Seat of government in Melekeok State on Babeldaob since 2006: the Capitol complex houses the President's office, the Olbiil Era Kelulau (congress) and the judiciary." },
  { name: "Roman Tmetuchl Intl Airport", pos: [7.3673, 134.5442], text: "Palau's international airport in Airai State. IATA ROR · ICAO PTRO." },
  { name: "Malakal Harbor", pos: [7.330, 134.452], text: "Palau's main commercial port, on Malakal Island next to Koror. NOAA tide station 1841367." },
  { name: "Peleliu", pos: [7.00, 134.24], text: "Peleliu State. Site of the 1944 Battle of Peleliu (WWII)." },
  { name: "Angaur", pos: [6.91, 134.14], text: "Angaur State, the southernmost island of the main archipelago. WWII battle site (1944)." },
  { name: "Kayangel", pos: [8.07, 134.71], text: "Kayangel State, Palau's northernmost atoll." },
  { name: "Sonsorol", pos: [5.33, 132.22], text: "Sonsorol State, one of the remote Southwest Islands." },
  { name: "Tobi (Hatohobei)", pos: [3.00, 131.17], text: "Hatohobei State, the southernmost inhabited island of Palau." },
  { name: "Helen Reef", pos: [2.93, 131.80], text: "Remote reef and lagoon in Hatohobei State, a protected area and a long-standing hotspot for illegal fishing." },
];

export function initMap() {
  map = L.map("map", { zoomControl: true, worldCopyJump: true, preferCanvas: false }).setView(MAP.center, MAP.zoom);
  const dark = matchTheme() === "dark";
  const base = {
    "Map (theme)": L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, { attribution: "© OpenStreetMap contributors © CARTO", subdomains: "abcd", maxZoom: 19 }),
    "Satellite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Imagery © Esri, Maxar, Earthstar Geographics", maxZoom: 18 }),
    "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }),
  };
  base["Map (theme)"].addTo(map);
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const gibs = (layer, lvl, ext, name) => L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${day}/GoogleMapsCompatible_Level${lvl}/{z}/{y}/{x}.${ext}`, { attribution: `NASA GIBS ${name} (${day})`, maxNativeZoom: lvl, maxZoom: 12, opacity: 0.85 });

  layers = {
    eez: L.layerGroup().addTo(map), ts: L.layerGroup().addTo(map), bounds: L.layerGroup().addTo(map),
    places: L.layerGroup().addTo(map), ships: L.layerGroup().addTo(map), trails: L.layerGroup().addTo(map),
    aircraft: L.layerGroup().addTo(map), flightTrails: L.layerGroup(), quakes: L.layerGroup().addTo(map),
    cyclones: L.layerGroup().addTo(map), gfw: L.layerGroup().addTo(map), effort: L.layerGroup(),
    sat: gibs("VIIRS_SNPP_CorrectedReflectance_TrueColor", 9, "jpg", "VIIRS true colour"),
    sst: gibs("GHRSST_L4_MUR_Sea_Surface_Temperature", 7, "png", "MUR sea surface temperature"),
  };
  layerControl = L.control.layers(base, {
    "EEZ (200 NM)": layers.eez, "Territorial sea (12 NM)": layers.ts, "Maritime boundaries": layers.bounds,
    "Places": layers.places, "Ships (AIS)": layers.ships, "Ship tracks": layers.trails,
    "Aircraft": layers.aircraft, "Flight tracks (24 h)": layers.flightTrails, "Earthquakes": layers.quakes,
    "Tropical cyclones": layers.cyclones, "Fishing events (GFW)": layers.gfw, "Fishing effort grid (GFW)": layers.effort,
    "Satellite true colour (NASA)": layers.sat, "Sea surface temp (NASA)": layers.sst,
  }, { collapsed: true, position: "topright" }).addTo(map);
  L.control.scale({ imperial: false, metric: true }).addTo(map);

  LANDMARKS.forEach((p) => {
    const m = L.circleMarker(p.pos, { radius: 4, color: cssVar("--surface-1"), weight: 1.5, fillColor: cssVar("--text-secondary"), fillOpacity: 1 });
    bindTip(m, () => tt({ title: p.name, text: p.text, foot: `${p.pos[0].toFixed(3)}°N, ${p.pos[1].toFixed(3)}°E` }));
    m.addTo(layers.places);
  });
  return map;
}

function matchTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function loadBoundaries() {
  const [eez, ts, bd] = await Promise.all(["palau-eez", "palau-12nm", "palau-boundaries"].map((n) => fetch(`assets/geo/${n}.geojson`).then((r) => r.json())));
  const accent = cssVar("--accent");
  eez.features.forEach((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates]).forEach((p) => eezRings.push(p[0])));
  eezLayer = L.geoJSON(eez, { style: { color: accent, weight: 2, fillColor: accent, fillOpacity: 0.05 } });
  eezLayer.eachLayer((l) => bindTip(l, () => tt({
    title: "Palau Exclusive Economic Zone",
    rows: [["Area", "≈ 616,000 km²"], ["Limit", "200 nautical miles"], ["Marine sanctuary", "≈ 80% closed to commercial fishing and extraction (Palau National Marine Sanctuary, in force 2020)"], ["Domestic fishing zone", "≈ 20%, reserved for domestic fishing"]],
    foot: "Boundary: Marine Regions EEZ v12 (VLIZ, CC-BY 4.0), simplified",
  })));
  eezLayer.addTo(layers.eez);
  const tsl = L.geoJSON(ts, { style: { color: accent, weight: 1.2, dashArray: "4 4", fillOpacity: 0 } });
  tsl.eachLayer((l) => bindTip(l, () => tt({ title: "Territorial sea (12 NM)", text: "Palau's sovereign waters, measured from its baselines. Foreign vessels have the right of innocent passage only." })));
  tsl.addTo(layers.ts);
  L.geoJSON(bd, {
    style: (f) => ({ color: cssVar(f.properties.line_type === "Treaty" ? "--s6" : "--s2"), weight: 2.5, dashArray: f.properties.line_type === "Treaty" ? null : "8 6" }),
    onEachFeature: (f, l) => bindTip(l, () => tt({
      title: f.properties.name, sub: f.properties.line_type,
      text: f.properties.line_type === "Treaty"
        ? "Maritime boundary agreed by treaty."
        : "Provisional median (equidistance) line. The boundary has not been settled by treaty, so this part of the EEZ edge is indicative.",
      foot: "Marine Regions EEZ boundaries v12",
    })),
  }).addTo(layers.bounds);
}

export function inEez(lat, lon) {
  return eezRings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

export const fitEez = () => eezLayer && map.fitBounds(eezLayer.getBounds(), { padding: [10, 10] });
export const getMap = () => map;

export function focus(id, zoom = 8) {
  const m = registry.get(id);
  if (!m) return false;
  const ll = m.getLatLng ? m.getLatLng() : m.getBounds().getCenter();
  map.flyTo(ll, Math.max(map.getZoom(), zoom), { duration: 0.8 });
  setTimeout(() => m.openTooltip && m.openTooltip(ll), 850);
  document.getElementById("mapCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

/* ------------------------------------------------------------------ ships */
function shipSvg(s) {
  const c = SHIP_COLORS[s.category] || cssVar("--text-faint");
  const moving = (s.sog || 0) > 0.7 && (s.cog != null || s.heading != null);
  const rot = s.heading ?? s.cog ?? 0;
  const stale = s.age_h > 1;
  const ring = s.watch && s.watch.length ? `<circle r="10" fill="none" stroke="${cssVar("--warning")}" stroke-width="2"/>` : "";
  const body = s.category === "Government & military"
    ? `<rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="${c}" stroke="${cssVar("--surface-1")}" stroke-width="1.5"/>`
    : moving
      ? `<path d="M0,-8 L5,6 L0,3 L-5,6 Z" transform="rotate(${rot})" fill="${c}" stroke="${cssVar("--surface-1")}" stroke-width="1.2"/>`
      : `<circle r="4.5" fill="${c}" stroke="${cssVar("--surface-1")}" stroke-width="1.5"/>`;
  return `<svg width="24" height="24" viewBox="-12 -12 24 24" style="opacity:${stale ? 0.5 : 1}">${ring}${body}</svg>`;
}

export function setShips(ships) {
  layers.ships.clearLayers(); layers.trails.clearLayers();
  for (const sh of ships) {
    if (sh.lat == null) continue;
    const m = L.marker([sh.lat, sh.lon], { icon: L.divIcon({ className: "vessel-icon", html: shipSvg(sh), iconSize: [24, 24], iconAnchor: [12, 12] }), keyboard: false, riseOnHover: true });
    bindTip(m, () => shipTip(sh));
    m.addTo(layers.ships);
    registry.set(`ship:${sh.mmsi}`, m);
    if (sh.trail && sh.trail.length > 1) {
      const line = L.polyline(sh.trail.map((p) => [p[0], p[1]]), { color: SHIP_COLORS[sh.category] || cssVar("--text-faint"), weight: 2, opacity: 0.55 });
      bindTip(line, () => tt({ title: `${sh.name || sh.mmsi} track`, rows: [["Points", sh.trail.length], ["From", when(sh.trail[0][2])], ["To", when(sh.trail[sh.trail.length - 1][2])]] }));
      line.addTo(layers.trails);
    }
  }
}

/* ------------------------------------------------------------------ aircraft */
function planeSvg(a) {
  const c = a.military ? cssVar("--s8") : cssVar("--text-primary");
  const op = a.region === "palau" ? 1 : 0.55;
  return `<svg width="26" height="26" viewBox="-13 -13 26 26" style="opacity:${op}"><g transform="rotate(${a.track || 0})"><path d="M0,-10 L1.6,-3 L9,1.5 L9,3.2 L1.6,1.2 L1.2,7 L3.6,8.8 L3.6,10 L0,9 L-3.6,10 L-3.6,8.8 L-1.2,7 L-1.6,1.2 L-9,3.2 L-9,1.5 L-1.6,-3 Z" fill="${c}" stroke="${cssVar("--surface-1")}" stroke-width="1"/></g></svg>`;
}
export function setAircraft(list, log = []) {
  layers.aircraft.clearLayers(); layers.flightTrails.clearLayers();
  for (const a of list) {
    const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "plane-icon", html: planeSvg(a), iconSize: [26, 26], iconAnchor: [13, 13] }), riseOnHover: true, keyboard: false });
    bindTip(m, () => aircraftTip(a));
    m.addTo(layers.aircraft);
    registry.set(`ac:${a.hex}`, m);
  }
  for (const f of log) {
    if (!f.positions || f.positions.length < 2) continue;
    const line = L.polyline(f.positions.map((p) => [p[0], p[1]]), { color: cssVar("--s1"), weight: 1.5, opacity: 0.6, dashArray: "3 4" });
    bindTip(line, () => tt({ title: f.callsign || f.reg || f.hex, sub: "Flight track, last 24 h", rows: [["Type", f.desc || f.type], ["First seen", when(f.first_seen)], ["Last seen", when(f.last_seen)], ["Closest to ROR", f.min_dist_nm != null ? `${fmt(f.min_dist_nm)} NM` : null]] }));
    line.addTo(layers.flightTrails);
  }
}

/* ------------------------------------------------------------------ quakes */
export const quakeColor = (depth) => cssVar(depth < 70 ? "--s2" : depth < 300 ? "--s4" : "--s1");
export function setQuakes(features) {
  layers.quakes.clearLayers();
  for (const f of features) {
    const [lon, lat, depth] = f.geometry.coordinates;
    const p = f.properties;
    const m = L.circleMarker([lat, lon], { radius: Math.max(3, (p.mag - 2.5) * 3.2), color: cssVar("--surface-1"), weight: 1.5, fillColor: quakeColor(depth), fillOpacity: Date.now() - p.time < 86400000 ? 0.95 : 0.6 });
    bindTip(m, () => quakeTip(f));
    m.on("click", () => window.open(p.url, "_blank", "noopener"));
    m.addTo(layers.quakes);
    registry.set(`eq:${f.id}`, m);
  }
}

/* ------------------------------------------------------------------ cyclones */
export function setCyclones(storms) {
  layers.cyclones.clearLayers();
  for (const st of storms) {
    if (!st.near) continue;
    const red = cssVar("--s8");
    if (st.cone) {
      const cone = L.polygon(st.cone.map((c) => [c[1], c[0]]), { color: red, weight: 1, fillColor: red, fillOpacity: 0.08, dashArray: "2 4" });
      bindTip(cone, () => tt({ title: `${st.name}: forecast uncertainty cone`, text: "Area the storm centre is likely to pass through (GDACS / RSMC forecast)." }));
      cone.addTo(layers.cyclones);
    }
    for (const seg of st.track) {
      const line = L.polyline(seg.coords.map((c) => [c[1], c[0]]), { color: red, weight: seg.forecast ? 2 : 3, dashArray: seg.forecast ? "6 5" : null });
      bindTip(line, () => tt({ title: st.name, sub: `${seg.forecast ? "Forecast" : "Observed"} track`, rows: [["Intensity", seg.cat_label], ["Time", seg.time ? `${palauTime(seg.time)} Palau` : null]] }));
      line.addTo(layers.cyclones);
    }
    const m = L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "vessel-icon", html: `<svg width="28" height="28" viewBox="-14 -14 28 28"><circle r="11" fill="${red}" fill-opacity=".25" stroke="${red}" stroke-width="2"/><text y="5" text-anchor="middle" font-size="14" fill="${red}">🌀</text></svg>`, iconSize: [28, 28], iconAnchor: [14, 14] }) });
    bindTip(m, () => cycloneTip(st));
    m.addTo(layers.cyclones);
    registry.set(`tc:${st.id}`, m);
  }
}
export function cycloneTip(st) {
  return tt({
    title: st.title || st.name, sub: `${st.alert} alert · ${st.current ? "active" : "ended"}`,
    rows: [["Intensity", st.severity], ["Distance to Koror", `${fmt(st.dist_koror_km)} km`], ["Closest track point", `${fmt(st.closest_km)} km from Koror`], ["Affected", st.countries && st.countries.length ? st.countries.join(", ") : "Offshore"], ["Period", `${palauTime(st.from)} → ${palauTime(st.to)}`], ["Updated", st.modified ? ago(st.modified) : null]],
    foot: "GDACS (EU JRC / UN OCHA). Click a list entry for the full report.",
  });
}

/* ------------------------------------------------------------------ GFW */
export const GFW_COLORS = { fishing: "--s2", encounter: "--s7", loitering: "--s4", port_visit: "--s3", gap: "--s8" };
export function setGfw(events, cells) {
  layers.gfw.clearLayers(); layers.effort.clearLayers();
  for (const e of events || []) {
    if (e.lat == null) continue;
    const c = cssVar(GFW_COLORS[e.type] || "--text-faint");
    const m = L.circleMarker([e.lat, e.lon], { radius: 5, color: c, weight: 2, fillColor: c, fillOpacity: 0.25 });
    bindTip(m, () => gfwEventTip(e));
    m.addTo(layers.gfw);
    registry.set(`gfw:${e.id}`, m);
  }
  if (cells && cells.length) {
    const max = Math.max(...cells.map((c) => c[2]));
    const ramp = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"].map(cssVar);
    for (const [lat, lon, hrs] of cells) {
      const k = Math.min(4, Math.floor((Math.log1p(hrs) / Math.log1p(max)) * 5));
      const r = L.rectangle([[lat - 0.05, lon - 0.05], [lat + 0.05, lon + 0.05]], { stroke: false, fillColor: ramp[k], fillOpacity: 0.75 });
      bindTip(r, () => tt({ title: `${fmt(hrs, 1)} fishing hours`, sub: "Apparent fishing effort, last 30 days", rows: [["Cell", `${lat.toFixed(1)}°, ${lon.toFixed(1)}° (0.1°)`]], foot: "Global Fishing Watch" }));
      r.addTo(layers.effort);
    }
  }
}

export { layers };
