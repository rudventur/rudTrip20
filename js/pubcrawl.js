// ---- Trip20 Pub Crawl: random pub route from live OpenStreetMap data ----
// Self-contained: own ids (pc*), own Leaflet map, own localStorage keys.
(function () {
  const $ = id => document.getElementById(id);
  const root = $('pubCrawl');
  if (!root) return;

  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  const CACHE_KEY = 'rudTrip20.pubs.v1', CACHE_TTL = 6 * 3600 * 1000, WALK_KMH = 4.8;
  const state = { origin: null, originLabel: '', pubs: [], matches: [], route: [], map: null, layer: null, ohReady: null, lastQuery: 0 };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = (msg, err) => { const el = $('pcStatus'); el.textContent = msg; el.className = 'pc-status' + (err ? ' err' : ''); };
  function km(a, b) {
    const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtKm = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(2) + ' km';
  const fmtMin = d => { const m = Math.round(d / WALK_KMH * 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

  // ---- feature detection from OSM tags: true = yes, false = explicit no, null = unknown ----
  const yes = v => v != null && !/^(no|none|0)$/i.test(v);
  function tri(t, keys, positive) {
    let seen = false;
    for (const k of keys) {
      if (t[k] == null) continue;
      seen = true;
      if (positive ? positive(k, t[k]) : yes(t[k])) return true;
    }
    return seen ? false : null;
  }
  const FEATURES = {
    food: { label: '🍔 Food', test: t => tri(t, ['food', 'kitchen', 'cuisine'], (k, v) => k === 'cuisine' ? yes(v) : yes(v)) },
    music: { label: '🎸 Music', test: t => tri(t, ['live_music', 'music', 'karaoke', 'music:live'], (k, v) => yes(v)) },
    cocktails: { label: '🍸 Cocktails', test: t => tri(t, ['cocktails', 'drink:cocktail', 'drink:cocktails'], (k, v) => yes(v)) },
    garden: { label: '🌳 Beer garden', test: t => tri(t, ['beer_garden', 'outdoor_seating'], (k, v) => yes(v)) },
    realale: { label: '🍺 Real ale', test: t => tri(t, ['real_ale'], (k, v) => yes(v)) },
    wheelchair: { label: '♿ Wheelchair', test: t => tri(t, ['wheelchair'], (k, v) => /^(yes|designated|limited)$/i.test(v)) },
    open: { label: '🕒 Open now', test: t => openNow(t) }
  };

  function openNow(t) {
    if (!t.opening_hours || !window.opening_hours) return null;
    try { return new window.opening_hours(t.opening_hours, null, 0).getState(new Date()); } catch { return null; }
  }
  function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  function ensureOH() {
    if (!state.ohReady) state.ohReady = loadScript('https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/opening_hours@3.15.0/build/opening_hours.js'))
      .catch(() => { state.ohReady = null; });
    return state.ohReady;
  }

  // ---- data ----
  function cacheGet(key) {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[key]; return c && Date.now() - c.t < CACHE_TTL ? c.d : null; } catch { return null; }
  }
  function cacheSet(key, d) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[key] = { t: Date.now(), d };
      const keys = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
      keys.slice(6).forEach(k => delete all[k]);           // keep the 6 newest searches only
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch { /* storage full: just skip caching */ }
  }
  async function fetchPubs(lat, lon, radiusM, bars) {
    const amen = bars ? 'pub|bar|biergarten' : 'pub';
    const key = [lat.toFixed(3), lon.toFixed(3), radiusM, amen].join('|');
    const hit = cacheGet(key);
    if (hit) return { pubs: hit, cached: true };
    const q = `[out:json][timeout:25];nwr["amenity"~"^(${amen})$"]["name"](around:${radiusM},${lat},${lon});out center tags;`;
    let lastErr;
    for (const url of MIRRORS.concat(MIRRORS)) {           // two passes: public mirrors are often briefly busy
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const pubs = j.elements.map(e => ({
          id: e.type + '/' + e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: e.tags || {}
        })).filter(p => p.lat != null);
        cacheSet(key, pubs);
        return { pubs, cached: false };
      } catch (e) { lastErr = e; console.warn('Overpass', url, e.message); await new Promise(r => setTimeout(r, 1200)); } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('Overpass unavailable');
  }
  async function geocode(text) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(text), { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    if (!j.length) throw new Error('Place not found');
    return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name.split(',').slice(0, 2).join(',') };
  }

  // ---- filtering ----
  function activeFilters() { return [...root.querySelectorAll('.pc-filter input:checked')].map(i => i.value); }
  function applyFilters() {
    const f = activeFilters(), unk = $('pcUnknown').checked, r = +$('pcRadius').value;
    state.matches = state.pubs.filter(p => {
      p.dist = km(state.origin, p);
      if (p.dist > r) return false;
      return f.every(k => { const v = FEATURES[k].test(p.tags); return v === true || (unk && v === null); });
    });
    const counts = Object.keys(FEATURES).map(k => {
      const n = state.pubs.filter(p => p.dist <= r && FEATURES[k].test(p.tags) === true).length;
      return `${FEATURES[k].label} ${n}`;
    }).join(' · ');
    $('pcCounts').textContent = state.pubs.length ? `${state.pubs.filter(p => p.dist <= r).length} places in radius — tagged: ${counts}` : '';
    return state.matches;
  }

  // ---- route ----
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function order(stops) {
    const left = stops.slice(), out = []; let cur = state.origin;
    while (left.length) {
      let bi = 0; left.forEach((p, i) => { if (km(cur, p) < km(cur, left[bi])) bi = i; });
      cur = left.splice(bi, 1)[0]; out.push(cur);
    }
    return out;
  }
  function roll() {
    applyFilters();
    const n = +$('pcStops').value;
    if (!state.matches.length) { state.route = []; render(); status('No pubs match those filters here. Try a bigger radius, fewer filters, or tick "include unknown".', true); return; }
    state.route = order(shuffle(state.matches.slice()).slice(0, n));
    render();
    status(state.matches.length < n ? `Only ${state.matches.length} pubs match, so the crawl has ${state.route.length} stops.` : `Picked ${state.route.length} of ${state.matches.length} matching pubs at random.`);
  }
  function rerollOne(i) {
    const used = new Set(state.route.map(p => p.id));
    const pool = state.matches.filter(p => !used.has(p.id));
    if (!pool.length) { status('No other matching pubs to swap in.', true); return; }
    state.route[i] = pool[Math.floor(Math.random() * pool.length)];
    state.route = order(state.route);
    render();
  }

  // ---- render ----
  function chips(t) {
    return ['food', 'music', 'cocktails', 'garden', 'realale', 'wheelchair', 'open'].map(k => {
      const v = FEATURES[k].test(t);
      if (v === null) return '';
      return `<span class="pc-chip ${v ? 'y' : 'n'}">${FEATURES[k].label}${v ? '' : ' ✗'}</span>`;
    }).join('');
  }
  function gmapsUrl() {
    const pts = state.route.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6));
    const o = state.origin.lat.toFixed(6) + ',' + state.origin.lon.toFixed(6);
    return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=' + o + '&destination=' + pts[pts.length - 1] + (pts.length > 1 ? '&waypoints=' + encodeURIComponent(pts.slice(0, -1).join('|')) : '');
  }
  function ensureMap() {
    if (state.map || !window.L) return;
    state.map = L.map('pcMap', { scrollWheelZoom: false, tap: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
    state.layer = L.layerGroup().addTo(state.map);
  }
  function render() {
    ensureMap();
    const list = $('pcList'), sum = $('pcSummary');
    if (state.map) {
      state.layer.clearLayers();
      const routeIds = new Set(state.route.map(p => p.id));
      state.matches.filter(p => !routeIds.has(p.id)).forEach(p =>
        L.circleMarker([p.lat, p.lon], { radius: 4, color: '#2f6b3a', fillColor: '#39ff14', fillOpacity: 0.35, weight: 1 }).bindPopup(esc(p.tags.name)).addTo(state.layer));
      L.marker([state.origin.lat, state.origin.lon], { icon: L.divIcon({ className: 'pc-pin start', html: '★', iconSize: [26, 26] }) }).bindPopup('Start').addTo(state.layer);
      const line = [[state.origin.lat, state.origin.lon], ...state.route.map(p => [p.lat, p.lon])];
      if (state.route.length) L.polyline(line, { color: '#39ff14', weight: 4, dashArray: '8 6' }).addTo(state.layer);
      state.route.forEach((p, i) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pc-pin', html: String(i + 1), iconSize: [26, 26] }) }).bindPopup(`<b>${i + 1}. ${esc(p.tags.name)}</b>`).addTo(state.layer));
      setTimeout(() => {
        state.map.invalidateSize();
        if (state.route.length) state.map.fitBounds(line, { padding: [30, 30] });
        else state.map.setView([state.origin.lat, state.origin.lon], 15);
      }, 50);
    }
    if (!state.route.length) { list.innerHTML = ''; sum.innerHTML = ''; $('pcActions').hidden = true; return; }
    let total = 0, prev = state.origin;
    list.innerHTML = state.route.map((p, i) => {
      const leg = km(prev, p); total += leg; prev = p;
      const t = p.tags, web = t.website || t['contact:website'], tel = t.phone || t['contact:phone'];
      const safeWeb = web && /^https?:\/\//i.test(web) ? web : web ? 'https://' + web : '';
      const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      return `<li class="pc-card">
        <div class="pc-num">${i + 1}</div>
        <div class="pc-body">
          <div class="pc-name">${esc(t.name)} <span class="pc-kind">${esc(t.amenity)}</span></div>
          <div class="pc-meta">${fmtKm(p.dist)} from start · walk ${fmtKm(leg)} (~${fmtMin(leg)}) from ${i ? 'stop ' + i : 'start'}${addr ? ' · ' + esc(addr) : ''}</div>
          <div class="pc-chips">${chips(t) || '<span class="pc-chip u">no extra tags in OSM</span>'}</div>
          ${t.opening_hours ? `<div class="pc-meta">🕒 ${esc(t.opening_hours)}</div>` : ''}
          <div class="pc-links">
            ${safeWeb ? `<a href="${esc(safeWeb)}" target="_blank" rel="noopener">🌐 Website</a>` : ''}
            ${tel ? `<a href="tel:${esc(tel.split(';')[0].replace(/\s/g, ''))}">📞 ${esc(tel.split(';')[0])}</a>` : ''}
            <a href="https://www.openstreetmap.org/${esc(p.id)}" target="_blank" rel="noopener">OSM</a>
            <button type="button" class="pc-swap" data-i="${i}">🎲 Swap this stop</button>
          </div>
        </div></li>`;
    }).join('');
    sum.innerHTML = `<b>${state.route.length} stops</b> · ${fmtKm(total)} walking · ~${fmtMin(total)} on foot (not counting drinking time 😉)`;
    $('pcGmaps').href = gmapsUrl();
    $('pcActions').hidden = false;
    list.querySelectorAll('.pc-swap').forEach(b => b.onclick = () => rerollOne(+b.dataset.i));
  }

  // ---- search flow ----
  async function search() {
    if (Date.now() - state.lastQuery < 1500) return;     // debounce double taps
    state.lastQuery = Date.now();
    if (!state.origin) { state.origin = { lat: 51.5136, lon: -0.1365 }; state.originLabel = 'London (Soho)'; }
    $('pcWhere').textContent = 'Start: ' + state.originLabel;
    const radiusM = Math.round(+$('pcRadius').value * 1000);   // fetch the chosen radius; shrinking the slider filters locally
    state.fetchedKm = radiusM / 1000;
    status('Searching OpenStreetMap for pubs…');
    try {
      const { pubs, cached } = await fetchPubs(state.origin.lat, state.origin.lon, radiusM, $('pcBars').checked);
      state.pubs = pubs;
      status(`Found ${pubs.length} named places within ${radiusM / 1000} km${cached ? ' (cached)' : ''}. Rolling…`);
      if (activeFilters().includes('open') || pubs.some(p => p.tags.opening_hours)) await ensureOH();
      roll();
    } catch (e) {
      status('Could not reach the OpenStreetMap pub servers (' + e.message + '). Try again in a minute.', true);
    }
  }
  $('pcGps').onclick = () => {
    if (!navigator.geolocation) { status('No GPS in this browser — type a place instead.', true); return; }
    status('Getting your location…');
    navigator.geolocation.getCurrentPosition(p => {
      state.origin = { lat: p.coords.latitude, lon: p.coords.longitude }; state.originLabel = 'your location'; state.lastQuery = 0; search();
    }, () => status('Location blocked — type a place instead (default is London).', true), { timeout: 10000, maximumAge: 300000 });
  };
  $('pcPlaceForm').onsubmit = async ev => {
    ev.preventDefault();
    const q = $('pcPlace').value.trim(); if (!q) return;
    status('Finding ' + q + '…');
    try { const g = await geocode(q); state.origin = g; state.originLabel = g.label; state.lastQuery = 0; search(); }
    catch (e) { status(e.message, true); }
  };
  $('pcRoll').onclick = () => { if (state.pubs.length) roll(); else search(); };
  $('pcReroll').onclick = roll;
  $('pcRadius').oninput = () => { $('pcRadiusVal').textContent = (+$('pcRadius').value).toFixed(1) + ' km'; };
  $('pcStops').oninput = () => { $('pcStopsVal').textContent = $('pcStops').value; };
  $('pcBars').onchange = () => { state.lastQuery = 0; if (state.origin) search(); };
  let radiusTimer;
  $('pcRadius').addEventListener('change', () => {
    clearTimeout(radiusTimer);
    radiusTimer = setTimeout(() => {
      if (state.origin && +$('pcRadius').value > (state.fetchedKm || 0)) { state.lastQuery = 0; search(); }
      else if (state.pubs.length) roll();
    }, 700);
  });
  root.querySelectorAll('.pc-filter input, #pcUnknown').forEach(i => i.addEventListener('change', async () => {
    if (i.value === 'open') await ensureOH();
    if (state.pubs.length) roll();
  }));
  // first open: build the map when the panel becomes visible
  root.addEventListener('toggle', () => { if (root.open) { ensureMap(); if (state.map && !state.origin) state.map.setView([51.5136, -0.1365], 13); } });
  window.TripPubCrawl = { state, search, roll, FEATURES };
})();
