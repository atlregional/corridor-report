/* Shared chart and table helpers. Every chart has an HTML legend, an aria-label summary,
   and a data table twin (built by the section that draws it). Legends with group ids are
   buttons that show or hide a series in every chart of that group. */

// one per analysis period, oldest to newest: one hue, light to dark (adjacent ΔE ≥ 16 for all color vision types).
// The lightest step is below 3:1 contrast, so every chart has a data table and labeled legend.
const SERIES_COLORS = ['#93bdf0', '#3f86de', '#0f3f86'];
const SINGLE_COLOR = '#2a6fd8';   // charts with one series
const INK = '#1f2328';
const INK_SECONDARY = '#4f5560';
const GRID = '#e1e0d9';
const AXIS = '#c3c2b7';

const charts = {};        // id -> object with destroy()
let legendGroups = {};    // group -> [fn(seriesIndex, visible)]

Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 13;
Chart.defaults.color = INK_SECONDARY;
// change only the duration: replacing the whole animation object drops its easing function and breaks
// every animation, including tooltips (they fade in) and redraws after a legend toggle
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
else Chart.defaults.animation.duration = 300;

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function resetCharts() {
    Object.values(charts).forEach(ch => ch.destroy());
    Object.keys(charts).forEach(k => delete charts[k]);
    legendGroups = {};
    Tooltip.hide();
}

/* ---------- legends ---------- */

function legendHtml(labels, colors = SERIES_COLORS, group = null) {
    if (!group) {
        return `<div class="chart-legend" aria-hidden="true">${labels.map((l, k) =>
            `<span><i style="background:${colors[k % colors.length]}"></i>${esc(l)}</span>`).join('')}</div>`;
    }
    return `<div class="chart-legend" role="group" aria-label="Show or hide series in the charts below">${labels.map((l, k) =>
        `<button type="button" class="legend-toggle" aria-pressed="true" data-group="${esc(group)}" data-series="${k}">
            <i style="background:${colors[k % colors.length]}"></i>${esc(l)}</button>`).join('')}</div>`;
}

function onLegend(group, fn) {
    (legendGroups[group] ??= []).push(fn);
}

document.addEventListener('click', e => {
    const btn = e.target.closest('.legend-toggle');
    if (!btn) return;
    const visible = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(visible));
    (legendGroups[btn.dataset.group] ?? []).forEach(fn => fn(+btn.dataset.series, visible));
});

/* hide/show every dataset of a series in a Chart.js chart */
function chartLegendHandler(chart) {
    return (k, visible) => {
        chart.data.datasets.forEach((ds, i) => { if (ds.seriesIndex === k) chart.setDatasetVisibility(i, visible); });
        chart.update();
    };
}

/* ---------- tables ---------- */

function tableHtml(caption, headers, rows, { hiddenCaption = false } = {}) {
    return `<div class="table-wrap"><table class="data-table">
        <caption${hiddenCaption ? ' class="visually-hidden"' : ''}>${esc(caption)}</caption>
        <thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map((c, k) => k === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

function dataTableDetails(caption, headers, rows, summary = 'Show data table') {
    return `<details><summary>${esc(summary)}</summary>${tableHtml(caption, headers, rows)}</details>`;
}

function chartCanvas(id, label, { cls = '', height = null } = {}) {
    const style = height ? ` style="height:${height}px"` : '';
    return `<div class="chart ${cls}"${style}><canvas id="${id}" role="img" aria-label="${esc(label)}"></canvas></div>`;
}

function chartSvg(id, label, cls = '') {
    return `<div class="chart svg-chart ${cls}" id="${id}" role="img" aria-label="${esc(label)}"></div>`;
}

/* ---------- tooltip for SVG and HTML charts (Chart.js draws its own) ---------- */

const Tooltip = {
    el: null,
    show(html, x, y) {
        if (!this.el) {
            this.el = document.createElement('div');
            this.el.className = 'chart-tooltip';
            this.el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(this.el);
        }
        this.el.innerHTML = html;
        this.el.hidden = false;
        const r = this.el.getBoundingClientRect();
        const left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
        const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
        this.el.style.left = `${left}px`;
        this.el.style.top = `${top}px`;
    },
    hide() { if (this.el) this.el.hidden = true; },
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') Tooltip.hide(); });
document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && !e.target.closest('.svg-chart, .condition-bar')) Tooltip.hide();
});

/* show a tooltip for elements matching selector inside container; html(el) builds the content */
function bindTooltip(container, selector, html) {
    const show = (el, x, y) => Tooltip.show(html(el), x, y);
    const atPointer = e => {
        const el = e.target.closest(selector);
        el ? show(el, e.clientX, e.clientY) : Tooltip.hide();
    };
    container.addEventListener('pointermove', atPointer);
    container.addEventListener('pointerdown', atPointer);     // a tap on touch screens
    // a lifted finger also "leaves"; touch tooltips stay until the next tap elsewhere
    container.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') Tooltip.hide(); });
    container.addEventListener('focusin', e => {
        const el = e.target.closest(selector);
        if (!el) return;
        const r = el.getBoundingClientRect();
        show(el, r.left + r.width / 2, r.top);
    });
    container.addEventListener('focusout', () => Tooltip.hide());
}

/* ---------- Chart.js charts ---------- */

/* vertical line at the hovered x position */
const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
        const active = chart.tooltip?.getActiveElements?.() ?? [];
        if (!active.length) return;
        const x = active[0].element.x;
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = '#8a8f98';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.restore();
    },
};

function tooltipStyle() {
    return { backgroundColor: '#ffffff', titleColor: INK, bodyColor: INK, borderColor: AXIS, borderWidth: 1,
             padding: 10, boxPadding: 4, usePointStyle: true };
}

/* Bar chart, one dataset per period (grouped), single y axis. */
function barChart(id, { labels, series, yTitle, horizontal = false, max = null, colors = SERIES_COLORS, valueSuffix = '', group = null }) {
    charts[id]?.destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;

    const valueAxis = {
        beginAtZero: true,
        max: max ?? undefined,
        title: { display: !!yTitle, text: yTitle, color: INK_SECONDARY },
        grid: { color: GRID },
        border: { display: false },
        ticks: { callback: v => fmt(v) + valueSuffix },
    };
    const categoryAxis = { grid: { display: false }, border: { color: AXIS }, ticks: { color: INK } };

    const chart = charts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: series.map((s, k) => ({
                label: s.label,
                data: s.data,
                seriesIndex: k,
                backgroundColor: colors[k % colors.length],
                hoverBackgroundColor: colors[k % colors.length],
                borderRadius: 4,
                borderSkipped: 'start',
                maxBarThickness: 28,
                categoryPercentage: 0.75,
                barPercentage: 0.9,
            })),
        },
        options: {
            indexAxis: horizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
            scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle(),
                    callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed[horizontal ? 'x' : 'y'], valueSuffix === '%' ? 1 : 0)}${valueSuffix}` },
                },
            },
        },
    });
    if (group) onLegend(group, chartLegendHandler(chart));
}

/* Line chart over a category axis, one line per series; an optional band (25th–75th
   percentile) is drawn under a series. Shared yMin/yMax keep small multiples comparable. */
function lineChart(id, { labels, series, yTitle, yMin, yMax, unit = '', digits = 1, group = null, points = false, maxTicks = 8,
                         lineWidth = 2, pointRadius = 4 }) {
    charts[id]?.destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;

    const datasets = [];
    series.forEach((s, k) => {
        const color = s.color ?? SERIES_COLORS[k % SERIES_COLORS.length];
        datasets.push({
            label: s.label, data: s.data, seriesIndex: k, band: s.band,
            borderColor: color, backgroundColor: color, borderWidth: lineWidth, borderDash: s.dashed ? [6, 4] : [],
            pointRadius: points ? pointRadius : 0, pointHoverRadius: points ? pointRadius + 2 : 5, pointHitRadius: 12,
            pointBorderColor: '#ffffff', pointBorderWidth: points ? 2 : 1,
            spanGaps: true, order: 1,
        });
        if (s.band) {
            // 75th percentile filled down to the 25th (the next dataset)
            datasets.push({ label: `${s.label} 75th`, data: s.band[1], seriesIndex: k, isBand: true, fill: '+1',
                            backgroundColor: color + '24', borderWidth: 0, pointRadius: 0, pointHitRadius: 0, order: 2 });
            datasets.push({ label: `${s.label} 25th`, data: s.band[0], seriesIndex: k, isBand: true, fill: false,
                            borderWidth: 0, pointRadius: 0, pointHitRadius: 0, order: 2 });
        }
    });

    const chart = charts[id] = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        plugins: [crosshair],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false }, border: { color: AXIS },
                     ticks: { color: INK, autoSkip: true, maxTicksLimit: maxTicks, maxRotation: 0 } },
                y: { min: yMin, max: yMax, grid: { color: GRID }, border: { display: false },
                     title: { display: !!yTitle, text: yTitle, color: INK_SECONDARY },
                     ticks: { callback: v => fmt(v) } },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...tooltipStyle(),
                    filter: item => !item.dataset.isBand,
                    callbacks: {
                        label: c => {
                            const b = c.dataset.band;
                            const range = b && b[0][c.dataIndex] != null
                                ? ` (typical ${fmt(b[0][c.dataIndex], digits)}–${fmt(b[1][c.dataIndex], digits)})` : '';
                            return ` ${c.dataset.label}: ${fmt(c.parsed.y, digits)}${unit}${range}`;
                        },
                    },
                },
            },
        },
    });
    if (group) onLegend(group, chartLegendHandler(chart));
}

/* Radar chart on a 0–max scale; each series is a polygon (dashed: a reference such as the average). */
function radarChart(id, { labels, series, max, digits = 1 }) {
    charts[id]?.destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;
    charts[id] = new Chart(canvas, {
        type: 'radar',
        data: {
            labels,
            datasets: series.map(s => ({
                label: s.label, data: s.data,
                borderColor: s.color, backgroundColor: s.fill ?? 'transparent', borderWidth: s.dashed ? 2 : 3,
                borderDash: s.dashed ? [6, 4] : [], pointRadius: s.dashed ? 0 : 5, pointHoverRadius: 7, pointHitRadius: 14,
                pointBackgroundColor: s.color, pointBorderColor: '#ffffff', pointBorderWidth: 1.5,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                r: {
                    min: 0, max, ticks: { stepSize: 1, backdropColor: 'transparent', color: INK_SECONDARY },
                    grid: { color: GRID }, angleLines: { color: GRID },
                    pointLabels: { color: INK, font: { size: 13 } },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle(), callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.r, digits)}` } },
            },
        },
    });
}

/* Horizontal floating bars: one [low, high] range per category and series. tip(k, i) gives
   the tooltip line for series k, category i. */
function rangeChart(id, { labels, series, xTitle, min, max, tip, group = null }) {
    charts[id]?.destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const chart = charts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: series.map((s, k) => ({
                label: s.label, data: s.data, seriesIndex: k,
                backgroundColor: SERIES_COLORS[k % SERIES_COLORS.length],
                hoverBackgroundColor: SERIES_COLORS[k % SERIES_COLORS.length],
                borderRadius: 4, borderSkipped: false, maxBarThickness: 14,
                categoryPercentage: 0.8, barPercentage: 0.9,
            })),
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: true },   // one bar (year) at a time
            scales: {
                x: { min, max, grid: { color: GRID }, border: { display: false },
                     title: { display: !!xTitle, text: xTitle, color: INK_SECONDARY } },
                y: { grid: { display: false }, border: { color: AXIS }, ticks: { color: INK } },
            },
            plugins: {
                legend: { display: false },
                tooltip: { ...tooltipStyle(), callbacks: { label: c => ` ${tip(c.datasetIndex, c.dataIndex)}` } },
            },
        },
    });
    if (group) onLegend(group, chartLegendHandler(chart));
}

/* ---------- SVG charts ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function niceTicks(min, max, count = 5) {
    const step0 = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
}

/* Redraw an SVG chart whenever its container changes width. draw(width) returns the SVG markup. */
function svgChart(id, draw) {
    const el = document.getElementById(id);
    if (!el) return null;
    let width = 0;
    const render = () => {
        const w = Math.round(el.clientWidth);
        if (!w || w === width) return;
        width = w;
        el.innerHTML = draw(w);
    };
    const ro = new ResizeObserver(render);
    ro.observe(el);
    render();
    const handle = { el, redraw: () => { width = 0; render(); }, destroy: () => ro.disconnect() };
    charts[id] = handle;
    return handle;
}

/* Candlestick chart: per category (weekday), one candle per series (period).
   values[cat] = [p5, p25, mean, p75, p95]. Whiskers 5th–95th, box 25th–75th, dot = average. */
function candleChart(id, { categories, categoryNames = {}, series, yMin, yMax, yTitle, unit = ' min', group = null }) {
    const hidden = new Set();
    const H = 270, M = { top: 10, right: 8, bottom: 30, left: 46 };
    const handle = svgChart(id, W => {
        const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
        const y = v => M.top + ph - (v - yMin) / (yMax - yMin) * ph;
        const band = pw / categories.length;
        const shown = series.map((s, k) => k).filter(k => !hidden.has(k));
        const slot = band * 0.8 / Math.max(shown.length, 1);
        const cw = Math.min(slot * 0.6, 18);
        let out = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`;
        niceTicks(yMin, yMax).forEach(t => {
            out += `<line x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}"/>
                    <text x="${M.left - 6}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="${INK_SECONDARY}">${fmt(t)}</text>`;
        });
        if (yTitle) out += `<text transform="translate(12 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${INK_SECONDARY}">${esc(yTitle)}</text>`;
        out += `<line x1="${M.left}" x2="${W - M.right}" y1="${M.top + ph}" y2="${M.top + ph}" stroke="${AXIS}"/>`;
        categories.forEach((cat, ci) => {
            const x0 = M.left + ci * band;
            out += `<text x="${x0 + band / 2}" y="${H - 8}" text-anchor="middle" font-size="13" fill="${INK}">${esc(cat)}</text>`;
            shown.forEach((k, si) => {
                const v = series[k].values[cat];
                if (!v || v.some(n => n == null || Number.isNaN(n))) return;
                const cx = x0 + band * 0.1 + slot * (si + 0.5);
                const color = SERIES_COLORS[k % SERIES_COLORS.length];
                out += `<g class="candle" data-k="${k}" data-cat="${esc(cat)}">
                    <rect x="${cx - slot / 2}" y="${M.top}" width="${slot}" height="${ph}" fill="transparent"/>
                    <line x1="${cx}" x2="${cx}" y1="${y(v[4])}" y2="${y(v[0])}" stroke="${color}" stroke-width="2"/>
                    <line x1="${cx - cw * 0.35}" x2="${cx + cw * 0.35}" y1="${y(v[4])}" y2="${y(v[4])}" stroke="${color}" stroke-width="2"/>
                    <line x1="${cx - cw * 0.35}" x2="${cx + cw * 0.35}" y1="${y(v[0])}" y2="${y(v[0])}" stroke="${color}" stroke-width="2"/>
                    <rect class="candle-box" x="${cx - cw / 2}" y="${y(v[3])}" width="${cw}" height="${Math.max(y(v[1]) - y(v[3]), 2)}" rx="2" fill="${color}"/>
                    <circle cx="${cx}" cy="${y(v[2])}" r="3.5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>
                </g>`;
            });
        });
        return out + '</svg>';
    });
    if (!handle) return;
    bindTooltip(handle.el, '.candle', g => {
        const k = +g.dataset.k, cat = g.dataset.cat;
        const v = series[k].values[cat];
        return `<strong>${esc(categoryNames[cat] ?? cat)}, ${esc(series[k].label)}</strong>
            <span>Average: ${fmt(v[2], 1)}${unit}</span>
            <span>Typical (25th–75th): ${fmt(v[1], 1)}–${fmt(v[3], 1)}${unit}</span>
            <span>Best/worst days (5th–95th): ${fmt(v[0], 1)}–${fmt(v[4], 1)}${unit}</span>`;
    });
    if (group) onLegend(group, (k, visible) => { visible ? hidden.delete(k) : hidden.add(k); handle.redraw(); });
}

/* Dot plot: one dot per item, stacked in columns by integer value. The highlighted item is
   drawn larger in the accent color; other dots can be clicked (onSelect). */
function dotPlot(id, { items, highlight, valueLabel, tip, onSelect }) {
    const values = items.map(d => d.value);
    const lo = Math.min(...values), hi = Math.max(...values);
    const cols = hi - lo + 1;
    const counts = Array(cols).fill(0);
    const placed = items.slice().sort((a, b) => (a.id === highlight) - (b.id === highlight)).map(d => {
        const c = d.value - lo;
        return { ...d, col: c, n: counts[c]++ };
    });
    const maxCount = Math.max(...counts);
    let layout = [];
    const M = { top: 34, right: 8, bottom: 34, left: 8 };

    const handle = svgChart(id, W => {
        const pw = W - M.left - M.right;
        // dots per row inside a column: as many as fit while keeping dots at least 6 px apart
        let sub = 4, pitch;
        for (; sub >= 1; sub--) {
            pitch = Math.min(12, pw / (cols * (sub + 1)));
            if (pitch >= 6 || sub === 1) break;
        }
        const colW = pitch * (sub + 1);
        const x0 = M.left + (pw - colW * cols) / 2;
        const rows = Math.ceil(maxCount / sub);
        const H = M.top + rows * pitch + M.bottom;
        const r = pitch * 0.38;
        layout = [];
        let out = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`;
        const base = M.top + rows * pitch;
        out += `<line x1="${x0}" x2="${x0 + colW * cols}" y1="${base + 2}" y2="${base + 2}" stroke="${AXIS}"/>`;
        // label every column when there is room (about 24 px per label), otherwise every 2nd, 3rd, ...
        for (let c = 0, step = Math.max(1, Math.ceil(24 / colW)); c < cols; c += step) {
            out += `<text x="${x0 + colW * (c + 0.5)}" y="${base + 18}" text-anchor="middle" font-size="12" fill="${INK_SECONDARY}">${esc(valueLabel(lo + c))}</text>`;
        }
        placed.forEach(d => {
            const cx = x0 + colW * d.col + pitch * (d.n % sub + 1);
            const cy = base - pitch * (Math.floor(d.n / sub) + 0.5);
            layout.push({ d, cx, cy });
            if (d.id !== highlight) out += `<circle class="dot" cx="${cx}" cy="${cy}" r="${r}" fill="#9aa3ae"/>`;
        });
        // the highlighted corridor last, with a leader line to a label above all columns
        const h = layout.find(p => p.d.id === highlight);
        if (h) {
            const anchor = h.cx < W * 0.2 ? 'start' : h.cx > W * 0.8 ? 'end' : 'middle';
            out += `<line x1="${h.cx}" x2="${h.cx}" y1="${M.top - 4}" y2="${h.cy - r - 3}" stroke="${INK}" stroke-width="1.5"/>
                <circle cx="${h.cx}" cy="${h.cy}" r="${r + 3}" fill="#d03b3b" stroke="${INK}" stroke-width="1.5"/>
                <text x="${h.cx}" y="${M.top - 8}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="${INK}">This corridor</text>`;
        }
        return out + '</svg>';
    });
    if (!handle) return;

    const nearest = e => {
        const box = handle.el.getBoundingClientRect();
        const x = e.clientX - box.left, y = e.clientY - box.top;
        let best = null, dist = 14;
        layout.forEach(p => {
            const dd = Math.hypot(p.cx - x, p.cy - y);
            if (dd < dist) { dist = dd; best = p; }
        });
        return best;
    };
    handle.el.addEventListener('pointermove', e => {
        const p = nearest(e);
        handle.el.style.cursor = p && p.d.id !== highlight ? 'pointer' : '';
        p ? Tooltip.show(tip(p.d), e.clientX, e.clientY) : Tooltip.hide();
    });
    handle.el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') Tooltip.hide(); });
    // mouse: click opens the corridor. Touch: the first tap shows its name, a second tap opens it.
    let tapped = null;
    handle.el.addEventListener('click', e => {
        const p = nearest(e);
        if (!p || p.d.id === highlight) { tapped = null; return; }
        if (e.pointerType === 'touch' && tapped !== p.d.id) {
            tapped = p.d.id;
            Tooltip.show(tip(p.d) + '<span class="tooltip-hint">Tap again to open its report</span>', e.clientX, e.clientY);
            return;
        }
        onSelect(p.d);
    });
}
