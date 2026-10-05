(function () {
  const E = window.TripSearchEngine;
  const LAND = [
    { name: "Tower of London", loc: "London", lat: 51.5081, lon: -0.0759 },
    { name: "Edinburgh Castle", loc: "Edinburgh", lat: 55.9486, lon: -3.1999 },
    { name: "Mont Saint-Michel", loc: "Normandy", lat: 48.636, lon: -1.5115 },
    { name: "Sagrada Família", loc: "Barcelona", lat: 41.4036, lon: 2.1744 },
    { name: "Colosseum", loc: "Rome", lat: 41.8902, lon: 12.4922 },
    { name: "Acropolis", loc: "Athens", lat: 37.9715, lon: 23.7267 },
    { name: "Prague Castle", loc: "Prague", lat: 50.091, lon: 14.4016 },
    { name: "Brandenburg Gate", loc: "Berlin", lat: 52.5163, lon: 13.3777 },
    { name: "Kilmainham Gaol", loc: "Dublin", lat: 53.3419, lon: -6.3096 },
    { name: "Alhambra", loc: "Granada", lat: 37.1761, lon: -3.5881 },
    { name: "Hagia Sophia", loc: "Istanbul", lat: 41.0086, lon: 28.9802 },
    { name: "Fushimi Inari", loc: "Kyoto", lat: 34.9671, lon: 135.7727 },
    { name: "Meiji Shrine", loc: "Tokyo", lat: 35.6764, lon: 139.6993 },
    { name: "Taj Mahal", loc: "Agra", lat: 27.1751, lon: 78.0421 },
    { name: "Petra", loc: "Jordan", lat: 30.3285, lon: 35.4444 },
    { name: "Pyramids of Giza", loc: "Giza", lat: 29.9792, lon: 31.1342 },
    { name: "Table Mountain", loc: "Cape Town", lat: -33.9628, lon: 18.4098 },
    { name: "Christ the Redeemer", loc: "Rio de Janeiro", lat: -22.9519, lon: -43.2105 },
    { name: "Machu Picchu", loc: "Cusco", lat: -13.1631, lon: -72.545 },
    { name: "Statue of Liberty", loc: "New York", lat: 40.6892, lon: -74.0445 },
    { name: "Golden Gate Bridge", loc: "San Francisco", lat: 37.8199, lon: -122.4783 },
    { name: "Chichén Itzá", loc: "Yucatán", lat: 20.6843, lon: -88.5678 },
    { name: "Sydney Opera House", loc: "Sydney", lat: -33.8568, lon: 151.2153 },
    { name: "Uluru", loc: "Northern Territory", lat: -25.3444, lon: 131.0369 }
  ];

  function landmark() {
    const p = LAND[Math.floor(Math.random() * LAND.length)];
    return {
      name: p.name,
      loc: p.loc,
      lat: p.lat,
      lon: p.lon,
      desc: "Known place — live search came back empty, trip still starts here",
      link: null,
      source: "landmark"
    };
  }

  if (E && !E.__alwaysLand) {
    const orig = E.fetchRandomTarget.bind(E);
    const origMany = E.fetchRandomTargets ? E.fetchRandomTargets.bind(E) : null;
    E.fetchRandomTarget = async function (map, mode, sec, keyword, onStatus) {
      const result = await orig(map, mode, sec, keyword, onStatus);
      if (result && result.target) return result;
      if (onStatus) onStatus("Live search empty — landing a known place so the trip still starts.");
      return { target: landmark(), widened: true };
    };
    if (origMany) {
      E.fetchRandomTargets = async function (map, mode, sec, keyword, count, onStatus) {
        const result = await origMany(map, mode, sec, keyword, count, onStatus);
        if (result && result.targets && result.targets.length) return result;
        const n = Math.max(1, count || 1);
        const targets = [];
        while (targets.length < n) targets.push(landmark());
        return { targets, widened: true };
      };
    }
    E.__alwaysLand = true;
  }

  const DASH_KEY = "rudTrip20.dashboard.v1";
  const ROLL_KEY = "rudTrip20.lucky.v1";
  const host = document.getElementById("dashPanel");
  if (!host) return;

  function loadDash() {
    try { return JSON.parse(localStorage.getItem(DASH_KEY) || "[]"); } catch { return []; }
  }
  function saveDash(list) {
    try { localStorage.setItem(DASH_KEY, JSON.stringify(list.slice(0, 40))); } catch {}
  }
  function paint() {
    host.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = "Dashboard";
    host.appendChild(title);
    const tools = document.createElement("div");
    tools.className = "dash-tools";
    const neu = document.createElement("button");
    neu.type = "button";
    neu.textContent = "New";
    neu.addEventListener("click", () => {
      const name = prompt("Name this card");
      if (!name) return;
      const link = prompt("Link to stuff, place or info (optional)") || "";
      const list = loadDash();
      list.unshift({ name, link: /^https?:\/\//.test(link) ? link : "", at: new Date().toISOString() });
      saveDash(list);
      paint();
    });
    tools.appendChild(neu);
    host.appendChild(tools);
    const list = document.createElement("div");
    host.appendChild(list);

    let rolls = [];
    try { rolls = JSON.parse(localStorage.getItem(ROLL_KEY) || "[]"); } catch { rolls = []; }
    rolls.forEach((r, i) => {
      const card = document.createElement("div");
      card.className = "dash-card";
      const body = document.createElement("div");
      body.textContent = (r.mode || "search") + " · " + (r.name || "untitled");
      const bin = document.createElement("button");
      bin.className = "bin";
      bin.type = "button";
      bin.textContent = "bin";
      bin.addEventListener("click", () => {
        rolls.splice(i, 1);
        try { localStorage.setItem(ROLL_KEY, JSON.stringify(rolls)); } catch {}
        paint();
      });
      card.append(body, bin);
      list.appendChild(card);
    });
    loadDash().forEach((r, i) => {
      const card = document.createElement("div");
      card.className = "dash-card";
      const body = document.createElement("div");
      if (r.link) {
        const a = document.createElement("a");
        a.href = r.link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = r.name || r.link;
        body.append(a);
      } else body.textContent = r.name || "note";
      const bin = document.createElement("button");
      bin.className = "bin";
      bin.type = "button";
      bin.textContent = "bin";
      bin.addEventListener("click", () => {
        const cards = loadDash();
        cards.splice(i, 1);
        saveDash(cards);
        paint();
      });
      card.append(body, bin);
      list.appendChild(card);
    });
    if (!list.children.length) list.textContent = "Searches and links land here.";
  }
  paint();
  window.TripDash = { paint };
})();
