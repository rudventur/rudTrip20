import { CONTINENTS, SHAPES, lonLatToXy, unionBbox } from "./continents.js";

export function createGlobe(svg, state) {
  const ns = "http://www.w3.org/2000/svg";
  const W = 1000;
  const H = 500;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const sea = document.createElementNS(ns, "rect");
  sea.setAttribute("width", W);
  sea.setAttribute("height", H);
  sea.setAttribute("fill", "#10110e");
  svg.appendChild(sea);

  const landGroup = document.createElementNS(ns, "g");
  svg.appendChild(landGroup);
  const overlay = document.createElementNS(ns, "g");
  svg.appendChild(overlay);

  const paths = {};
  for (const [id, ring] of Object.entries(SHAPES)) {
    const d = ring.map((p, i) => {
      const [x, y] = lonLatToXy(p[0], p[1], W, H);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z";
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("data-id", id);
    path.classList.add("land", "on");
    path.addEventListener("click", () => {
      state.continents[id] = !state.continents[id];
      if (!Object.values(state.continents).some(Boolean)) state.continents[id] = true;
      paint();
      state.onChange();
    });
    landGroup.appendChild(path);
    paths[id] = path;
  }

  function paint() {
    for (const [id, path] of Object.entries(paths)) {
      path.classList.toggle("on", !!state.continents[id]);
      path.classList.toggle("off", !state.continents[id]);
    }
    const on = Object.entries(state.continents).filter(([, v]) => v).map(([k]) => k);
    if (on.length === 1) {
      const [s, w, n, e] = CONTINENTS[on[0]].bbox;
      const [x1, y1] = lonLatToXy(w, n, W, H);
      const [x2, y2] = lonLatToXy(e, s, W, H);
      const pad = 18;
      svg.setAttribute("viewBox", `${x1 - pad} ${y1 - pad} ${Math.max(40, x2 - x1 + pad * 2)} ${Math.max(40, y2 - y1 + pad * 2)}`);
    } else {
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    }
    overlay.innerHTML = "";
    if (state.start && state.target) {
      const a = lonLatToXy(state.start.lon, state.start.lat, W, H);
      const b = lonLatToXy(state.target.lon, state.target.lat, W, H);
      const midX = (a[0] + b[0]) / 2;
      const midY = Math.min(a[1], b[1]) - Math.abs(b[0] - a[0]) * 0.18;
      const arc = document.createElementNS(ns, "path");
      arc.setAttribute("d", `M${a[0]},${a[1]} Q${midX},${midY} ${b[0]},${b[1]}`);
      arc.setAttribute("class", "arc");
      overlay.appendChild(arc);
    }
    const extras = state.extras || [];
    for (const pin of [state.start, state.target, ...extras]) {
      if (!pin) continue;
      const [x, y] = lonLatToXy(pin.lon, pin.lat, W, H);
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", x);
      c.setAttribute("cy", y);
      c.setAttribute("r", 5);
      c.setAttribute("class", "pin");
      overlay.appendChild(c);
    }
  }

  paint();
  return { paint, unionBbox: () => unionBbox(Object.entries(state.continents).filter(([, v]) => v).map(([k]) => k)) };
}
