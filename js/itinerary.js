const SPEEDS = { walk: 4.5, bike: 16, bus: 35, taxi: 40, train: 90, ferry: 28, flight: 720 };

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hoursFor(km, mode) {
  const speed = SPEEDS[mode] || 40;
  const raw = Math.max(1, km) / speed;
  const overhead = mode === "flight" ? 1.4 : mode === "train" ? 0.35 : 0.15;
  const wiggle = 0.12 + Math.random() * 0.18;
  return Math.max(0.3, (raw + overhead) * (1 + (Math.random() < 0.5 ? -wiggle : wiggle)));
}

function fmtHours(h) {
  const n = Math.round(h * 2) / 2;
  return n % 1 === 0 ? `${n}h` : String(n).replace(".5", ",5") + "hours";
}

function modePool(modes) {
  const enabled = Object.entries(modes).filter(([, v]) => v).map(([k]) => k);
  return enabled.length ? enabled : ["walk", "train"];
}

function chooseMode(pool, km) {
  const ok = pool.filter((m) => {
    if (m === "walk") return km < 25;
    if (m === "bike") return km < 80;
    if (m === "flight") return km > 250;
    if (m === "ferry") return km > 8;
    return true;
  });
  return pick(ok.length ? ok : pool);
}

const HUBS = ["a border station", "the next harbour", "a night bus depot", "the old airport", "a market square"];

export function engineOpts(modes) {
  return { ...modes };
}

export function buildStory({ startName, start, target, modes, days, returning, extras = [] }) {
  const points = [target, ...extras].filter(Boolean);
  const pool = modePool(modes);
  const steps = [];
  let from = start;
  const maxHops = Math.min(5, Math.max(1, days + points.length - 1));

  points.forEach((pt, idx) => {
    const km = window.TripSearchEngine.haversineKm(from.lat, from.lon, pt.lat, pt.lon);
    if (idx === 0 && maxHops > 1 && km > 80) {
      const viaKm = km * (0.25 + Math.random() * 0.2);
      const viaMode = chooseMode(pool, viaKm);
      steps.push({ mode: viaMode, hours: hoursFor(viaKm, viaMode), to: HUBS[idx % HUBS.length] });
    }
    const mode = chooseMode(pool, km);
    steps.push({ mode, hours: hoursFor(km, mode), to: pt.name });
    from = pt;
  });

  if (returning) {
    const km = window.TripSearchEngine.haversineKm(from.lat, from.lon, start.lat, start.lon);
    const mode = chooseMode(pool, km);
    steps.push({ mode, hours: hoursFor(km, mode), to: startName });
  }

  const lines = [
    `START · ${startName}`,
    ...steps.map((s) => `[you choose ${s.mode.toUpperCase()} · ~${fmtHours(s.hours)} · to ${s.to}]`),
    "FINISH"
  ];
  return { lines, steps };
}
