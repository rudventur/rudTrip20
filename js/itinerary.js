const SPEEDS = { walk: 4.5, bike: 16, bus: 35, taxi: 40, train: 90, ferry: 28, flight: 720 };
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function hoursFor(km, mode) {
  const speed = SPEEDS[mode] || 40;
  const raw = km / speed;
  const overhead = mode === "flight" ? 1.4 : mode === "train" ? 0.35 : 0.15;
  const h = raw + overhead;
  const wiggle = 0.15 + Math.random() * 0.2;
  return Math.max(0.3, h * (1 + (Math.random() < 0.5 ? -wiggle : wiggle)));
}
function fmtHours(h) {
  const n = Math.round(h * 2) / 2;
  return n % 1 === 0 ? `${n}h` : `${n}hours`.replace(".5", ",5");
}
export function buildStory({ startName, start, target, modes, days, returning }) {
  const enabled = Object.entries(modes).filter(([, v]) => v).map(([k]) => k);
  const pool = enabled.length ? enabled : ["walk", "train"];
  const km = window.TripSearchEngine.haversineKm(start.lat, start.lon, target.lat, target.lon);
  const hops = km > days * 900 ? Math.min(5, 2 + days) : Math.min(4, 1 + days);
  const steps = [];
  let remaining = km;
  for (let i = 0; i < hops - 1; i++) {
    const mode = pick(pool);
    const slice = remaining * (0.15 + Math.random() * 0.35);
    remaining -= slice;
    steps.push({ mode, hours: hoursFor(slice, mode), to: midName(i) });
  }
  steps.push({ mode: pick(pool), hours: hoursFor(Math.max(remaining, 8), pick(pool)), to: target.name });
  if (returning) steps.push({ mode: pick(pool), hours: hoursFor(km, pick(pool)), to: startName });
  const lines = [`START · ${startName}`, ...steps.map((s) => `[you choose ${s.mode.toUpperCase()} · ~${fmtHours(s.hours)} · to ${s.to}]`), "FINISH"];
  return { lines, steps, km: Math.round(km) };
}
function midName(i) {
  return ["a border station", "the next harbour", "a night bus depot", "the old airport", "a market square"][i % 5];
}
