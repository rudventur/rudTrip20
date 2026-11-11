// ---- Trip20 Pub Crawl: random pub route from live OpenStreetMap data ----
// Self-contained: own ids (pc*), own Leaflet map, own localStorage keys.
(function () {
  const $ = id => document.getElementById(id);
  const root = $('pubCrawl');
  if (!root) return;

  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
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

  // ---- step types → OpenStreetMap tags (verified on taginfo, Oct 2026) ----
  const AMENITIES = 'pub|bar|biergarten|restaurant|cafe|fast_food|nightclub|karaoke_box|music_venue';
  const isA = (t, ...a) => a.includes(t.amenity);
  const no = v => v != null && /^(no|none|0)$/i.test(v);
  const drinkPlace = t => isA(t, 'pub', 'bar', 'biergarten', 'nightclub');
  // match(t) → true = tagged match, null = could be (only counted with "include unknown"), false = no
  const TYPES = {
    pub: { label: 'Pub', icon: '🍺', match: t => isA(t, 'pub') || false },
    bar: { label: 'Bar', icon: '🍹', match: t => isA(t, 'bar') || false },
    cocktail: { label: 'Cocktail bar', icon: '🍸', match: t => {
      if (!isA(t, 'bar', 'pub', 'nightclub', 'restaurant')) return false;
      if (yes(t.cocktails) || yes(t['drink:cocktail']) || yes(t['drink:cocktails']) || /cocktail/i.test(t.bar || '')) return true;
      if (no(t.cocktails) || no(t['drink:cocktail'])) return false;
      return isA(t, 'bar') ? null : false; } },
    restaurant: { label: 'Restaurant', icon: '🍽️', match: t => isA(t, 'restaurant') || false },
    cafe: { label: 'Café', icon: '☕', match: t => isA(t, 'cafe') || false },
    fastfood: { label: 'Fast food', icon: '🍔', match: t => isA(t, 'fast_food') || false },
    nightclub: { label: 'Nightclub (dancing)', icon: '🪩', match: t => isA(t, 'nightclub') || t.leisure === 'dance' || yes(t.dance) || false },
    karaoke: { label: 'Karaoke', icon: '🎤', match: t => {
      if (isA(t, 'karaoke_box') || t.leisure === 'karaoke' || (t.karaoke != null && yes(t.karaoke))) return true;
      if (no(t.karaoke)) return false;
      return drinkPlace(t) ? null : false; } },
    livemusic: { label: 'Live music', icon: '🎸', match: t => {
      if (isA(t, 'music_venue') || yes(t.live_music) || yes(t['music:live'])) return true;
      if (no(t.live_music)) return false;
      return drinkPlace(t) ? null : false; } },
    garden: { label: 'Beer garden', icon: '🌳', match: t => {
      if (isA(t, 'biergarten') || yes(t.beer_garden)) return true;
      if (!isA(t, 'pub', 'bar')) return false;
      if (no(t.beer_garden)) return false;
      return yes(t.outdoor_seating) ? null : (t.beer_garden == null ? null : false); } },
    surprise: { label: 'Surprise me', icon: '🎲', match: null }
  };
  TYPES.surprise.match = t => { let u = false; for (const k in TYPES) { if (k === 'surprise') continue; const v = TYPES[k].match(t); if (v === true) return true; if (v === null) u = null; } return u; };
  const STEP_FILTERS = ['food', 'open', 'wheelchair', 'realale'];
  const STEPS_KEY = 'rudTrip20.steps.v1';
  const newStep = type => ({ type: type || 'pub', f: [] });
  function loadSteps() {
    try { const s = JSON.parse(localStorage.getItem(STEPS_KEY)); if (Array.isArray(s) && s.length) return s.filter(x => TYPES[x.type]).slice(0, 10).map(x => ({ type: x.type, f: (x.f || []).filter(k => STEP_FILTERS.includes(k)) })); } catch { }
    return [newStep('pub'), newStep('pub'), newStep('restaurant')];
  }
  state.steps = loadSteps();
  const saveSteps = () => { try { localStorage.setItem(STEPS_KEY, JSON.stringify(state.steps)); } catch { } };

  // ---- data ----
  function cacheGet(key) {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[key]; return c && Date.now() - c.t < CACHE_TTL ? c.d : null; } catch { return null; }
  }
  function cacheSet(key, d) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[key] = { t: Date.now(), d };
      const keys = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
      keys.slice(4).forEach(k => delete all[k]);           // keep the 4 newest searches only (results are bigger now)
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch { /* storage full: just skip caching */ }
  }
  const KEEP_TAGS = /^(name|amenity|leisure|cuisine|food|kitchen|cocktails|drink:.*|bar|karaoke|live_music|music.*|dance|beer_garden|outdoor_seating|real_ale|wheelchair|opening_hours|website|contact:website|phone|contact:phone|addr:street|addr:housenumber)$/;
  async function fetchPubs(lat, lon, radiusM) {
    const key = [lat.toFixed(3), lon.toFixed(3), radiusM, 'all2'].join('|');
    const hit = cacheGet(key);
    if (hit) return { pubs: hit, cached: true };
    const ar = `(around:${radiusM},${lat},${lon})`;
    // one query, exact-match union (much lighter on Overpass than a regex)
    const q = `[out:json][timeout:40];(${AMENITIES.split('|').map(a => `nwr["amenity"="${a}"]["name"]${ar};`).join('')}nwr["leisure"="dance"]["name"]${ar};nwr["leisure"="karaoke"]["name"]${ar};);out center tags;`;
    let lastErr;
    for (const url of MIRRORS.concat(MIRRORS)) {           // two passes: public mirrors are often briefly busy
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const pubs = j.elements.map(e => {
          const tags = {}; for (const k in (e.tags || {})) if (KEEP_TAGS.test(k)) tags[k] = e.tags[k];
          return { id: e.type + '/' + e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags };
        }).filter(p => p.lat != null);
        cacheSet(key, pubs);
        return { pubs, cached: false };
      } catch (e) { lastErr = e; console.warn('Overpass', url, e.message); await new Promise(r => setTimeout(r, 1200)); } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('Overpass unavailable');
  }
  async function geocode(text) {
    const look = async q => (await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } })).json();
    const isPlace = x => x.category === 'place' || x.category === 'boundary';
    let j = await look(text);
    // "Soho London" can match a shop called that; retry as "Soho, London" when no real place came back
    if (!j.some(isPlace) && !text.includes(',') && /\s/.test(text.trim())) {
      const w = text.trim().split(/\s+/), alt = w.slice(0, -1).join(' ') + ', ' + w[w.length - 1];
      const j2 = await look(alt); if (j2.some(isPlace)) j = j2;
    }
    if (!j.length) throw new Error('Place not found');
    // prefer real places (cities, districts, areas) over random shops that happen to share the name
    const named = /^(city|town|village|suburb|quarter|neighbourhood|city_district|borough|hamlet)$/;
    const g = j.find(x => isPlace(x) && named.test(x.addresstype)) || j.find(isPlace) || j.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0))[0];
    return { lat: +g.lat, lon: +g.lon, label: g.display_name.split(',').slice(0, 2).join(',') };
  }

  // ---- per-step matching ----
  function stepPool(step) {
    const unk = $('pcUnknown').checked, r = +$('pcRadius').value, T = TYPES[step.type];
    return state.pubs.filter(p => {
      if (p.dist > r) return false;
      const m = T.match(p.tags); if (!(m === true || (unk && m === null))) return false;
      return step.f.every(k => { const v = FEATURES[k].test(p.tags); return v === true || (unk && v === null); });
    });
  }
  function applyFilters() {
    const r = +$('pcRadius').value;
    state.pubs.forEach(p => { p.dist = km(state.origin, p); });
    const inR = state.pubs.filter(p => p.dist <= r);
    state.pools = state.steps.map(stepPool);
    state.matches = [...new Map(state.pools.flat().map(p => [p.id, p])).values()];
    const counts = Object.keys(TYPES).filter(k => k !== 'surprise').map(k => `${TYPES[k].icon} ${TYPES[k].label} ${inR.filter(p => TYPES[k].match(p.tags) === true).length}`).join(' · ');
    $('pcCounts').textContent = state.pubs.length ? `${inR.length} places in radius — tagged: ${counts}` : '';
    return state.matches;
  }

  // ---- route: keep step order, each stop random among the nearest few to the previous stop ----
  const NEAR_N = 6;
  function pickNear(pool, from, used) {
    const c = pool.filter(p => !used.has(p.id)).sort((a, b) => km(from, a) - km(from, b)).slice(0, NEAR_N);
    return c.length ? c[Math.floor(Math.random() * c.length)] : null;
  }
  function roll() {
    applyFilters();
    const used = new Set(); let prev = state.origin;
    state.route = state.steps.map((s, i) => {
      const p = pickNear(state.pools[i], prev, used);
      if (p) { used.add(p.id); prev = p; }
      return p;
    });
    render();
    const empty = state.route.map((p, i) => p ? 0 : i + 1).filter(Boolean);
    status(empty.length ? `No match for step ${empty.join(', ')} — see the tips on ${empty.length > 1 ? 'those steps' : 'that step'}. The rest of the crawl is built.` : `Built ${state.route.length} stops in your order, each one a random pick close to the previous stop.`, !!empty.length);
  }
  function rerollOne(i) {
    applyFilters();
    const used = new Set(state.route.filter(Boolean).map(p => p.id));
    const prev = state.route.slice(0, i).reverse().find(Boolean) || state.origin;
    const pool = state.pools[i].filter(p => !used.has(p.id));
    const c = pool.sort((a, b) => km(prev, a) - km(prev, b)).slice(0, NEAR_N);
    if (!c.length) { status(`No other ${TYPES[state.steps[i].type].label.toLowerCase()} matches to swap in for step ${i + 1}.`, true); return; }
    state.route[i] = c[Math.floor(Math.random() * c.length)];
    render();
  }

  // ---- step builder UI ----
  function renderSteps() {
    const box = $('pcSteps');
    box.innerHTML = state.steps.map((s, i) => `<li class="pc-step" data-i="${i}">
      <div class="pc-step-head"><span class="pc-num sm">${i + 1}</span>
        <select class="pc-type" aria-label="Step ${i + 1} type">${Object.entries(TYPES).map(([k, T]) => `<option value="${k}"${k === s.type ? ' selected' : ''}>${T.icon} ${T.label}</option>`).join('')}</select>
        <button type="button" class="pc-mini" data-a="up" ${i ? '' : 'disabled'} aria-label="Move up">▲</button>
        <button type="button" class="pc-mini" data-a="down" ${i < state.steps.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button>
        <button type="button" class="pc-mini x" data-a="del" ${state.steps.length > 1 ? '' : 'disabled'} aria-label="Remove step">✕</button></div>
      <div class="pc-step-f">${STEP_FILTERS.map(k => `<label class="pc-filter sm"><input type="checkbox" value="${k}"${s.f.includes(k) ? ' checked' : ''}>${FEATURES[k].label}</label>`).join('')}</div>
      <div class="pc-step-msg"></div></li>`).join('');
    $('pcAddStep').disabled = state.steps.length >= 10;
    $('pcAddStep').textContent = state.steps.length >= 10 ? 'Max 10 steps' : '➕ Add step';
    box.querySelectorAll('.pc-step').forEach(li => {
      const i = +li.dataset.i;
      li.querySelector('.pc-type').onchange = e => { state.steps[i].type = e.target.value; stepsChanged(); };
      li.querySelectorAll('.pc-step-f input').forEach(cb => cb.onchange = async () => {
        if (cb.value === 'open' && cb.checked) await ensureOH();
        state.steps[i].f = [...li.querySelectorAll('.pc-step-f input:checked')].map(x => x.value); stepsChanged(true);
      });
      li.querySelectorAll('.pc-mini').forEach(b => b.onclick = () => {
        const a = b.dataset.a, S = state.steps;
        if (a === 'del') S.splice(i, 1);
        else { const j = a === 'up' ? i - 1 : i + 1; [S[i], S[j]] = [S[j], S[i]]; }
        stepsChanged();
      });
    });
  }
  function stepsChanged(keepUI) {
    saveSteps();
    if (!keepUI) renderSteps();
    if (state.pubs.length) roll();
  }
  function stepMessages() {
    document.querySelectorAll('#pcSteps .pc-step').forEach((li, i) => {
      const msg = li.querySelector('.pc-step-msg'), p = state.route[i];
      if (!state.pubs.length || !state.pools) { msg.innerHTML = ''; return; }
      if (p) { msg.className = 'pc-step-msg ok'; msg.textContent = `→ ${p.tags.name} (${state.pools[i].length} match${state.pools[i].length === 1 ? '' : 'es'})`; return; }
      const tips = [];
      if (+$('pcRadius').value < 5) tips.push('widen "Close by"');
      if (!$('pcUnknown').checked) tips.push('tick "include unknown"');
      if (state.steps[i].f.length) tips.push('untick some extras');
      tips.push('pick another type');
      msg.className = 'pc-step-msg err';
      msg.textContent = `No ${TYPES[state.steps[i].type].label.toLowerCase()} found${state.pools[i].length ? ' that isn\'t already used' : ' here'}. Try: ${tips.join(', ')}.`;
    });
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
    const pts = state.route.filter(Boolean).map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6));
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
    stepMessages();
    const R = state.route.filter(Boolean);
    const list = $('pcList'), sum = $('pcSummary');
    if (state.map) {
      state.layer.clearLayers();
      const routeIds = new Set(R.map(p => p.id));
      state.matches.filter(p => !routeIds.has(p.id)).forEach(p =>
        L.circleMarker([p.lat, p.lon], { radius: 4, color: '#2f6b3a', fillColor: '#39ff14', fillOpacity: 0.35, weight: 1 }).bindPopup(esc(p.tags.name)).addTo(state.layer));
      L.marker([state.origin.lat, state.origin.lon], { icon: L.divIcon({ className: 'pc-pin start', html: '★', iconSize: [26, 26] }) }).bindPopup('Start').addTo(state.layer);
      const line = [[state.origin.lat, state.origin.lon], ...R.map(p => [p.lat, p.lon])];
      if (R.length) L.polyline(line, { color: '#39ff14', weight: 4, dashArray: '8 6' }).addTo(state.layer);
      state.route.forEach((p, i) => { if (!p) return; const T = TYPES[state.steps[i].type];
        L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'pc-pin typed', html: `<b>${i + 1}</b><i>${T.icon}</i>`, iconSize: [40, 26] }) }).bindPopup(`<b>${i + 1}. ${esc(p.tags.name)}</b><br>${T.icon} ${T.label}`).addTo(state.layer); });
      setTimeout(() => {
        state.map.invalidateSize();
        if (R.length) state.map.fitBounds(line, { padding: [30, 30] });
        else state.map.setView([state.origin.lat, state.origin.lon], 15);
      }, 50);
    }
    if (!R.length) { list.innerHTML = ''; sum.innerHTML = ''; $('pcActions').hidden = true; return; }
    let total = 0, prev = state.origin;
    let lastN = 0;
    list.innerHTML = state.route.map((p, i) => {
      const T = TYPES[state.steps[i].type];
      if (!p) return `<li class="pc-card miss"><div class="pc-num">${i + 1}</div><div class="pc-body"><div class="pc-name">${T.icon} ${esc(T.label)} — no match</div><div class="pc-meta">Skipped. Widen the radius, tick "include unknown" or change this step's type.</div></div></li>`;
      const from = lastN; lastN = i + 1;
      const leg = km(prev, p); total += leg; prev = p;
      const t = p.tags, web = t.website || t['contact:website'], tel = t.phone || t['contact:phone'];
      const safeWeb = web && /^https?:\/\//i.test(web) ? web : web ? 'https://' + web : '';
      const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      return `<li class="pc-card">
        <div class="pc-num">${i + 1}</div>
        <div class="pc-body">
          <div class="pc-steptype">${T.icon} Step ${i + 1}: ${esc(T.label)}</div>
          <div class="pc-name">${esc(t.name)} <span class="pc-kind">${esc(t.amenity || t.leisure || '')}</span></div>
          <div class="pc-meta">${fmtKm(p.dist)} from start · walk ${fmtKm(leg)} (~${fmtMin(leg)}) from ${from ? 'stop ' + from : 'start'}${addr ? ' · ' + esc(addr) : ''}</div>
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
    sum.innerHTML = `<b>${R.length} stop${R.length === 1 ? '' : 's'}</b> · ${fmtKm(total)} walking · ~${fmtMin(total)} on foot (not counting drinking time 😉)`;
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
    status('Searching OpenStreetMap for pubs, bars, food & clubs…');
    try {
      const { pubs, cached } = await fetchPubs(state.origin.lat, state.origin.lon, radiusM);
      state.pubs = pubs;
      status(`Found ${pubs.length} named places within ${radiusM / 1000} km${cached ? ' (cached)' : ''}. Rolling…`);
      if (state.steps.some(s => s.f.includes('open')) || pubs.some(p => p.tags.opening_hours)) await ensureOH();
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
  $('pcAddStep').onclick = () => { if (state.steps.length < 10) { state.steps.push(newStep('surprise')); stepsChanged(); } };
  renderSteps();
  let radiusTimer;
  $('pcRadius').addEventListener('change', () => {
    clearTimeout(radiusTimer);
    radiusTimer = setTimeout(() => {
      if (state.origin && +$('pcRadius').value > (state.fetchedKm || 0)) { state.lastQuery = 0; search(); }
      else if (state.pubs.length) roll();
    }, 700);
  });
  $('pcUnknown').addEventListener('change', () => { if (state.pubs.length) roll(); });
  // first open: build the map when the panel becomes visible
  root.addEventListener('toggle', () => { if (root.open) { ensureMap(); if (state.map && !state.origin) state.map.setView([51.5136, -0.1365], 13); } });
  window.TripPubCrawl = { state, search, roll, FEATURES, TYPES };
})();
