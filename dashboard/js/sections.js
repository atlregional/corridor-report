/* Report sections. Each section returns its card HTML (or null when there is no data)
   and can draw charts/maps after the card is in the page. */

const REPORT_BASE = 'report/';
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
const WEEKDAYS = Object.keys(DAY_NAMES);
const PEAKS = [['am', 'AM peak', '6–10 AM'], ['pm', 'PM peak', '3–7 PM']];

// Full reporting dates appear only in the two delay-total tiles; use years elsewhere.
function yearLabel(period) {
    const text = String(period ?? '');
    const years = text.match(/\b\d{4}\b/g);
    return years ? [...new Set(years)].join('–') : text;
}

function span(periods) {
    if (!periods || !periods.length) return '';
    if (periods.length === 1) return periods[0];
    const first = periods[0], last = periods[periods.length - 1];
    // same months every year: 'Jan–Oct 2024' … 'Jan–Oct 2026' -> 'Jan–Oct 2024–2026'
    const months = s => s.match(/^(.+) (\d{4})$/);
    const a = months(first), b = months(last);
    if (a && b && a[1] === b[1] && periods.every(p => months(p)?.[1] === a[1])) return `${a[1]} ${a[2]}–${b[2]}`;
    return `${first}–${last}`;
}

function card(id, title, periods, body) {
    const headingPeriod = String(periods ?? '').replace(/^Jan(?:uary)?\s+0?1\s*[–-]\s*Oct(?:ober)?\s+26,\s*/, '');
    const note = headingPeriod ? `<span class="period-note">${esc(headingPeriod)}</span>` : '';
    return `<section class="card" id="sec-${id}" aria-labelledby="h-${id}">
        <h3 id="h-${id}">${esc(title)} ${note}</h3>${body}</section>`;
}

/* answer is a paragraph of HTML, or a list of [term, explanation] pairs shown as bullets */
function definition(question, answer) {
    const body = Array.isArray(answer)
        ? `<ul>${answer.map(([term, text]) => `<li><strong>${esc(term)}:</strong> ${text}</li>`).join('')}</ul>`
        : `<p>${answer}</p>`;
    return `<details class="definition"><summary>${esc(question)}</summary>${body}</details>`;
}

function stat(label, value, note = '') {
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${note ? `<span class="stat-note">${note}</span>` : ''}</div>`;
}

function imageFigure(src, alt, caption) {
    const url = REPORT_BASE + src;
    return `<figure>
        <img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">
        <figcaption>${caption} <a href="${esc(url)}" target="_blank" rel="noopener">Open full-size image<span class="visually-hidden"> (opens in a new tab)</span></a></figcaption>
    </figure>`;
}

/* 1 -> '1st', 13 -> '13th', 22 -> '22nd' */
function ordinal(n) {
    const v = Math.round(n), mod100 = v % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] ?? 'th');
    return `${v}${suffix}`;
}

function pctChange(a, b) {
    if (a == null || b == null || a === 0) return null;
    return (b - a) / a * 100;
}

function changeText(first, last, unit, firstLabel) {
    const change = pctChange(first, last);
    if (change == null || Math.abs(change) < 2) return `about the same as ${firstLabel}`;
    return `${change > 0 ? 'up' : 'down'} ${fmt(Math.abs(change))}% from ${fmt(first, 1)} ${unit} in ${firstLabel}`;
}

/* '+8% since 2023', or 'same as 2023' for changes under 2% */
function changeShort(first, last, firstLabel) {
    const change = pctChange(first, last);
    if (change == null) return '';
    if (Math.abs(change) < 2) return `about the same as ${firstLabel}`;
    return `${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}% since ${firstLabel}`;
}

/* shared axis range for small multiples */
function niceRange(values, pad = 0.05) {
    const v = values.filter(x => x != null && !Number.isNaN(x));
    const lo = Math.min(...v), hi = Math.max(...v);
    const extra = (hi - lo || 1) * pad;
    const ticks = niceTicks(lo - extra, hi + extra, 5);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : (hi - lo || 1);
    let a = ticks[0], b = ticks[ticks.length - 1];
    if (a > lo - extra) a -= step;
    if (b < hi + extra) b += step;
    return [Math.max(0, a), b];
}

const SECTIONS = [

    /* ---------- profile ---------- */
    {
        id: 'profile', title: 'Corridor profile',
        render(d) {
            const years = (d.aadt?.years ?? []).filter(a => a.aadt != null);
            const trucks = years.some(a => a.truck_pct != null);
            const hov = d.aadt?.hov_of;
            const traffic = hov
                ? `<p class="unavailable">Traffic counts are not available for express lanes; GDOT counts the whole freeway.
                    See <a href="?cor=${hov.id}">${esc(hov.name)}</a> for its daily traffic.</p>`
                : years.length
                    ? tableHtml('Average annual daily traffic (AADT), both directions', trucks ? ['Year', 'Vehicles per day', 'Trucks'] : ['Year', 'Vehicles per day'],
                        years.map(a => trucks ? [a.period, fmt(a.aadt), a.truck_pct == null ? '–' : `${fmt(a.truck_pct, 1)}%`] : [a.period, fmt(a.aadt)]))
                      + `<p class="table-source">GDOT traffic counts: median of ${d.aadt.stations} count station${d.aadt.stations === 1 ? '' : 's'} along the corridor.</p>`
                    : '';
            return card(this.id, this.title, null, `
                <div class="grid-2 profile-grid">
                    <div>
                        <div class="stats">
                            ${stat('County', esc(d.county))}
                            ${stat('Functional class', esc(d.f_class))}
                            ${stat('Length', `${fmt(d.length_mi, 1)} mi`)}
                            ${stat('Improvement priority rank', fmt(d.rank), 'of 360 (1 = highest)')}
                        </div>
                        ${traffic}
                    </div>
                    <div>
                        <div id="profile-map" class="map" role="region" aria-label="Map showing the location of ${esc(d.name)} in ${esc(d.county)} County."></div>
                    </div>
                </div>`);
        },
        after(d) { App.drawProfileMap(d); },
    },

    /* ---------- delay cost ---------- */
    {
        id: 'delay', title: 'User delay cost',
        render(d) {
            const dc = d.delay_cost;
            if (!dc) return null;
            if (dc.cost == null) {
                return card(this.id, this.title, dc.period,
                    `<p class="unavailable">Delay cost is not available for this corridor (RITIS has no traffic volume data for its segments).</p>`);
            }
            const dailyCost = dc.days > 0 ? dc.cost / dc.days : null;
            const dailyHours = dc.days > 0 && dc.vehicle_hours != null ? dc.vehicle_hours / dc.days : null;
            const dailyNote = dc.days > 0 ? `Based on ${fmt(dc.days)} calendar days` : '';
            const totalNote = `Total for ${esc(dc.period)}`;
            return card(this.id, this.title, dc.period, `
                <div class="stats">
                    ${stat('Cost of delay', `$${fmt(dc.cost)}`, totalNote)}
                    ${stat('Vehicle-hours of delay', fmt(dc.vehicle_hours), totalNote)}
                    ${stat('Average daily cost of delay', dailyCost == null ? fmt(null) : `$${fmt(dailyCost)}`, dailyNote)}
                    ${stat('Average daily vehicle-hours of delay', fmt(dailyHours, 1), dailyNote)}
                </div>
                ${definition('How is delay cost calculated?',
                    'Delay is the extra travel time compared with free-flow conditions, multiplied by traffic volume. It is valued at RITIS defaults for passenger vehicles (per person-hour × 1.7 people per vehicle) and commercial vehicles.')}`);
        },
    },

    /* ---------- key bottleneck ---------- */
    {
        id: 'bottleneck', title: 'Key bottleneck',
        render(d) {
            const b = d.bottleneck;
            if (!b || !b.location) return null;
            const r = b.rows;
            const k = b.periods.length - 1;
            return card(this.id, this.title, span(b.periods), `
                <div class="stats">
                    <div class="stat stat-wide"><span class="stat-label">Key bottleneck location</span><span class="stat-value stat-text">${esc(b.location)}</span></div>
                    ${stat(`Average daily duration, ${esc(yearLabel(b.periods[k]))}`, esc((r.daily_duration[k] ?? '–').trim()), 'of congestion per day')}
                    ${stat(`Average maximum queue, ${esc(yearLabel(b.periods[k]))}`, `${fmt(r.max_length_mi[k], 2)} mi`)}
                    ${stat(`Events and incidents, ${esc(yearLabel(b.periods[k]))}`, fmt(r.events[k]))}
                </div>
                ${dataTableDetails(`Key bottleneck measures by year at ${b.location}`, ['Measure', ...b.periods.map(yearLabel)], [
                    ['Events and incidents', ...r.events.map(v => fmt(v))],
                    ['Average maximum queue length (miles)', ...r.max_length_mi.map(v => fmt(v, 2))],
                    ['Average daily duration of congestion', ...r.daily_duration.map(v => (v ?? '–').trim())],
                ], 'Show all years')}
                ${definition('What do these measures mean?', [
                    ['Key bottleneck location', 'the bottleneck that appears in the RITIS bottleneck ranking for this corridor in the most years; ties go to the one ranked highest in the most recent year.'],
                    ['Average daily duration', 'the average time per day that congestion is detected at the bottleneck.'],
                    ['Average maximum queue', 'the average length of the queue formed by congestion.'],
                    ['Events and incidents', 'traffic events and incidents reported within the bottleneck segment.'],
                ])}`);
        },
    },

    /* ---------- reliability ---------- */
    {
        id: 'reliability', title: 'Peak-hour speed reliability',
        render(d) {
            const rel = d.reliability;
            if (!rel) return null;
            const notes = [];
            const rows = [];
            let cats = 0;
            rel.directions.forEach(dir => PEAKS.forEach(([key, label]) => {
                cats++;
                rows.push([`${dir.name}, ${label}`, ...dir[key].map(v => v && v.p25 != null ? `${fmt(v.p25)}–${fmt(v.p75)} mph (${v.time})` : '–')]);
                const last = dir[key][dir[key].length - 1];
                if (last && last.p25 != null) notes.push({ dir: dir.name, label, spread: last.p75 - last.p25, last });
            }));
            const widest = notes.sort((a, b) => b.spread - a.spread)[0];
            const lastPeriod = yearLabel(rel.periods[rel.periods.length - 1]);
            const summary = widest ? `<p class="summary">The least predictable peak in ${esc(lastPeriod)} is <strong>${esc(widest.dir)}, ${esc(widest.label)}</strong>:
                at its slowest 15 minutes (${esc(widest.last.time)}), speeds on a typical weekday range from ${fmt(widest.last.p25)} to ${fmt(widest.last.p75)} mph.
                Longer bars mean less predictable trips.</p>` : '';
            return card(this.id, this.title, span(rel.periods), `
                ${summary}
                ${legendHtml(rel.periods.map(yearLabel), SERIES_COLORS, 'rel')}
                ${chartCanvas('chart-reliability', `Range chart of typical weekday speeds (25th to 75th percentile) at the slowest 15 minutes of each peak, by direction and year. ${widest ? `Widest range: ${widest.dir}, ${widest.label}.` : ''} Values are in the data table below.`,
                    { height: 70 + cats * rel.periods.length * 20 })}
                ${dataTableDetails('Typical speed range (25th–75th percentile) at the slowest 15 minutes of each peak, weekdays', ['Direction and peak', ...rel.periods.map(yearLabel)], rows)}
                ${definition('How to read this', 'For each peak, we find the 15-minute interval with the lowest average speed. Each bar spans the speeds of a typical weekday at that time (the middle half of all days, 25th to 75th percentile). A longer bar means travel times are less predictable.')}`);
        },
        after(d) {
            const rel = d.reliability;
            if (!rel) return;
            const labels = [];
            const cells = [];     // [category][period] -> value object
            rel.directions.forEach(dir => PEAKS.forEach(([key, label]) => {
                labels.push(`${dir.name}, ${label}`);
                cells.push(dir[key]);
            }));
            const all = cells.flat().filter(v => v && v.p25 != null).flatMap(v => [v.p25, v.p75]);
            const [min, max] = niceRange(all, 0.1);
            rangeChart('chart-reliability', {
                labels, min, max, xTitle: 'Speed (mph)', group: 'rel',
                series: rel.periods.map((p, k) => ({ label: yearLabel(p), data: cells.map(c => c[k] && c[k].p25 != null ? [c[k].p25, c[k].p75] : null) })),
                tip: (k, i) => {
                    const v = cells[i][k];
                    return v && v.p25 != null ? `${yearLabel(rel.periods[k])}: ${fmt(v.p25)}–${fmt(v.p75)} mph at ${v.time} (average ${fmt(v.mean)} mph)` : `${yearLabel(rel.periods[k])}: no data`;
                },
            });
        },
    },

    /* ---------- travel time by time of day ---------- */
    {
        id: 'time-of-day', title: 'Travel time by time of day',
        render(d) {
            const t = d.time_of_day;
            if (!t) return null;
            const last = yearLabel(t.periods[t.periods.length - 1]);
            const tiles = [];
            t.directions.forEach(dir => {
                const s0 = dir.series[0], s1 = dir.series[dir.series.length - 1];
                PEAKS.forEach(([k, label]) => {
                    if (!s1[k]) return;
                    tiles.push(stat(`${esc(dir.name)}, slowest ${label}`, `${fmt(s1[k].minutes, 1)} min`, `at ${esc(s1[k].time)}`));
                });
            });
            const rows = [];
            t.directions.forEach(dir => dir.series.forEach(s => rows.push([
                `${dir.name}, ${yearLabel(s.period)}`, fmt(s.free_flow, 1),
                s.am ? `${fmt(s.am.minutes, 1)} (${s.am.time})` : '–',
                s.pm ? `${fmt(s.pm.minutes, 1)} (${s.pm.time})` : '–'])));
            const panels = t.directions.map((dir, n) => `<div>
                <p class="chart-title">${esc(dir.name)}</p>
                ${chartCanvas(`chart-tod-${n}`, `Line chart of average weekday travel time by time of day, ${dir.name}, one line per year (${t.periods.map(yearLabel).join(', ')}). Key values are in the tiles above and the data table below.`)}
            </div>`).join('');
            return card(this.id, this.title, span(t.periods), `
                <h4>Slowest peak-hour travel time, ${esc(last)} weekdays</h4>
                <div class="stats">${tiles.join('')}</div>
                <h4>Average weekday travel time through the corridor</h4>
                ${legendHtml(t.periods.map(yearLabel), SERIES_COLORS, 'tod')}
                <div class="grid-2">${panels}</div>
                <p class="period-note">The shaded band shows the typical range (25th–75th percentile) for ${esc(last)}. Hover or tap a chart to read the values at any time of day.</p>
                ${dataTableDetails('Travel time in minutes: fastest time of day and slowest peak-hour travel time', ['Direction and year', 'Fastest (min)', 'AM peak, slowest (min)', 'PM peak, slowest (min)'], rows)}`);
        },
        after(d) {
            const t = d.time_of_day;
            if (!t) return;
            const all = t.directions.flatMap(dir => dir.series.flatMap(s => [...s.mean, ...(s.p75 ?? [])]));
            const [yMin, yMax] = niceRange(all);
            t.directions.forEach((dir, n) => {
                const lastIdx = dir.series.length - 1;
                lineChart(`chart-tod-${n}`, {
                    labels: dir.series[lastIdx].times,
                    series: dir.series.map((s, k) => ({
                        label: yearLabel(s.period), data: s.mean,
                        band: k === lastIdx && s.p25 ? [s.p25, s.p75] : null,
                        color: SERIES_COLORS[t.periods.indexOf(s.period) % SERIES_COLORS.length],
                    })),
                    yTitle: 'Minutes', yMin, yMax, unit: ' min', group: 'tod',
                });
            });
        },
    },

    /* ---------- peak period by day of week ---------- */
    {
        id: 'peak', title: 'Peak period travel time by day of week',
        render(d) {
            const p = d.peak_period;
            if (!p) return null;
            const rows = [];
            p.directions.forEach(dir => {
                PEAKS.filter(([k]) => dir[k]).forEach(([k, label]) => {
                    dir[k].forEach(y => rows.push([`${dir.name}, ${label}, ${yearLabel(y.period)}`, ...WEEKDAYS.map(x => fmt(y.days[x], 1))]));
                });
            });
            const blocks = PEAKS.filter(([k]) => p.directions.some(dir => dir[k])).map(([k, label, hours]) => `
                <h4>${label} (${hours})</h4>
                <div class="grid-2">${p.directions.map((dir, n) => dir[k] ? `<div>
                    <p class="chart-title">${esc(dir.name)}</p>
                    ${chartSvg(`chart-peak-${k}-${n}`, `Candlestick chart of ${label} travel time by weekday, ${dir.name}, one candle per year. Average values are in the data table below.`)}
                </div>` : '').join('')}</div>`).join('');
            // key: the box, the two whisker ends (5th and 95th percentile), the average dot
            const key = (body, w = 14) => `<svg width="${w}" height="20" viewBox="0 0 ${w} 20" aria-hidden="true">${body}</svg>`;
            return card(this.id, this.title, span(p.periods), `
                ${legendHtml(p.periods.map(yearLabel), SERIES_COLORS, 'peak')}
                <p class="candle-key" aria-hidden="true">
                    ${key('<rect x="2" y="3" width="10" height="14" rx="2" fill="#767b85"/>')} typical days (25th–75th percentile)
                    ${key('<line x1="7" x2="7" y1="2" y2="18" stroke="#767b85" stroke-width="1.5" stroke-dasharray="2 2"/><line x1="2" x2="12" y1="2" y2="2" stroke="#1f2328" stroke-width="2.5"/><line x1="2" x2="12" y1="18" y2="18" stroke="#1f2328" stroke-width="2.5"/>')} best and worst days (5th and 95th percentile)
                    ${key('<circle cx="7" cy="10" r="4" fill="#fff" stroke="#1f2328" stroke-width="1.5"/>')} average</p>
                ${blocks}
                ${dataTableDetails('Average peak travel time in minutes by weekday', ['Direction, peak, and year', ...WEEKDAYS], rows)}`);
        },
        after(d) {
            const p = d.peak_period;
            if (!p) return;
            // one y range for every chart (both peaks, both directions), so they compare at a glance
            const all = p.directions.flatMap(dir => PEAKS.flatMap(([k]) => (dir[k] ?? [])
                .flatMap(y => Object.values(y.box ?? {}).flatMap(v => [v[0], v[4]]))));
            if (!all.length) return;
            const [yMin, yMax] = niceRange(all);
            PEAKS.forEach(([k, label]) => {
                p.directions.forEach((dir, n) => {
                    if (!dir[k]) return;
                    candleChart(`chart-peak-${k}-${n}`, {
                        categories: WEEKDAYS, categoryNames: DAY_NAMES, yMin, yMax, yTitle: 'Minutes', group: 'peak',
                        series: dir[k].map(y => ({ label: `${yearLabel(y.period)} ${label}`, values: y.box ?? {} })),
                    });
                });
            });
        },
    },

    /* ---------- congestion scan ---------- */
    {
        id: 'congestion', title: 'Congestion by location and time of day',
        render(d) {
            const body = d.congestion_scan
                ? `<div class="wide-image">${imageFigure(d.congestion_scan.image,
                    `Heat map of the travel time index along ${d.name} by time of day, one panel per direction and year. Green means near free-flow; yellow to red means slower; purple means more than 2.5 times the free-flow travel time.`,
                    'Each panel runs along the corridor (vertical) and through the day (horizontal). Colors show the travel time index: 1.0 is free flow; 2.0 means trips take twice as long. For numbers by time of day, see the travel time section above.')}</div>`
                : `<p class="unavailable">A congestion scan is not available for this corridor.</p>`;
            return card(this.id, this.title, span(d.congestion_scan?.periods), body +
                definition('What is the travel time index?', 'Travel time index = travel time in traffic ÷ travel time at free-flow speed. A value of 1.3 means a trip takes 30% longer than it would with no congestion.'));
        },
    },

    /* ---------- causes of congestion ---------- */
    {
        id: 'causes', title: 'Causes of congestion',
        render(d) {
            const c = d.causes;
            if (!c) return null;
            const lastIdx = c.periods.length - 1;
            const top = [...c.rows].sort((a, b) => (b.values[lastIdx] ?? 0) - (a.values[lastIdx] ?? 0)).slice(0, 2);
            return card(this.id, this.title, span(c.periods), `
                <p class="summary">In ${esc(yearLabel(c.periods[lastIdx]))}, the largest contributors to delay were <strong>${esc(top[0].category.toLowerCase())}</strong> (${fmt(top[0].values[lastIdx], 1)}%) and <strong>${esc(top[1].category.toLowerCase())}</strong> (${fmt(top[1].values[lastIdx], 1)}%).</p>
                ${legendHtml(c.periods.map(yearLabel), SERIES_COLORS, 'causes')}
                ${chartCanvas('chart-causes', `Bar chart of the share of delay by cause and year for ${d.name}. Values are in the data table below.`)}
                <p class="period-note">Shares can add to more than 100% because delay can have overlapping causes.</p>
                ${dataTableDetails('Share of delay by cause (%)', ['Cause', ...c.periods.map(yearLabel)], c.rows.map(r => [r.category, ...r.values.map(v => fmt(v, 1))]))}`);
        },
        after(d) {
            const c = d.causes;
            if (!c) return;
            barChart('chart-causes', {
                labels: c.rows.map(r => r.category),
                series: c.periods.map((p, k) => ({ label: yearLabel(p), data: c.rows.map(r => r.values[k]) })),
                yTitle: 'Share of delay (%)', valueSuffix: '%', group: 'causes',
            });
        },
    },

    /* ---------- road surface condition (NIRA) ---------- */
    {
        id: 'road', title: 'Road surface condition',
        render(d) {
            const r = d.road;
            if (!r) return null;
            const total = r.miles.good + r.miles.fair + r.miles.poor;
            const pct = k => total ? r.miles[k] / total * 100 : 0;
            const classes = [['good', 'Good', 'IRI below 95'], ['fair', 'Fair', 'IRI 95–170'], ['poor', 'Poor', 'IRI above 170']];
            // each segment is a button: label and numbers stay visible (this replaces the miles table)
            const bar = classes.filter(([k]) => r.miles[k] > 0).map(([k, label, range]) => `
                <button type="button" class="cond-seg ${k}" style="flex-grow:${pct(k)}" aria-pressed="false" data-class="${k}"
                    data-tip="${esc(`<strong>${label}</strong> (${range} in/mi)<span>${fmt(r.miles[k], 1)} miles, ${fmt(pct(k))}% of measured road</span><span>Select to highlight on the map</span>`)}">
                    <span class="cond-name">${label}</span>
                    <span class="cond-value">${fmt(r.miles[k], 1)} mi · ${fmt(pct(k))}%</span>
                    <span class="visually-hidden">(${range} inches per mile). Highlight on the map.</span>
                </button>`).join('');
            return card(this.id, this.title, r.period, `
                ${r.snapshot ? `<p class="period-note">Snapshot: ${esc(new Date(`${r.snapshot}T00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}.</p>` : ''}
                <p class="summary">Average roughness is <strong>${fmt(r.iri_mean)} inches per mile</strong>
                    (<span class="badge ${r.class}">${esc(r.class_label)}</span>). Of the ${fmt(total, 1)} miles measured (both directions combined),
                    ${fmt(pct('good'))}% are in good condition, ${fmt(pct('fair'))}% fair, and ${fmt(pct('poor'))}% poor.</p>
                <h4>Miles by condition</h4>
                <p class="period-note">Select a condition to highlight it on the map; select it again to show all.</p>
                <div class="condition-bar" role="group" aria-label="Miles by condition. Select a condition to highlight it on the map.">${bar}</div>
                <div id="road-map" class="map road-map" role="region" aria-label="Map of ${esc(d.name)} colored by road surface condition, with detected potholes. The condition buttons above summarize the same information."></div>
                <div class="map-legend" aria-hidden="true">
                    <span><i style="background:var(--good)"></i>Good</span>
                    <span><i style="background:var(--fair)"></i>Fair</span>
                    <span><i style="background:var(--poor)"></i>Poor</span>
                    <span>Pothole severity: <i class="pothole-key s2"></i>2 <i class="pothole-key s3"></i>3 <i class="pothole-key s4"></i>4 or higher</span>
                    <span><i class="pothole-key grouped"></i>A number means several potholes grouped</span>
                </div>
                ${r.potholes ? `<label class="check"><input type="checkbox" id="show-potholes" checked> Show potholes on the map</label>` : ''}
                <p class="caution"><strong>Use with caution.</strong> These are estimates from everyday vehicles, not a pavement inspection.
                    They are best for comparing corridors and spotting problem areas, not for judging a single location.</p>
                ${definition('About this data', [
                    ['Source', 'NIRA Dynamics estimates roughness (International Roughness Index) and detects potholes from the built-in sensors of connected passenger cars.'],
                    ['Roughness', 'International Roughness Index (IRI) in inches per mile, aggregated over the past 60 days, with recent measurements weighted more heavily.'],
                    ['Condition classes', 'FHWA thresholds in inches per mile: good below 95, fair 95–170, poor above 170.'],
                    ['Coverage', 'Roads with less traffic have fewer measurements, so their estimates are less certain. Gaps on the map are stretches without enough data.'],
                    ['Potholes', 'Shown only if detected within 90 days of the data date, and only where a wheel hit them, so not every pothole is found. Some may have been repaired since. Only severity 2 or higher is shown; severity 1, the weakest detection, is left out. Higher severity means a more significant pothole; the share of passing vehicles that detected it shows how consistently it is felt.'],
                    ['Location', 'Readings are placed by vehicle GPS and matched to the corridor, so a few may belong to an adjacent lane or road.'],
                ])}`);
        },
        after(d) {
            if (!d.road) return;
            App.drawRoadMap(d);
            const bar = document.querySelector('#sec-road .condition-bar');
            bindTooltip(bar, '.cond-seg', el => el.dataset.tip);
            bar.addEventListener('click', e => {
                const btn = e.target.closest('.cond-seg');
                if (!btn) return;
                const on = btn.getAttribute('aria-pressed') !== 'true';
                bar.querySelectorAll('.cond-seg').forEach(b => b.setAttribute('aria-pressed', String(b === btn && on)));
                App.highlightRoad(on ? btn.dataset.class : null);
            });
            document.getElementById('show-potholes')?.addEventListener('change', e => App.showPotholes(e.target.checked));
        },
    },

    /* ---------- on-road emissions ---------- */
    {
        id: 'emissions', title: 'On-road emissions',
        render(d) {
            const e = d.emissions;
            if (!e) return null;
            const last = e.totals[e.totals.length - 1];
            // average day of each period, in tons (CO2), kg or g; periods are labeled by year
            const day = (t, v, scale = 1) => t.days ? v * scale / t.days : null;
            const KG = 907.18474, G = 907184.74;
            const year = yearLabel;
            const cmp = this.comparison(e);
            const density = e.per_mile_day
                ? stat('CO₂ per corridor mile', `${fmt(e.per_mile_day.co2, 1)} t`,
                    cmp ? `median of ${cmp.count} corridors: ${fmt(cmp.co2_per_mile_day.median, 1)} t` : 'both directions')
                : '';
            const hourly = e.by_hour.co2_kg_per_mile_day;
            const peakHour = e.by_hour.hours[e.by_hour.co2.indexOf(Math.max(...e.by_hour.co2))];

            return card(this.id, this.title, span(e.periods), `
                <h4>Average day, ${esc(year(last.period))}</h4>
                <div class="stats stats-4">
                    ${stat('Vehicle-miles traveled', fmt(day(last, last.vmt)))}
                    ${stat('CO₂', `${fmt(day(last, last.co2), 1)} t`)}
                    ${stat('NOx', `${fmt(day(last, last.nox, KG))} kg`)}
                    ${stat('PM2.5', `${fmt(day(last, last.pm25, G))} g`)}
                    ${stat('CO', `${fmt(day(last, last.co, KG))} kg`)}
                    ${stat('VOC', `${fmt(day(last, last.voc, KG))} kg`)}
                    ${stat('HC', `${fmt(day(last, last.hc, KG))} kg`)}
                    ${density}
                </div>
                ${hourly ? `<h4>CO₂ per corridor mile by hour of day, average day, ${esc(year(last.period))}</h4>
                ${cmp ? legendHtml(['This corridor', `Median of ${cmp.count} corridors`], [SINGLE_COLOR, INK_SECONDARY]) : ''}
                ${chartCanvas('chart-emissions-hour', `Line chart of CO2 emissions per corridor mile by hour of an average day on ${d.name} in ${year(last.period)}, highest at ${peakHour}${cmp ? `, compared with the median and middle half of ${cmp.count} corridors` : ''}. Hover or tap the chart to read the values.`)}
                ${cmp ? `<p class="period-note">The shaded band shows the middle half of corridors (25th–75th percentile). Hover or tap the chart to read the values at any hour.</p>` : ''}` : ''}
                ${dataTableDetails('Emissions on an average day, by year', ['Year', 'Vehicle-miles', 'CO₂ (t)', 'NOx (kg)', 'PM2.5 (g)', 'CO (kg)', 'VOC (kg)', 'HC (kg)'],
                    e.totals.map(t => [year(t.period), fmt(day(t, t.vmt)), fmt(day(t, t.co2), 1), fmt(day(t, t.nox, KG)), fmt(day(t, t.pm25, G)),
                        fmt(day(t, t.co, KG)), fmt(day(t, t.voc, KG)), fmt(day(t, t.hc, KG))]), 'Show all pollutants by year')}
                <details><summary>Show emissions by vehicle engine type</summary>${tableHtml(`Share by engine type (from vehicle registrations), ${year(last.period)} (%)`,
                    ['Engine type', 'Vehicle-miles', 'CO₂', 'NOx', 'PM2.5'],
                    e.by_engine.map(x => [x.engine, fmt(x.vmt_share, 1), fmt(x.co2_share, 1), fmt(x.nox_share, 1), fmt(x.pm25_share, 1)]))}</details>
                ${definition('Where do these numbers come from?',
                    `Estimates from the RITIS Energy Use and Emissions model (University of Maryland CATT Lab), which is based on EPA’s MOVES3. It combines probe vehicle speeds, traffic volumes, and vehicle registrations for every day of the week. These are tailpipe emissions generated on the corridor, not measurements of the air people breathe. Because emissions are estimated per vehicle-mile, they rise and fall mainly with traffic volume. Values are for an average day within each year's reporting period. To compare corridors of different lengths, CO₂ is also shown per mile of corridor, both directions combined.`)}`);
        },
        // all-corridor spread, when it covers the same period as this corridor's newest data
        comparison(e) {
            const r = App.region.emissions;
            return r && r.count >= 2 && r.period === e.periods[e.periods.length - 1] ? r : null;
        },
        after(d) {
            const e = d.emissions;
            if (!e || !e.by_hour.co2_kg_per_mile_day) return;
            const cmp = this.comparison(e);
            const series = [{ label: 'This corridor', data: e.by_hour.co2_kg_per_mile_day, color: SINGLE_COLOR }];
            if (cmp) {
                const h = cmp.hour_kg_per_mile_day;
                series.push({ label: `Median of ${cmp.count} corridors`, data: h.median, band: [h.p25, h.p75], color: INK_SECONDARY, dashed: true });
            }
            lineChart('chart-emissions-hour', {
                labels: e.by_hour.hours, series,
                yTitle: 'CO₂ (kg per mile)', yMin: 0, unit: ' kg', digits: 0,
            });
        },
    },

    /* ---------- safety ---------- */
    {
        id: 'safety', title: 'Safety',
        render(d) {
            const s = d.safety;
            const region = App.region;
            const n = s.periods.length - 1;
            const rows = s.periods.map((p, k) => [p, fmt(s.crashes[k]), fmt(s.fatal_injury[k])]);
            const rateCompare = s.crash_rate != null && region.crash_rate_mean
                ? `, ${s.crash_rate > region.crash_rate_mean ? 'above' : 'below'} the average of ${fmt(region.crash_rate_mean)} for all corridors` : '';
            return card(this.id, this.title, span(s.periods), `
                <div class="stats">
                    ${stat(`Crash rate, ${esc(s.crash_rate_period)}`, fmt(s.crash_rate), `crashes per 100 million vehicle-miles${rateCompare}`)}
                    ${stat(`Crashes, ${esc(s.periods[n])}`, fmt(s.crashes[n]), changeShort(s.crashes[0], s.crashes[n], s.periods[0]))}
                    ${stat(`Fatalities and injuries, ${esc(s.periods[n])}`, fmt(s.fatal_injury[n]), changeShort(s.fatal_injury[0], s.fatal_injury[n], s.periods[0]))}
                </div>
                <div class="grid-2">
                    <div><p class="chart-title">Crashes per year</p>${chartCanvas('chart-crashes', `Line chart of crashes per year on ${d.name}, ${span(s.periods)}. Values are in the data table below.`)}</div>
                    <div><p class="chart-title">Fatalities and injuries per year</p>${chartCanvas('chart-injuries', `Line chart of fatalities and injuries per year on ${d.name}, ${span(s.periods)}. Values are in the data table below.`)}</div>
                </div>
                ${dataTableDetails('Crashes, fatalities and injuries by year', ['Year', 'Crashes', 'Fatalities and injuries'], rows)}`);
        },
        after(d) {
            const s = d.safety;
            const style = { yMin: 0, digits: 0, points: true, lineWidth: 3, pointRadius: 8 };
            lineChart('chart-crashes', { labels: s.periods, series: [{ label: 'Crashes', data: s.crashes, color: SINGLE_COLOR }], ...style });
            lineChart('chart-injuries', { labels: s.periods, series: [{ label: 'Fatalities and injuries', data: s.fatal_injury, color: SINGLE_COLOR }], ...style });
        },
    },

    /* ---------- equity ---------- */
    {
        id: 'equity', title: 'Equity',
        names: { ethnic_minority: 'Ethnic minority', racial_minority: 'Racial minority', female: 'Female', youth: 'Youth', older_adults: 'Older adults',
                 foreign_born: 'Foreign born', limited_english: 'Limited English', disability: 'Disability', low_income: 'Low income' },
        /* average factor score of all corridors, from the counts per score */
        average(k) {
            const counts = App.region.equity_counts?.[k];
            if (!counts) return null;
            const n = counts.reduce((a, b) => a + b, 0);
            return n ? counts.reduce((a, c, s) => a + c * s, 0) / n : null;
        },
        render(d) {
            const e = d.equity;
            const total = App.corridors.length;
            // the radar has no table, so its text description carries the values
            const values = Object.entries(e.factors).map(([k, v]) => `${this.names[k] ?? k} ${fmt(v)} (average ${fmt(this.average(k), 1)})`).join('; ');
            const higher = e.percentile;
            const scores = App.corridors.map(c => c.ej).filter(v => v != null);
            const [lo, hi] = [Math.min(...scores), Math.max(...scores)];
            return card(this.id, this.title, e.period, `
                <p class="summary">This corridor's total equity score is <strong>${fmt(e.score)}</strong>${higher != null ? `, in the <strong>${ordinal(higher)} percentile</strong> among the region's corridors` : ''}.
                    The total is the sum of the nine factor scores shown below; across the region it ranges from ${fmt(lo)} to ${fmt(hi)}.
                    Higher scores mean the corridor serves more people in these groups.</p>
                <p class="period-note">Each dot is a corridor. Hover or tap a dot to see which one; select it to open its report.</p>
                ${chartSvg('chart-equity-dots', `Dot plot of total equity scores for all ${total} corridors, ranging from ${lo} to ${hi}. This corridor scores ${e.score}, in the ${higher != null ? ordinal(higher) : '–'} percentile.`)}
                <h4>Score by factor</h4>
                <div class="chart-legend" aria-hidden="true">
                    <span><i style="background:#d03b3b"></i>This corridor</span>
                    <span><i class="dash-key"></i>Average of all corridors</span>
                </div>
                ${chartCanvas('chart-equity-radar', `Radar chart of the nine equity factor scores (0 to 4) for ${d.name}, compared with the average of all corridors: ${values}.`, { cls: 'chart-radar' })}`);
        },
        after(d) {
            dotPlot('chart-equity-dots', {
                items: App.corridors.filter(c => c.ej != null).map(c => ({ id: c.id, name: c.name, county: c.county, value: c.ej })),
                highlight: d.id,
                valueLabel: v => fmt(v),
                tip: c => `<strong>${esc(c.name)}</strong><span>${esc(c.county)} County · score ${fmt(c.value)}</span>`,
                onSelect: c => App.select(c.id, { scroll: true }),
            });
            const keys = Object.keys(d.equity.factors);
            radarChart('chart-equity-radar', {
                labels: keys.map(k => this.names[k] ?? k), max: 4,
                series: [
                    { label: 'Average of all corridors', data: keys.map(k => this.average(k)), color: '#4f5560', dashed: true },
                    { label: 'This corridor', data: keys.map(k => d.equity.factors[k]), color: '#d03b3b', fill: 'rgba(208, 59, 59, 0.15)' },
                ],
            });
        },
    },
];
