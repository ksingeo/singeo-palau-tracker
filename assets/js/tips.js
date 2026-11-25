// Tooltip builders shared by the map and the lists.
import { ago, compass, cssVar, fmt, h, haversineKm, kmToNm, KOROR, palauTime, tt, utcTime, when } from "./util.js";

const SHIP_VARS = {
  "Cargo": "--s1", "Fishing": "--s2", "Passenger": "--s3", "Tug & service": "--s4",
  "Pleasure & sailing": "--s5", "Tanker": "--s7", "Government & military": "--s8", "Other": "--text-faint", "Unknown": "--text-faint",
};
export const SHIP_CATEGORIES = Object.keys(SHIP_VARS).filter((k) => k !== "Unknown");
export const SHIP_COLORS = new Proxy({}, { get: (_, k) => cssVar(SHIP_VARS[k] || "--text-faint") });
export const shipVar = (cat) => SHIP_VARS[cat] || "--text-faint";

const links = (...pairs) => h("div", { class: "tt-foot" }, pairs.filter(Boolean).map(([t]) => t).join(" · "));

export function shipTip(s) {
  const size = s.length_m ? `${fmt(s.length_m)} × ${fmt(s.beam_m || 0)} m` : null;
  return tt({
    title: s.name || `MMSI ${s.mmsi}`,
    sub: [s.type_label || s.category, s.flag ? `${s.flag} flag` : null, s.class ? `AIS class ${s.class}` : null].filter(Boolean).join(" · "),
    rows: [
      ["MMSI", s.mmsi], ["IMO", s.imo], ["Call sign", s.callsign],
      ["Status", s.nav_status_label],
      ["Speed", s.sog != null ? `${fmt(s.sog, 1)} kn` : null],
      ["Course", s.cog != null ? compass(s.cog) : null],
      ["Heading", s.heading != null ? compass(s.heading) : null],
      ["Destination", s.destination], ["ETA", s.eta],
      ["Size", size], ["Draught", s.draught_m ? `${fmt(s.draught_m, 1)} m` : null],
      ["Position", `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°`],
      ["Zone", s.in_territorial_sea ? "Palau territorial sea / internal waters" : s.in_eez ? "Inside Palau EEZ" : "Outside Palau EEZ"],
      ["From Koror", s.dist_koror_nm != null ? `${fmt(s.dist_koror_nm)} NM` : null],
      ["Last report", s.last_pos ? when(s.last_pos) : null],
      ["First seen", s.first_seen ? ago(s.first_seen) : null],
    ],
    warn: s.watch,
    foot: "AIS via aisstream.io. Click to zoom. Open MarineTraffic / VesselFinder by MMSI from the list.",
  });
}

export function aircraftTip(a) {
  const alt = a.on_ground ? "On ground" : a.alt_ft != null ? `${fmt(a.alt_ft)} ft` : null;
  const vr = a.vrate_fpm ? `${a.vrate_fpm > 0 ? "▲ climbing" : "▼ descending"} ${fmt(Math.abs(a.vrate_fpm))} ft/min` : null;
  const warn = [];
  if (a.emergency) warn.push(`Emergency: ${a.emergency}`);
  if (["7500", "7600", "7700"].includes(a.squawk)) warn.push(`Squawk ${a.squawk} (${{ 7500: "hijack", 7600: "radio failure", 7700: "general emergency" }[a.squawk]})`);
  if (a.military) warn.push("Military aircraft (per ADS-B database)");
  return tt({
    title: a.callsign || a.reg || a.hex,
    sub: [a.desc || a.type, a.operator, a.reg].filter(Boolean).join(" · "),
    rows: [
      ["Altitude", alt], ["Vertical", vr],
      ["Ground speed", a.gs_kt != null ? `${fmt(a.gs_kt)} kn` : null],
      ["Track", a.track != null ? compass(a.track) : null],
      ["Squawk", a.squawk], ["ICAO hex", a.hex], ["Category", a.category],
      ["From ROR airport", a.dist_ror_nm != null ? `${fmt(a.dist_ror_nm)} NM, bearing ${fmt(a.bearing_from_ror)}°` : null],
      ["Airspace", a.in_eez ? "Over Palau EEZ" : "Outside Palau EEZ"],
      ["Heading for ROR?", a.inbound_ror ? "Likely: pointed at ROR and/or descending" : null],
      ["Seen", a.seen_s != null ? `${fmt(a.seen_s)} s before snapshot` : null],
      ["Source", a.source],
    ],
    warn,
    foot: "Community ADS-B. Aircraft out of receiver range are not shown.",
  });
}

export function quakeTip(f) {
  const p = f.properties, [lon, lat, depth] = f.geometry.coordinates;
  const d = haversineKm(KOROR, [lat, lon]);
  const warn = [];
  if (p.tsunami) warn.push("USGS tsunami flag set: check the tsunami bulletins");
  if (p.alert) warn.push(`PAGER alert: ${p.alert}`);
  return tt({
    title: `M ${fmt(p.mag, 1)} · ${p.place || "Earthquake"}`,
    rows: [
      ["Time", `${palauTime(p.time)} Palau (${utcTime(p.time)})`], ["", ago(p.time)],
      ["Depth", `${fmt(depth)} km (${depth < 70 ? "shallow" : depth < 300 ? "intermediate" : "deep"})`],
      ["From Koror", `${fmt(d)} km (${fmt(kmToNm(d))} NM)`],
      ["Magnitude type", p.magType], ["Felt reports", p.felt], ["Status", p.status],
    ],
    warn, foot: "USGS. Click to open the event page.",
  });
}

const GFW_LABEL = { fishing: "Apparent fishing", encounter: "Encounter (possible transshipment)", loitering: "Loitering", port_visit: "Port visit", gap: "AIS gap (transponder off)" };
export const gfwLabel = (t) => GFW_LABEL[t] || t;
export function gfwEventTip(e) {
  const v = e.vessel || {}, d = e.detail || {};
  const hours = e.start && e.end ? (new Date(e.end) - new Date(e.start)) / 3600000 : null;
  const rows = [
    ["Vessel", v.name], ["Flag", v.flag], ["MMSI", v.mmsi], ["Vessel type", v.type],
    ["Start", e.start ? `${palauTime(e.start)} Palau` : null], ["Duration", hours != null ? `${fmt(hours, 1)} h` : null],
    ["From shore", e.dist_shore_km != null ? `${fmt(e.dist_shore_km)} km` : null],
  ];
  if (e.type === "fishing") rows.push(["Distance", d.distance_km != null ? `${fmt(d.distance_km, 1)} km` : null], ["Avg speed", d.avg_speed_kn != null ? `${fmt(d.avg_speed_kn, 1)} kn` : null], ["Authorisation", d.authorization]);
  if (e.type === "encounter" && d.other_vessel) rows.push(["With", [d.other_vessel.name, d.other_vessel.flag, d.other_vessel.type].filter(Boolean).join(" · ")], ["Median distance", d.median_distance_km != null ? `${fmt(d.median_distance_km, 2)} km` : null]);
  if (e.type === "loitering") rows.push(["Loitering", d.hours != null ? `${fmt(d.hours, 1)} h` : null], ["Avg speed", d.avg_speed_kn != null ? `${fmt(d.avg_speed_kn, 1)} kn` : null]);
  if (e.type === "port_visit") rows.push(["Port", d.port]);
  if (e.type === "gap") rows.push(["Gap", d.hours != null ? `${fmt(d.hours, 1)} h` : null], ["Gap distance", d.distance_km != null ? `${fmt(d.distance_km)} km` : null], ["Likely intentional", d.intentional_disabling == null ? null : d.intentional_disabling ? "Yes" : "No"]);
  return tt({ title: gfwLabel(e.type), sub: "Global Fishing Watch event in Palau's EEZ", rows,
    warn: d.potential_risk ? ["GFW marks this event as potential risk"] : null,
    foot: "GFW data lags real time by about 3–5 days." });
}
