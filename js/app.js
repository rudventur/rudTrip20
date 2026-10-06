import { CONTINENTS, shrinkBbox } from "./continents.js";
import { createGlobe } from "./globe.js";
import { buildStory } from "./itinerary.js";
import { loadNews } from "./news.js";
import { loadWeather, wxCode } from "./weather.js";

const state = {
  continents: {
    africa: true, europe: true, asia: true,
    "north-america": true, "south-america": true, oceania: true, antarctica: false
  },
  countries: {},
  worlds: { places: true, businesses: false, ruins: true, beauty: false, topographic: false, astronomical: false },
  era: "present",
  modes: { walk: true, bike: true, bus: true, taxi: true, train: true, ferry: false, flight: true },
  days: 1,
  returning: false,
  start: { lat: 51.5074, lon: -0.1278 },
  startName: "London",
  target: null,
  extras: [],
  onChange() { renderRegions(); globe.paint(); }
};

const svg = document.getElementById("globe");
const globe = createGlobe(svg, state);

function leafletBoundsFromBbox(bbox) {
  const [s, w, n, e] = bbox;
  return { getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e };
}
function activeContinentIds() {
  return Object.entries(state.continents).filter(([, v]) => v).map(([k]) => k);
}
function selectedCountries() {
  const ids = activeContinentIds();
  const names = [];
  ids.forEach((id) => {
    (CONTINENTS[id].countries || []).forEach((c) => {
      if (state.countries[c] !== false) names.push(c);
    });
  });
  return names;
}
function searchBbox() {
  const engine = window.TripSearchEngine;
  const countries = selectedCountries();
  if (countries.length && engine?.countryCentroid) {
    const name = countries[Math.floor(Math.random() * countries.length)];
    const c = engine.countryCentroid(name);
    if (c) return engine.bboxAroundCentroid(c[0], c[1], 2.2, 2.8);
  }
  return shrinkBbox(globe.unionBbox());
}
function fakeMap() {
  return { getBounds: () => leafletBoundsFromBbox(searchBbox()) };
}
function engineMode(kind) {
  if (kind === "event") return "event";
  if (kind === "trip") return "both";
  return "place";
}

// The news and weather bars open and close through js/panel-toggle.js
// (js/globe-panels.js), like every other panel.

function renderContinents() {
  const box = document.getElementById("continent-ticks");
  box.innerHTML = Object.entries(CONTINENTS).map(([id, c]) =>
    `<label><input type="checkbox" data-cont="${id}" ${state.continents[id] ? "checked" : ""}> ${c.label}</label>`
  ).join("");
  box.querySelectorAll("input").forEach((el) => {
    el.addEventListener("change", () => {
      state.continents[el.dataset.cont] = el.checked;
      if (!activeContinentIds().length) { state.continents[el.dataset.cont] = true; el.checked = true; }
      state.onChange();
    });
  });
}
function renderRegions() {
  const wrap = document.getElementById("region-block");
  const ids = activeContinentIds();
  if (ids.length !== 1) { wrap.hidden = true; return; }
  const cont = CONTINENTS[ids[0]];
  wrap.hidden = false;
  document.getElementById("region-title").textContent = cont.label + " regions";
  const box = document.getElementById("region-ticks");
  box.innerHTML = cont.countries.map((name) =>
    `<label><input type="checkbox" data-country="${name}" ${state.countries[name] !== false ? "checked" : ""}> ${name}</label>`
  ).join("");
  box.querySelectorAll("input").forEach((el) => {
    el.addEventListener("change", () => { state.countries[el.dataset.country] = el.checked; });
  });
}
function bindToggles(sel, bucket) {
  document.querySelectorAll(sel).forEach((el) => {
    el.checked = !!bucket[el.dataset.key];
    el.addEventListener("change", () => { bucket[el.dataset.key] = el.checked; });
  });
}
renderContinents();
renderRegions();
bindToggles("#world-ticks input", state.worlds);
bindToggles("#mode-ticks input", state.modes);
document.querySelectorAll("[data-days]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.days = Number(btn.dataset.days);
    document.querySelectorAll("[data-days]").forEach((b) => b.classList.toggle("on", b === btn));
  });
});
document.querySelectorAll("[data-dir]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.returning = btn.dataset.dir === "return";
    document.querySelectorAll("[data-dir]").forEach((b) => b.classList.toggle("on", b === btn));
  });
});
document.querySelectorAll("[data-era]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.era = btn.dataset.era;
    document.querySelectorAll("[data-era]").forEach((b) => b.classList.toggle("on", b === btn));
  });
});
function setLucky(which) {
  document.querySelectorAll(".lucky[data-lucky]").forEach((b) => {
    b.classList.toggle("on", b.dataset.lucky === which);
  });
}
async function locate() {
  const status = document.getElementById("status");
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300000 });
    });
    state.start = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    state.startName = "GPS";
    status.textContent = "Start locked to GPS.";
  } catch {
    const bbox = globe.unionBbox();
    state.startName = "Random start";
    state.start = {
      lat: bbox[0] + (bbox[2] - bbox[0]) * Math.random(),
      lon: bbox[1] + (bbox[3] - bbox[1]) * Math.random()
    };
    status.textContent = "GPS denied — random start on ticked land.";
  }
  globe.paint();
}
document.getElementById("gps-btn").addEventListener("click", locate);
function paintStory(kind, target, extras = []) {
  state.target = { lat: target.lat, lon: target.lon, name: target.name };
  state.extras = extras;
  globe.paint();
  document.getElementById("target-name").textContent = kind === "trip"
    ? `${target.name} + ${extras.length} more`
    : target.name;
  document.getElementById("target-loc").textContent =
    `${target.loc} · ${target.source}${extras.length ? " · " + extras.map((e) => e.name).join(" · ") : ""}`;
  const story = buildStory({
    startName: state.startName, start: state.start, target, extras,
    modes: state.modes, days: state.days, returning: state.returning
  });
  document.getElementById("chain").innerHTML = story.lines.map((line, i) => {
    if (i === 0 || line === "FINISH") return `<div class="step">${line}</div>`;
    return `<div class="step"><span class="who">${line}</span></div>`;
  }).join("");
}
async function roll(kind) {
  const status = document.getElementById("status");
  const buttons = document.querySelectorAll("[data-lucky]");
  buttons.forEach((b) => { b.disabled = true; });
  status.classList.remove("status-bad");
  setLucky(kind);
  status.textContent = kind === "trip" ? "Rolling a live trip…" : kind === "event" ? "Rolling a live event…" : "Rolling a live place…";
  try {
    const map = fakeMap();
    const say = (m) => { status.textContent = m || "Rolling…"; };
    if (kind === "trip") {
      const count = Math.min(4, 1 + state.days);
      const result = await window.TripSearchEngine.fetchRandomTargets(
        map, engineMode(kind), state.era, "", count, say, state.worlds
      );
      if (!result?.targets?.length) { status.textContent = "No luck this trip."; return; }
      const [first, ...rest] = result.targets;
      paintStory("trip", first, rest);
    } else {
      const result = await window.TripSearchEngine.fetchRandomTarget(
        map, engineMode(kind), state.era, "", say, state.worlds
      );
      if (!result?.target) { status.textContent = "No luck this roll."; return; }
      paintStory(kind, result.target, []);
    }
    status.textContent = "";
  } catch (err) {
    status.textContent = err.message || "Roll failed.";
    status.classList.add("status-bad");
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}
document.getElementById("lucky-place").addEventListener("click", () => roll("place"));
document.getElementById("lucky-event").addEventListener("click", () => roll("event"));
document.getElementById("lucky-trip").addEventListener("click", () => roll("trip"));
async function bootNews() {
  const summary = document.getElementById("news-summary");
  const meta = document.getElementById("news-meta");
  const body = document.getElementById("news-body");
  try {
    const { items, source } = await loadNews();
    meta.textContent = source;
    if (!items.length) { summary.textContent = "No headlines."; return; }
    let i = 0;
    const tick = () => { summary.textContent = items[i % items.length].title; i += 1; };
    tick();
    setInterval(tick, 5000);
    body.innerHTML = `<ul class="news-list">${items.map((it) => `
      <li><time></time><div><a href="${it.url}" target="_blank" rel="noopener">${it.title}</a>
      <span class="news-source">${it.source}</span></div></li>`).join("")}</ul>`;
  } catch { summary.textContent = "News offline."; }
}
async function bootWeather() {
  const summary = document.getElementById("wx-summary");
  const body = document.getElementById("wx-body");
  try {
    const { place, data } = await loadWeather(state.start.lat, state.start.lon, state.startName);
    const cur = data.current;
    summary.textContent = `${Math.round(cur.temperature_2m)}° ${wxCode(cur.weather_code)} · ${place}`;
    body.innerHTML = `<div class="wx-grid">${data.daily.time.map((day, idx) => `
      <div class="wx-card">
        <div class="d">${new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}</div>
        <div class="t">${Math.round(data.daily.temperature_2m_max[idx])}° / ${Math.round(data.daily.temperature_2m_min[idx])}°</div>
        <div class="c">${wxCode(data.daily.weather_code[idx])}</div>
      </div>`).join("")}</div>`;
  } catch { summary.textContent = "Weather offline."; }
}
locate().then(() => { bootNews(); bootWeather(); });
