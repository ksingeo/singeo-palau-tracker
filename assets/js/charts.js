// Small dependency-free SVG charts with a hover layer (crosshair on lines,
// per-mark hover on bars and dots). One y-axis per chart, always.
import { clear, cssVar, h, hideTip, s, showTip, tt } from "./util.js";

const M = { t: 8, r: 10, b: 22, l: 38 };
const observers = new WeakMap();

function frame(el, { title, sub, legend }) {
  clear(el);
  if (title) el.append(h("div", { class: "c-title" }, title));
  if (sub) el.append(h("div", { class: "c-sub" }, sub));
  const holder = h("div");
  el.append(holder);
  if (legend && legend.length > 1) {
    el.append(h("div", { class: "legend-inline" }, legend.map((l) =>
      h("span", null, h("i", { class: l.rect ? "rect" : "", style: l.rect ? { background: l.color } : { borderColor: l.color, borderTopStyle: l.dash ? "dashed" : "solid" } }), l.name))));
  }
  return holder;
}
function onResize(el, draw) {
  if (observers.has(el)) observers.get(el).disconnect();
  let w = 0;
  const ro = new ResizeObserver(() => { const nw = el.clientWidth; if (Math.abs(nw - w) > 4) { w = nw; draw(); } });
  ro.observe(el); observers.set(el, ro);
}
function niceTicks(min, max, n = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= n) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
export function empty(el, title, msg) {
  clear(el);
  if (title) el.append(h("div", { class: "c-title" }, title));
  el.append(h("div", { class: "chart-empty" }, msg));
}
const color = (c) => (c && c.startsWith("--") ? cssVar(c) : c);

/**
 * Line / area chart with a snapping crosshair.
 * opts: { title, sub, x: Date[], series: [{name, values, color, area, dash, fmt}], yFmt, xFmt,
 *         yMin, yMax, threshold: {value, label}, height, tipTitle(i) }
 */
export function lineChart(el, opts) {
  const { x, series } = opts;
  if (!x || !x.length) return empty(el, opts.title, opts.emptyMsg || "No data yet");
  const holder = frame(el, { ...opts, legend: series.map((se) => ({ name: se.name, color: color(se.color), dash: se.dash })) });
  const draw = () => {
    clear(holder);
    const W = Math.max(240, holder.clientWidth || el.clientWidth || 400), H = opts.height || 150;
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const vals = series.flatMap((se) => se.values.filter((v) => v != null));
    let yMin = opts.yMin ?? Math.min(...vals), yMax = opts.yMax ?? Math.max(...vals);
    if (opts.threshold) { yMin = Math.min(yMin, opts.threshold.value); yMax = Math.max(yMax, opts.threshold.value); }
    if (opts.zero !== false && yMin > 0 && opts.yMin == null && opts.fromZero) yMin = 0;
    const ticks = niceTicks(yMin, yMax, 4);
    yMin = ticks[0]; yMax = ticks[ticks.length - 1];
    const t0 = +x[0], t1 = +x[x.length - 1] || t0 + 1;
    const X = (d) => M.l + ((+d - t0) / (t1 - t0 || 1)) * iw;
    const Y = (v) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.title || "chart" });
    const g = s("g", { class: "axis" });
    ticks.forEach((tv) => {
      g.append(s("line", { class: "grid-line", x1: M.l, x2: W - M.r, y1: Y(tv), y2: Y(tv) }));
      g.append(s("text", { x: M.l - 6, y: Y(tv) + 3.5, "text-anchor": "end" }, (opts.yFmt || String)(tv)));
    });
    const nx = Math.max(2, Math.min(6, Math.floor(iw / 80)));
    for (let i = 0; i <= nx; i++) {
      const t = new Date(t0 + ((t1 - t0) * i) / nx);
      g.append(s("text", { x: X(t), y: H - 6, "text-anchor": i === 0 ? "start" : i === nx ? "end" : "middle" }, (opts.xFmt || defaultXFmt(t1 - t0))(t)));
    }
    g.append(s("line", { class: "baseline", x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }));
    svg.append(g);
    if (opts.threshold) {
      const ty = Y(opts.threshold.value);
      svg.append(s("line", { class: "threshold", x1: M.l, x2: W - M.r, y1: ty, y2: ty }));
      svg.append(s("text", { class: "threshold-label", x: W - M.r, y: ty - 4, "text-anchor": "end" }, opts.threshold.label));
    }
    series.forEach((se) => {
      const c = color(se.color);
      let d = "", pen = false;
      se.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${X(x[i]).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
      });
      if (se.area) {
        const idx = se.values.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
        if (idx.length) {
          const a = `${d}L${X(x[idx[idx.length - 1]]).toFixed(1)},${Y(Math.max(yMin, 0)).toFixed(1)}L${X(x[idx[0]]).toFixed(1)},${Y(Math.max(yMin, 0)).toFixed(1)}Z`;
          svg.append(s("path", { d: a, fill: c, "fill-opacity": 0.16, stroke: "none" }));
        }
      }
      svg.append(s("path", { d, fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": se.dash ? "5 4" : null }));
      (se.markers || []).forEach((m) => {
        svg.append(s("circle", { cx: X(m.x), cy: Y(m.y), r: 4, fill: c, stroke: cssVar("--surface-1"), "stroke-width": 2 }));
        if (m.label) svg.append(s("text", { x: X(m.x), y: Y(m.y) + (m.below ? 14 : -7), "text-anchor": "middle", class: "axis", style: "fill: var(--text-secondary); font-size: 10px" }, m.label));
      });
    });
    // hover layer
    const cross = s("line", { class: "crosshair", y1: M.t, y2: M.t + ih, visibility: "hidden" });
    const dots = series.map((se) => s("circle", { r: 4, fill: color(se.color), stroke: cssVar("--surface-1"), "stroke-width": 2, visibility: "hidden" }));
    svg.append(cross, ...dots);
    const hit = s("rect", { x: M.l, y: M.t, width: iw, height: ih, fill: "transparent", style: "cursor: crosshair" });
    svg.append(hit);
    const nearest = (px) => {
      const t = t0 + ((px - M.l) / iw) * (t1 - t0);
      let lo = 0, hi = x.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (+x[mid] < t) lo = mid; else hi = mid; }
      return Math.abs(+x[lo] - t) < Math.abs(+x[hi] - t) ? lo : hi;
    };
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = nearest(px);
      cross.setAttribute("x1", X(x[i])); cross.setAttribute("x2", X(x[i])); cross.setAttribute("visibility", "visible");
      series.forEach((se, k) => {
        const v = se.values[i];
        if (v == null) { dots[k].setAttribute("visibility", "hidden"); return; }
        dots[k].setAttribute("cx", X(x[i])); dots[k].setAttribute("cy", Y(v)); dots[k].setAttribute("visibility", "visible");
      });
      const rowsEl = h("div", null, series.map((se) => h("div", { class: "tt-row" },
        h("i", { style: { borderColor: color(se.color), borderTopStyle: se.dash ? "dashed" : "solid" } }),
        h("b", null, se.values[i] == null ? "–" : (se.fmt || opts.yFmt || String)(se.values[i])), se.name)));
      const extra = opts.tipExtra ? opts.tipExtra(i) : null;
      showTip(tt({ title: opts.tipTitle ? opts.tipTitle(i) : defaultTipTitle(x[i]), extra: h("div", null, rowsEl, extra) }), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); });
    holder.append(svg);
  };
  draw(); onResize(el, draw);
}

/** Vertical bars on a time/category axis. opts: {title, labels, values, color, yFmt, tip(i), xLabelEvery} */
export function barChart(el, opts) {
  const { labels, values } = opts;
  if (!values || !values.length) return empty(el, opts.title, opts.emptyMsg || "No data yet");
  const holder = frame(el, opts);
  const draw = () => {
    clear(holder);
    const W = Math.max(240, holder.clientWidth || 400), H = opts.height || 150;
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const ticks = niceTicks(0, Math.max(opts.yMax || 0, ...values.map((v) => v || 0)), 4);
    const yMax = ticks[ticks.length - 1];
    const Y = (v) => M.t + ih - (v / (yMax || 1)) * ih;
    const bw = iw / values.length, gap = Math.min(2, bw * 0.2);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.title || "bar chart" });
    const g = s("g", { class: "axis" });
    ticks.forEach((tv) => {
      g.append(s("line", { class: "grid-line", x1: M.l, x2: W - M.r, y1: Y(tv), y2: Y(tv) }));
      g.append(s("text", { x: M.l - 6, y: Y(tv) + 3.5, "text-anchor": "end" }, (opts.yFmt || String)(tv)));
    });
    const every = opts.xLabelEvery || Math.ceil(values.length / Math.max(2, Math.floor(iw / 60)));
    labels.forEach((l, i) => { if (i % every === 0) g.append(s("text", { x: M.l + bw * i + bw / 2, y: H - 6, "text-anchor": "middle" }, l)); });
    svg.append(g);
    values.forEach((v, i) => {
      const c = color(typeof opts.color === "function" ? opts.color(i, v) : opts.color || "--s1");
      const x0 = M.l + bw * i + gap / 2, w = Math.max(1, bw - gap), y = Y(v || 0), hgt = M.t + ih - y;
      const r = Math.min(4, w / 2, hgt);
      const path = hgt > 0 ? `M${x0},${M.t + ih}V${y + r}Q${x0},${y} ${x0 + r},${y}H${x0 + w - r}Q${x0 + w},${y} ${x0 + w},${y + r}V${M.t + ih}Z` : "";
      if (path) svg.append(s("path", { d: path, fill: c, class: "bar" }));
      const hit = s("rect", { x: M.l + bw * i, y: M.t, width: bw, height: ih, fill: "transparent" });
      hit.addEventListener("pointermove", (e) => showTip(opts.tip ? opts.tip(i) : tt({ title: labels[i], rows: [["Value", (opts.yFmt || String)(v)]] }), e.clientX, e.clientY));
      hit.addEventListener("pointerleave", hideTip);
      svg.append(hit);
    });
    svg.append(s("line", { class: "baseline", x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }));
    holder.append(svg);
  };
  draw(); onResize(el, draw);
}

/** Horizontal bars, label + value, sorted by caller. opts {title, rows:[{label, value, tip}], fmt, color} */
export function hbarChart(el, opts) {
  const rows = opts.rows || [];
  if (!rows.length) return empty(el, opts.title, opts.emptyMsg || "No data yet");
  const holder = frame(el, opts);
  const draw = () => {
    clear(holder);
    const W = Math.max(240, holder.clientWidth || 400), rowH = 22, lw = Math.min(130, W * 0.36), vw = 60;
    const H = rows.length * rowH + 4, iw = W - lw - vw;
    const max = Math.max(...rows.map((r) => r.value), 1);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.title || "bar chart" });
    rows.forEach((r, i) => {
      const y = i * rowH + 3, w = Math.max(2, (r.value / max) * iw), c = color(opts.color || "--s1");
      const g = s("g");
      g.append(s("text", { x: lw - 8, y: y + 13, "text-anchor": "end", class: "axis", style: "fill: var(--text-primary); font-size: 11.5px" }, r.label));
      const rr = Math.min(4, w / 2);
      g.append(s("path", { class: "bar", fill: c, d: `M${lw},${y + 2}H${lw + w - rr}Q${lw + w},${y + 2} ${lw + w},${y + 2 + rr}V${y + 16 - rr}Q${lw + w},${y + 16} ${lw + w - rr},${y + 16}H${lw}Z` }));
      g.append(s("text", { x: lw + w + 6, y: y + 13, class: "axis", style: "fill: var(--text-secondary); font-size: 11px" }, (opts.fmt || String)(r.value)));
      const hit = s("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" });
      hit.addEventListener("pointermove", (e) => showTip(r.tip || tt({ title: r.label, rows: [["Value", (opts.fmt || String)(r.value)]] }), e.clientX, e.clientY));
      hit.addEventListener("pointerleave", hideTip);
      g.append(hit);
      svg.append(g);
    });
    holder.append(svg);
  };
  draw(); onResize(el, draw);
}

/** Time scatter (e.g. earthquakes: time vs magnitude). points: [{t, y, r, color, tip}] */
export function scatterChart(el, opts) {
  const pts = opts.points || [];
  if (!pts.length) return empty(el, opts.title, opts.emptyMsg || "No data");
  const holder = frame(el, opts);
  const draw = () => {
    clear(holder);
    const W = Math.max(240, holder.clientWidth || 400), H = opts.height || 140;
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const t0 = opts.t0 ?? Math.min(...pts.map((p) => +p.t)), t1 = opts.t1 ?? Math.max(...pts.map((p) => +p.t));
    const ticks = niceTicks(opts.yMin ?? Math.min(...pts.map((p) => p.y)), opts.yMax ?? Math.max(...pts.map((p) => p.y)), 3);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const X = (t) => M.l + ((+t - t0) / (t1 - t0 || 1)) * iw;
    const Y = (v) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.title || "scatter" });
    const g = s("g", { class: "axis" });
    ticks.forEach((tv) => {
      g.append(s("line", { class: "grid-line", x1: M.l, x2: W - M.r, y1: Y(tv), y2: Y(tv) }));
      g.append(s("text", { x: M.l - 6, y: Y(tv) + 3.5, "text-anchor": "end" }, (opts.yFmt || String)(tv)));
    });
    const nx = Math.max(2, Math.min(6, Math.floor(iw / 80)));
    for (let i = 0; i <= nx; i++) {
      const t = new Date(t0 + ((t1 - t0) * i) / nx);
      g.append(s("text", { x: X(t), y: H - 6, "text-anchor": i === 0 ? "start" : i === nx ? "end" : "middle" }, defaultXFmt(t1 - t0)(t)));
    }
    g.append(s("line", { class: "baseline", x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih }));
    svg.append(g);
    pts.forEach((p) => {
      const cx = X(p.t), cy = Y(p.y);
      const dot = s("circle", { cx, cy, r: p.r || 4, fill: color(p.color || "--s1"), "fill-opacity": 0.75, stroke: cssVar("--surface-1"), "stroke-width": 2 });
      const hit = s("circle", { cx, cy, r: Math.max(12, (p.r || 4) + 6), fill: "transparent" });
      hit.addEventListener("pointermove", (e) => { dot.setAttribute("fill-opacity", 1); showTip(p.tip, e.clientX, e.clientY); });
      hit.addEventListener("pointerleave", () => { dot.setAttribute("fill-opacity", 0.75); hideTip(); });
      if (p.onClick) hit.addEventListener("click", p.onClick);
      svg.append(dot, hit);
    });
    holder.append(svg);
  };
  draw(); onResize(el, draw);
}

function defaultXFmt(span) {
  const day = 86400000;
  if (span <= 0.75 * day) return (d) => d.toLocaleTimeString("en-US", { timeZone: "Pacific/Palau", hour: "2-digit", minute: "2-digit", hour12: false });
  if (span <= 2.5 * day) return (d) => d.toLocaleString("en-US", { timeZone: "Pacific/Palau", weekday: "short", hour: "2-digit", hour12: false }).replace(",", "");
  if (span <= 60 * day) return (d) => d.toLocaleString("en-US", { timeZone: "Pacific/Palau", month: "short", day: "numeric" });
  return (d) => d.toLocaleString("en-US", { timeZone: "Pacific/Palau", month: "short", year: "2-digit" });
}
function defaultTipTitle(d) {
  return d.toLocaleString("en-US", { timeZone: "Pacific/Palau", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " Palau";
}
