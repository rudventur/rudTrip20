/* Adaptive GPS grid. Not a street map.
   The randomiser reads getBounds() the same way the old Leaflet map did. */
(function (global) {
  const STEPS = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  const SHAPES = {
    africa: [[-17,32],[-10,36],[10,37],[32,31],[43,11],[51,11],[43,-11],[40,-15],[32,-26],[19,-35],[12,-18],[13,-8],[8,4],[-5,5],[-10,6],[-17,12],[-17,21],[-17,32]],
    europe: [[-10,36],[-9,42],[-8,43],[-5,48],[-5,58],[-1,60],[5,62],[12,66],[25,71],[30,70],[30,60],[28,53],[24,45],[29,41],[20,40],[12,36],[3,36],[-5,36],[-10,36]],
    asia: [[26,41],[36,36],[44,40],[60,37],[68,37],[77,28],[90,22],[104,1],[109,14],[121,22],[140,35],[142,46],[130,50],[90,55],[80,50],[70,55],[60,50],[45,47],[40,45],[32,41],[26,41]],
    na: [[-168,66],[-140,70],[-105,68],[-84,73],[-60,60],[-55,50],[-68,48],[-80,25],[-97,16],[-105,22],[-117,32],[-124,48],[-153,58],[-168,66]],
    sa: [[-81,12],[-60,8],[-50,2],[-35,-7],[-40,-22],[-54,-28],[-67,-55],[-75,-52],[-71,-18],[-79,-5],[-81,12]],
    oc: [[113,-22],[135,-12],[146,-16],[153,-27],[150,-38],[140,-38],[114,-35],[113,-22]]
  };

  function stepFor(span) {
    const want = span / 6;
    let best = STEPS[STEPS.length - 1];
    for (const s of STEPS) if (s >= want * 0.7) best = s;
    return best;
  }
  function fmt(n, step, pos, neg) {
    const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return Math.abs(n).toFixed(d) + "°" + (n < 0 ? neg : n > 0 ? pos : "");
  }

  function createGridGlobe(host) {
    const ns = "http://www.w3.org/2000/svg";
    const W = 1000, H = 500;
    host.innerHTML = "";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    svg.style.background = "#10110e";
    svg.style.touchAction = "none";
    host.appendChild(svg);

    const view = { lon: 0, lat: 18, lonSpan: 360, latSpan: 150 };
    const pins = [];
    const listeners = { click: [], moveend: [], zoomend: [] };

    function bounds() {
      const south = Math.max(-85, view.lat - view.latSpan / 2);
      const north = Math.min(85, view.lat + view.latSpan / 2);
      const west = view.lon - view.lonSpan / 2;
      const east = view.lon + view.lonSpan / 2;
      return {
        getSouth: () => south, getNorth: () => north,
        getWest: () => west, getEast: () => east
      };
    }
    function xy(lon, lat) {
      return [
        (lon - (view.lon - view.lonSpan / 2)) / view.lonSpan * W,
        ((view.lat + view.latSpan / 2) - lat) / view.latSpan * H
      ];
    }
    function lonLatFromEvent(ev) {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width * W;
      const y = (ev.clientY - r.top) / r.height * H;
      return {
        lat: (view.lat + view.latSpan / 2) - y / H * view.latSpan,
        lng: (view.lon - view.lonSpan / 2) + x / W * view.lonSpan
      };
    }
    function paint() {
      svg.innerHTML = "";
      const sea = document.createElementNS(ns, "rect");
      sea.setAttribute("width", W); sea.setAttribute("height", H); sea.setAttribute("fill", "#10110e");
      svg.appendChild(sea);
      const land = document.createElementNS(ns, "g");
      for (const ring of Object.values(SHAPES)) {
        const d = ring.map((p, i) => {
          const [x, y] = xy(p[0], p[1]);
          return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
        }).join(" ") + " Z";
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("fill", "#3d4430");
        path.setAttribute("stroke", "#e8d48a");
        path.setAttribute("stroke-width", "1.2");
        land.appendChild(path);
      }
      svg.appendChild(land);
      const lonStep = stepFor(view.lonSpan);
      const latStep = stepFor(view.latSpan);
      const west = view.lon - view.lonSpan / 2, east = view.lon + view.lonSpan / 2;
      const south = view.lat - view.latSpan / 2, north = view.lat + view.latSpan / 2;
      const grid = document.createElementNS(ns, "g");
      for (let lon = Math.ceil(west / lonStep) * lonStep; lon <= east + 1e-9; lon += lonStep) {
        const [x] = xy(lon, 0);
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", x); line.setAttribute("x2", x); line.setAttribute("y1", 0); line.setAttribute("y2", H);
        line.setAttribute("stroke", "rgba(196,176,106,.55)");
        grid.appendChild(line);
        const lab = document.createElementNS(ns, "text");
        lab.setAttribute("x", x + 4); lab.setAttribute("y", 14);
        lab.setAttribute("fill", "#c4b06a"); lab.setAttribute("font-size", "11"); lab.setAttribute("font-family", "ui-monospace, monospace");
        lab.textContent = fmt(Number(lon.toFixed(3)), lonStep, "E", "W");
        grid.appendChild(lab);
      }
      for (let lat = Math.ceil(Math.max(-80, south) / latStep) * latStep; lat <= Math.min(80, north) + 1e-9; lat += latStep) {
        const [, y] = xy(0, lat);
        const line = document.createElementNS(ns, "line");
        line.setAttribute("y1", y); line.setAttribute("y2", y); line.setAttribute("x1", 0); line.setAttribute("x2", W);
        line.setAttribute("stroke", "rgba(196,176,106,.55)");
        grid.appendChild(line);
        const lab = document.createElementNS(ns, "text");
        lab.setAttribute("x", 6); lab.setAttribute("y", y - 3);
        lab.setAttribute("fill", "#c4b06a"); lab.setAttribute("font-size", "11"); lab.setAttribute("font-family", "ui-monospace, monospace");
        lab.textContent = fmt(Number(lat.toFixed(3)), latStep, "N", "S");
        grid.appendChild(lab);
      }
      svg.appendChild(grid);
      for (const pin of pins) {
        const [x, y] = xy(pin.lon, pin.lat);
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 6);
        c.setAttribute("fill", "#ff6b35"); c.setAttribute("stroke", "#111");
        svg.appendChild(c);
      }
      const read = host.parentElement && host.parentElement.querySelector(".grid-readout");
      if (read) read.textContent = "cell " + lonStep + "° × " + latStep + "° · " + view.lonSpan.toFixed(1) + "° across";
    }

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      view.lonSpan = Math.min(360, Math.max(0.05, view.lonSpan * factor));
      view.latSpan = Math.min(160, Math.max(0.05, view.latSpan * factor));
      paint();
      listeners.zoomend.forEach((fn) => fn());
      listeners.moveend.forEach((fn) => fn());
    }, { passive: false });
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = svg.getBoundingClientRect();
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      view.lon = drag.lon - (e.clientX - drag.x) / r.width * view.lonSpan;
      view.lat = Math.max(-75, Math.min(75, drag.lat + (e.clientY - drag.y) / r.height * view.latSpan));
      paint();
    });
    svg.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) {
        const ll = lonLatFromEvent(e);
        listeners.click.forEach((fn) => fn({ latlng: ll }));
      } else {
        listeners.moveend.forEach((fn) => fn());
      }
      drag = null;
    });
    paint();

    return {
      paint,
      bounds,
      clearPins() { pins.length = 0; paint(); },
      pin(lat, lon) { pins.push({ lat, lon }); paint(); },
      focus(lat, lon) {
        view.lat = lat; view.lon = lon;
        view.latSpan = Math.min(view.latSpan, 30);
        view.lonSpan = Math.min(view.lonSpan, 40);
        paint();
      },
      on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); },
      randomCell() {
        const b = bounds();
        const latStep = stepFor(view.latSpan);
        const lonStep = stepFor(view.lonSpan);
        const lat0 = Math.ceil(b.getSouth() / latStep) * latStep;
        const lon0 = Math.ceil(b.getWest() / lonStep) * lonStep;
        const rows = Math.max(1, Math.floor((b.getNorth() - lat0) / latStep));
        const cols = Math.max(1, Math.floor((b.getEast() - lon0) / lonStep));
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        return { lat: lat0 + (r + 0.5) * latStep, lon: lon0 + (c + 0.5) * lonStep, latStep, lonStep };
      }
    };
  }

  global.TripGrid = { createGridGlobe, stepFor };
})(window);
