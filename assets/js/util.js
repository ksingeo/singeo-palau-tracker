// Shared helpers: safe DOM building, the global hover tooltip, formatting.

export const TZ = "Pacific/Palau";
export const KOROR = [7.3426, 134.4789];
export const ROR = [7.3673, 134.5442];

/** Create an element. Strings become text nodes (never parsed as HTML). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "tip") setTip(el, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/* ------------------------------------------------------------------ tooltip */
const tipFns = new WeakMap();
const namedTips = {};
export function setTip(el, fnOrNode) { tipFns.set(el, fnOrNode); el.setAttribute("data-has-tip", ""); }
export function registerTip(name, fn) { namedTips[name] = fn; }

let tipEl, current = null, lastXY = [0, 0];
const EXTERNAL = { external: true };  // owner marker for tips shown by charts
function tipFor(el) {
  if (tipFns.has(el)) { const t = tipFns.get(el); return typeof t === "function" ? t(el) : t; }
  if (el.dataset.tipFn && namedTips[el.dataset.tipFn]) return namedTips[el.dataset.tipFn](el);
  if (el.dataset.tip) return tt({ text: el.dataset.tip });
  return null;
}
function findTipTarget(node) {
  while (node && node !== document.body) {
    if (node.nodeType === 1 && (node.hasAttribute("data-has-tip") || node.dataset.tip || node.dataset.tipFn)) return node;
    node = node.parentNode;
  }
  return null;
}
export function showTip(content, x, y) {
  if (!content) return hideTip();
  current = EXTERNAL;
  clear(tipEl).append(content);
  tipEl.hidden = false;
  placeTip(x, y);
}
export function hideTip() { if (tipEl) tipEl.hidden = true; current = null; }
function placeTip(x, y) {
  const pad = 14, r = tipEl.getBoundingClientRect();
  let left = x + pad, top = y + pad;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - pad);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - pad);
  tipEl.style.left = `${left}px`; tipEl.style.top = `${top}px`;
}
export function initTooltips() {
  tipEl = document.getElementById("tooltip");
  document.addEventListener("pointermove", (e) => {
    lastXY = [e.clientX, e.clientY];
    if (e.target.closest && e.target.closest(".leaflet-container") && !e.target.closest(".leaflet-control")) {
      if (current) hideTip();
      return;  // Leaflet draws its own tooltips on the map
    }
    const t = findTipTarget(e.target);
    if (!t) { if (current && current !== EXTERNAL) hideTip(); return; }
    if (t !== current) { showTip(tipFor(t), e.clientX, e.clientY); current = t; }
    else if (!tipEl.hidden) placeTip(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener("pointerleave", hideTip);
  document.addEventListener("scroll", hideTip, { passive: true, capture: true });
  document.addEventListener("focusin", (e) => {
    const t = findTipTarget(e.target);
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(tipFor(t), r.left + 10, r.bottom); current = t;
  });
  document.addEventListener("focusout", hideTip);
}
/** Re-render the open tooltip (used by charts that update on pointer move). */
export function updateTip(content) { if (tipEl && !tipEl.hidden) { clear(tipEl).append(content); placeTip(...lastXY); } }

/** Standard tooltip body. rows: [[label, value], ...] (null values skipped). */
export function tt({ title, sub, rows, text, warn, foot, extra } = {}) {
  const box = h("div", { class: "tt" });
  if (title) box.append(h("div", { class: "tt-h" }, title));
  if (sub) box.append(h("div", { class: "tt-s" }, sub));
  if (text) box.append(h("div", { class: "tt-p" }, text));
  const r = (rows || []).filter((x) => x && x[1] != null && x[1] !== "" && !(typeof x[1] === "number" && isNaN(x[1])));
  if (r.length) box.append(h("div", { class: "tt-tbl" }, r.flatMap(([k, v]) => [h("div", { class: "k" }, k), h("div", { class: "v" }, v)])));
  if (extra) box.append(extra);
  if (warn && warn.length) box.append(h("div", { class: "tt-warn" }, warn.map((w) => h("div", null, w))));
  if (foot) box.append(h("div", { class: "tt-foot" }, foot));
  return box;
}

/* ------------------------------------------------------------------ format */
export const fmt = (n, d = 0) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
export function toDate(x) { if (x == null) return null; if (x instanceof Date) return x; const d = new Date(typeof x === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(x) && x.includes("T") ? x + "Z" : x); return isNaN(d) ? null : d; }
export function palauTime(x, opts = {}) {
  const d = toDate(x); if (!d) return "–";
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, ...opts });
}
export function utcTime(x) {
  const d = toDate(x); if (!d) return "–";
  return d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
}
export function ago(x) {
  const d = toDate(x); if (!d) return "–";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) { const f = -s; if (f < 3600) return `in ${Math.round(f / 60)} min`; if (f < 86400) return `in ${Math.round(f / 3600)} h`; return `in ${Math.round(f / 86400)} d`; }
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const when = (x) => `${palauTime(x)} Palau · ${ago(x)}`;
export function compass(deg) {
  if (deg == null || isNaN(deg)) return "–";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return `${Math.round(deg)}° ${dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]}`;
}
export function haversineKm(a, b) {
  const R = 6371.0088, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const kmToNm = (km) => km / 1.852;

/* ------------------------------------------------------------------ fetch / storage */
export async function fetchJSON(url, { timeout = 20000, bust = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const u = bust ? url + (url.includes("?") ? "&" : "?") + "_=" + Math.floor(Date.now() / 60000) : url;
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** Read a CSS custom property (theme-aware colour). */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function pill(level, label) {
  const icon = { good: "✓", warning: "!", serious: "▲", critical: "✖", neutral: "•" }[level] || "•";
  return h("span", { class: `pill ${level}` }, icon, " ", label);
}
