(function () {
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
