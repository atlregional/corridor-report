/* Corridor picker, maps, and report rendering. */

const RANK_BINS = [   // inferno, 60 corridors each: darker = higher priority
    { max: 60, color: '#420a68', label: '1–60' },
    { max: 120, color: '#802269', label: '61–120' },
    { max: 180, color: '#bc3754', label: '121–180' },
    { max: 240, color: '#e8602a', label: '181–240' },
    { max: 300, color: '#f8970d', label: '241–300' },
    { max: Infinity, color: '#f3cf35', label: '301–360' },
];
const SELECTED_COLOR = '#00ffff';   // not in inferno, so the selected corridor stands out
const rankColor = rank => RANK_BINS.find(b => rank <= b.max).color;

const DATA = 'dashboard/data/';
const NO_CACHE = { cache: 'no-cache' };   // revalidate, so rebuilt data shows up without a hard refresh     // paths are relative to index.html at the project root

const ROAD_COLORS = { good: '#0ca30c', fair: '#f59100', poor: '#d90000' };   // same as --good/--fair/--poor
const ROAD_LABELS = { good: 'Good', fair: 'Fair', poor: 'Poor' };

const BASEMAP = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }];

const App = {
    corridors: [],
    byName: {},
    region: {},
    geojson: null,
    sort: { key: 'rank', dir: 1 },
    selected: null,
    report: null,
    maps: {},

    async init() {
        let corridors, region;
        try {
            [corridors, region] = await Promise.all([
                fetch(DATA + 'corridors.json', NO_CACHE).then(r => r.json()),
                fetch(DATA + 'region.json', NO_CACHE).then(r => r.json()),
            ]);
        } catch (e) {
            // browsers block data requests from pages opened straight from disk (file://)
            const hint = location.protocol === 'file:'
                ? 'This page was opened as a file, so the browser blocked its data. Open it through a web server instead (for example, run <code>python -m http.server 8765</code> in this folder and go to http://127.0.0.1:8765/).'
                : 'Please reload the page. If the problem continues, contact the dashboard team.';
            document.getElementById('picker').insertAdjacentHTML('afterbegin',
                `<div class="load-error" role="alert"><strong>The corridor data could not be loaded.</strong> ${hint}</div>`);
            return;
        }
        this.corridors = corridors;
        this.region = region;
        corridors.forEach(c => { this.byName[c.name] = c; });

        // footer date comes from the last build_data.py run
        const updated = document.getElementById('last-updated');
        if (region.updated) {
            updated.querySelector('time').dateTime = region.updated;
            updated.querySelector('time').textContent = new Date(`${region.updated}T00:00`)
                .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            updated.hidden = false;
        }

        // the picker fills the window below the site header (see #picker in dashboard.css)
        const header = document.querySelector('.site-header');
        const setHeader = () => {
            document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
            this.maps.overview?.invalidateSize();
        };
        new ResizeObserver(setHeader).observe(header);
        window.addEventListener('resize', setHeader);

        this.initFilters();
        this.renderList();
        document.getElementById('view-report').addEventListener('click', () => this.viewReport());
        this.initOverviewMap();
        this.initBackToTop();

        window.addEventListener('popstate', () => this.selectFromUrl(false));
        this.selectFromUrl(false);
    },

    /* back to top: shown after scrolling down a screen (CSS limits it to desktops); focus goes
       to the top of the page so keyboard users continue from there */
    initBackToTop() {
        const button = document.getElementById('back-to-top');
        const update = () => { button.hidden = window.scrollY < window.innerHeight; };
        window.addEventListener('scroll', update, { passive: true });
        update();
        button.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: this.reducedMotion() ? 'auto' : 'smooth' });
            document.getElementById('main').focus({ preventScroll: true });
        });
    },

    /* ---------- list ---------- */

    initFilters() {
        const counties = [...new Set(this.corridors.map(c => c.county))].sort();
        const classes = [...new Map(this.corridors.map(c => [c.f_class, c.factype]))].sort((a, b) => a[1] - b[1]).map(a => a[0]);
        const addOptions = (el, values) => values.forEach(v => el.add(new Option(v, v)));
        addOptions(document.getElementById('county-filter'), counties);
        addOptions(document.getElementById('class-filter'), classes);

        ['county-filter', 'class-filter'].forEach(id =>
            document.getElementById(id).addEventListener('input', () => this.renderList()));

        document.querySelectorAll('.corridor-table th button').forEach(btn => btn.addEventListener('click', () => {
            const key = btn.dataset.sort;
            this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : 1 };
            document.querySelectorAll('.corridor-table th').forEach(th => th.setAttribute('aria-sort', 'none'));
            btn.parentElement.setAttribute('aria-sort', this.sort.dir === 1 ? 'ascending' : 'descending');
            this.renderList();
        }));
    },

    filtered() {
        const county = document.getElementById('county-filter').value;
        const cls = document.getElementById('class-filter').value;
        const { key, dir } = this.sort;
        return this.corridors
            .filter(c => (!county || c.county === county) && (!cls || c.f_class === cls))
            .sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir);
    },

    renderList() {
        const rows = this.filtered();
        const tbody = document.getElementById('corridor-list');
        tbody.innerHTML = rows.map(c => `
            <tr data-id="${c.id}"${c.id === this.selected ? ' class="is-selected"' : ''}>
                <td><button type="button" class="corridor-link" data-id="${c.id}"${c.id === this.selected ? ' aria-current="true"' : ''}>${esc(c.name)}</button></td>
                <td>${esc(c.county)}</td>
                <td>${esc(c.f_class)}</td>
                <td>${c.rank}</td>
            </tr>`).join('');
        tbody.querySelectorAll('.corridor-link').forEach(b => b.addEventListener('click', () => this.select(+b.dataset.id)));
        document.getElementById('result-count').textContent =
            `${rows.length} of ${this.corridors.length} corridors shown`;
        this.styleOverview();
    },

    /* ---------- maps ---------- */

    initOverviewMap() {
        // canvas tolerance widens the clickable area around the thin lines (easier to tap)
        const map = L.map('overview-map', { scrollWheelZoom: false, renderer: L.canvas({ tolerance: 8 }) }).setView([33.8, -84.4], 9);
        L.tileLayer(...BASEMAP).addTo(map);
        this.maps.overview = map;
        new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());   // its height follows the window

        const legend = document.getElementById('map-legend');
        legend.innerHTML = '<span class="map-legend-title">Priority rank</span>' +
            RANK_BINS.map(b => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('');

        // slimmed lines from build_map_lines.py (simplified, rounded, name only)
        fetch(DATA + 'corridor_lines.geojson', NO_CACHE).then(r => r.json()).then(gj => {
            // draw low priority first so higher-priority corridors sit on top where lines overlap
            // (e.g. an interstate over its express lane corridor)
            const rank = f => this.byName[f.properties.Corridor]?.rank ?? Infinity;
            gj.features.sort((a, b) => rank(b) - rank(a));
            this.geojson = gj;
            // dark casing under each line so the lighter colors (amber, green) stand out on the basemap
            this.casingLayer = L.geoJSON(gj, {
                filter: f => !!this.byName[f.properties.Corridor],
                style: f => this.casingStyle(f),
                interactive: false,
            }).addTo(map);
            this.overviewLayer = L.geoJSON(gj, {
                filter: f => !!this.byName[f.properties.Corridor],
                style: f => this.overviewStyle(f),
                onEachFeature: (f, layer) => {
                    const c = this.byName[f.properties.Corridor];
                    layer.bindTooltip(`${esc(c.name)} (rank ${c.rank})`, { sticky: true });
                    layer.on('click', () => this.select(c.id));
                    layer.on('mouseover', () => this.hoverCorridor(c.id));
                    layer.on('mouseout', () => this.hoverCorridor(null));
                },
            }).addTo(map);
            if (this._visible) this.styleOverview();   // a filter set before the lines loaded
            if (this.report) this.drawProfileMap(this.report);
            if (this.selected != null) this.showOnMap(this.selected);
        });
    },

    /* zoom the overview map to a corridor */
    showOnMap(id) {
        if (!this.overviewLayer) return;
        const layers = this.overviewLayer.getLayers().filter(l => this.byName[l.feature.properties.Corridor]?.id === id);
        if (!layers.length) return;
        this.maps.overview.flyToBounds(L.featureGroup(layers).getBounds(),
            { padding: [30, 30], maxZoom: 14, duration: this.reducedMotion() ? 0 : 0.6 });
    },

    reducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    /* scroll to the report and move focus to its heading */
    viewReport() {
        const h = document.getElementById('report-title');
        h.focus({ preventScroll: true });
        h.scrollIntoView({ behavior: this.reducedMotion() ? 'auto' : 'smooth' });
    },

    overviewStyle(f) {
        const c = this.byName[f.properties.Corridor];
        const visible = this._visible ? this._visible.has(c.id) : true;
        const selected = c.id === this.selected;
        const hovered = c.id === this._hovered && !selected;
        return { color: selected ? SELECTED_COLOR : rankColor(c.rank), weight: selected ? 7 : hovered ? 6 : 3, opacity: visible ? 1 : 0.12 };
    },

    casingStyle(f) {
        const c = this.byName[f.properties.Corridor];
        const visible = this._visible ? this._visible.has(c.id) : true;
        const selected = c.id === this.selected;
        const hovered = c.id === this._hovered && !selected;
        // hovered: a white outline lifts the corridor off the lines around it
        if (hovered && visible) return { color: '#ffffff', weight: 11, opacity: 1 };
        return { color: '#1f2328', weight: selected ? 13 : 5, opacity: visible ? (selected ? 0.9 : 0.6) : 0 };
    },

    /* hover highlight on the overview map: the whole corridor (every piece) thickens and comes to the front */
    hoverCorridor(id) {
        const before = this._hovered;
        this._hovered = id;
        const touched = l => [before, id].includes(this.byName[l.feature.properties.Corridor]?.id);
        this.casingLayer?.eachLayer(l => { if (touched(l)) l.setStyle(this.casingStyle(l.feature)); });
        this.overviewLayer?.eachLayer(l => { if (touched(l)) l.setStyle(this.overviewStyle(l.feature)); });
        if (id == null) {
            this.orderOverview();
            return;
        }
        const mine = l => this.byName[l.feature.properties.Corridor]?.id === id;
        this.casingLayer?.eachLayer(l => { if (mine(l)) l.bringToFront(); });
        this.overviewLayer?.eachLayer(l => { if (mine(l)) l.bringToFront(); });
    },

    styleOverview() {
        this._visible = new Set(this.filtered().map(c => c.id));
        this.casingLayer?.setStyle(f => this.casingStyle(f));
        this.casingLayer?.eachLayer(l => { if (this.byName[l.feature.properties.Corridor]?.id === this.selected) l.bringToFront(); });
        this.overviewLayer?.setStyle(f => this.overviewStyle(f));
        // filtered-out corridors stay as faded context but ignore hover and clicks (the canvas renderer checks
        // options.interactive on every event); the selected corridor stays live
        this.overviewLayer?.eachLayer(l => {
            const id = this.byName[l.feature.properties.Corridor]?.id;
            l.options.interactive = this._visible.has(id) || id === this.selected;
            if (!l.options.interactive) l.closeTooltip();
        });
        this.orderOverview();
    },

    /* drawing order: priority rank (1 on top), then the selected corridor above everything */
    orderOverview() {
        if (!this.overviewLayer) return;
        const rank = l => this.byName[l.feature.properties.Corridor]?.rank ?? Infinity;
        const byRank = this.overviewLayer.getLayers().sort((a, b) => rank(b) - rank(a));
        byRank.forEach(l => l.bringToFront());
        byRank.filter(l => this.byName[l.feature.properties.Corridor]?.id === this.selected).forEach(l => l.bringToFront());
    },

    corridorFeatures(name) {
        return this.geojson ? this.geojson.features.filter(f => f.properties.Corridor === name) : [];
    },

    drawProfileMap(d) {
        const el = document.getElementById('profile-map');
        if (!el || !this.geojson) return;
        this.maps.profile?.remove();
        const map = L.map(el, { scrollWheelZoom: false, keyboard: false, zoomControl: true });
        L.tileLayer(...BASEMAP).addTo(map);
        const corridor = { type: 'FeatureCollection', features: this.corridorFeatures(d.name) };
        L.geoJSON(corridor, { style: { color: '#ffffff', weight: 14, opacity: 0.9 }, interactive: false }).addTo(map);
        const layer = L.geoJSON(corridor, { style: { color: '#d03b3b', weight: 9, opacity: 1 } }).addTo(map);
        map.invalidateSize();
        layer.getBounds().isValid() ? map.fitBounds(layer.getBounds(), { padding: [20, 20] }) : map.setView([33.8, -84.4], 9);
        this.maps.profile = map;
    },

    drawRoadMap(d) {
        const el = document.getElementById('road-map');
        if (!el) return;
        this.maps.road?.remove();
        const map = L.map(el, { scrollWheelZoom: false, keyboard: false });
        L.tileLayer(...BASEMAP).addTo(map);
        this.maps.road = map;
        this.roadHighlight = null;
        fetch(`${DATA}road/${d.id}.geojson`, NO_CACHE).then(r => r.ok ? r.json() : null).then(gj => {
            if (!gj) return;
            const pick = test => ({ ...gj, features: gj.features.filter(test) });
            const raw = pick(f => f.geometry.type !== 'Point' && f.properties.kind !== 'bin');
            const bins = pick(f => f.properties.kind === 'bin');
            const points = pick(f => f.geometry.type === 'Point');
            const tapToOpen = layer => layer.on('click', e => layer.openTooltip(e.latlng));
            const lineLayer = (data, note) => L.geoJSON(data, {
                style: f => this.roadStyle(f),
                onEachFeature: (f, layer) => {
                    const p = f.properties;
                    layer.bindTooltip(`<strong>${esc(ROAD_LABELS[p.class] ?? p.class)}</strong><br>Roughness ${fmt(p.iri)} in/mi${note}`, { sticky: true });
                    tapToOpen(layer);
                },
            });

            // zoomed out: 0.1-mile averages on the corridor line (continuous); zoomed in: raw NIRA sub-segments
            this.roadLayers = [lineLayer(raw, ''), lineLayer(bins, '<br>Average over 0.1 mile, both directions')];
            const ZOOM_RAW = 15;
            const swap = () => {
                const [rawLayer, binLayer] = this.roadLayers;
                const zoomedIn = map.getZoom() >= ZOOM_RAW || !bins.features.length;
                const show = zoomedIn ? rawLayer : binLayer, hide = zoomedIn ? binLayer : rawLayer;
                if (map.hasLayer(hide)) hide.remove();
                if (!map.hasLayer(show)) show.addTo(map);
            };
            map.on('zoomend', swap);
            this.roadLayer = this.roadLayers[0];
            // potholes: clustered (a circle with the count) when zoomed out, individual hollow rings
            // when zoomed in, so the condition color stays visible underneath; ring size by severity (2, 3, 4+)
            this.potholeLayer = L.markerClusterGroup({
                maxClusterRadius: 45,
                disableClusteringAtZoom: ZOOM_RAW,
                showCoverageOnHover: false,
                spiderfyOnMaxZoom: false,
                iconCreateFunction: cluster => {
                    const n = cluster.getChildCount();
                    const size = n < 10 ? 30 : n < 50 ? 38 : 46;
                    return L.divIcon({ html: `<span>${n}</span>`, className: 'pothole-cluster', iconSize: [size, size] });
                },
            });
            this.potholeLayer.on('clustermouseover', e => e.layer.bindTooltip(`${e.layer.getChildCount()} potholes. Select to zoom in.`).openTooltip());
            L.geoJSON(points, {
                pointToLayer: (f, latlng) => {
                    const size = f.properties.severity >= 4 ? 26 : f.properties.severity === 3 ? 19 : 13;
                    return L.marker(latlng, { icon: L.divIcon({ className: 'pothole-icon', iconSize: [size, size] }), keyboard: false });
                },
                onEachFeature: (f, layer) => {
                    const p = f.properties;
                    const hit = p.hit_pct == null ? '' : p.hit_pct < 1 ? 'less than 1%' : `${p.hit_pct}%`;
                    layer.bindTooltip(`<strong>Pothole</strong>`
                        + (p.severity != null ? `<br>Severity ${p.severity}${d.road.severity_max ? ` (${d.road.severity_max} = most severe)` : ''}` : '')
                        + (hit ? `<br>Detected by ${hit} of passing vehicles` : '')
                        + (p.last_detection ? `<br>Last detected ${esc(p.last_detection)}` : ''));
                    tapToOpen(layer);
                },
            }).eachLayer(l => this.potholeLayer.addLayer(l));
            this.potholeLayer.addTo(map);
            map.invalidateSize();
            if (this.roadLayer.getBounds().isValid()) map.fitBounds(this.roadLayer.getBounds(), { padding: [20, 20] });
            swap();
        });
    },

    roadStyle(f) {
        const cls = f.properties.class;
        const dim = this.roadHighlight && cls !== this.roadHighlight;
        const bin = f.properties.kind === 'bin';
        return { color: ROAD_COLORS[cls] ?? '#888', weight: bin ? 11 : 10, opacity: dim ? 0.12 : 0.95, lineCap: bin ? 'round' : 'butt' };
    },

    highlightRoad(cls) {
        this.roadHighlight = cls;
        (this.roadLayers ?? []).forEach(l => l.setStyle(f => this.roadStyle(f)));
    },

    showPotholes(show) {
        if (!this.potholeLayer) return;
        show ? this.potholeLayer.addTo(this.maps.road) : this.potholeLayer.remove();
    },

    /* ---------- selection and URL ---------- */

    selectFromUrl(push) {
        const id = parseInt(new URLSearchParams(location.search).get('cor'), 10);
        if (Number.isInteger(id) && this.corridors.some(c => c.id === id)) this.select(id, { push });
    },

    /* Select a corridor: highlight and zoom to it on the map, load its report and update the URL,
       but stay where the user is; "View report" (below the table and map) scrolls to it.
       scroll: true goes straight to the report (used from inside a report, e.g. the equity dot plot). */
    async select(id, { push = true, scroll = false } = {}) {
        this.selected = id;
        const c = this.corridors.find(x => x.id === id);
        if (push) history.pushState({ id }, '', `?cor=${id}`);
        this.renderList();
        this.showOnMap(id);

        const sel = document.getElementById('selection');
        sel.hidden = false;
        document.getElementById('selection-name').textContent = c.name;

        const d = await fetch(`${DATA}corridor/${id}.json`, NO_CACHE).then(r => r.json());
        this.report = d;
        this.renderReport(d);

        document.title = `${d.name} | Corridor Performance Dashboard`;
        document.getElementById('announcer').textContent = scroll
            ? `Showing the report for ${d.name}.`
            : `${d.name} selected. Its report is ready below; use View report to go to it.`;
        if (scroll) this.viewReport();
    },

    renderReport(d) {
        resetCharts();
        ['profile', 'road'].forEach(k => { this.maps[k]?.remove(); delete this.maps[k]; });
        this.roadLayer = this.potholeLayer = this.roadLayers = null;

        document.getElementById('report').hidden = false;
        document.getElementById('report-title').textContent = d.name;
        const roads = document.getElementById('report-roads');
        roads.textContent = d.roads ?? '';
        roads.hidden = !d.roads;

        const rendered = SECTIONS.map(s => ({ s, html: s.render(d) })).filter(x => x.html);
        document.getElementById('report-body').innerHTML = rendered.map(x => x.html).join('');
        rendered.forEach(x => x.s.after?.(d));
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
