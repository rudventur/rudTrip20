(function () {
  const KEY = "rudTrip20.inventory.v2";
  const host = document.getElementById("inventory");
  if (!host) return;

  function uid() { return Math.random().toString(36).slice(2, 8); }
  function blank() {
    return {
      bags: [
        { id: uid(), name: "On body", mode: "on-body", items: [] },
        { id: uid(), name: "Luggage", mode: "stationary", items: [] },
        { id: uid(), name: "Wish.list", mode: "stationary", items: [] }
      ]
    };
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && Array.isArray(raw.bags)) return raw;
    } catch {}
    try {
      const old = JSON.parse(localStorage.getItem("rudTrip20.inventory.v1") || "null");
      if (old && (old.body || old.luggage || old.wish)) {
        const data = blank();
        data.bags[0].items = (old.body || []).map((name) => ({ id: uid(), name }));
        data.bags[1].items = (old.luggage || []).map((name) => ({ id: uid(), name }));
        data.bags[2].items = (old.wish || []).map((name) => ({ id: uid(), name }));
        return data;
      }
    } catch {}
    return blank();
  }
  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }

  const SLOTS = [
    ["head", "Head", "🎩"],
    ["eyes", "Eyes", "🕶️"],
    ["neck", "Neck", "🧣"],
    ["torso", "Torso", "🧥"],
    ["hands", "Hands", "🧤"],
    ["back", "Back", "🎒"],
    ["legs", "Legs", "👖"],
    ["feet", "Feet", "👢"]
  ];
  const EMOJI = { hat:"🎩", cap:"🧢", glasses:"🕶️", scarf:"🧣", coat:"🧥", jacket:"🧥", shirt:"👕", gloves:"🧤", bag:"🎒", pack:"🎒", trousers:"👖", pants:"👖", boots:"👢", shoes:"👟", watch:"⌚", ring:"💍" };
  function emojiFor(name) {
    const n = (name || "").toLowerCase();
    for (const [word, emoji] of Object.entries(EMOJI)) if (n.includes(word)) return emoji;
    return "📦";
  }
  function figure(bag, data) {
    const wrap = document.createElement("div");
    wrap.className = "vitru";
    wrap.innerHTML = `<svg viewBox="0 0 120 140" aria-label="Vitruvian figure"><circle cx="60" cy="70" r="52" fill="none" stroke="#c4b06a" stroke-width="1"/><rect x="18" y="16" width="84" height="108" fill="none" stroke="#8a6a32" stroke-width="1"/><circle cx="60" cy="28" r="8" fill="none" stroke="#e6d3a3"/><line x1="60" y1="36" x2="60" y2="78" stroke="#e6d3a3"/><line x1="28" y1="50" x2="92" y2="50" stroke="#e6d3a3"/><line x1="36" y1="78" x2="84" y2="78" stroke="#e6d3a3"/><line x1="60" y1="78" x2="40" y2="112" stroke="#e6d3a3"/><line x1="60" y1="78" x2="80" y2="112" stroke="#e6d3a3"/></svg>`;
    const grid = document.createElement("div");
    grid.className = "body-boxes";
    const worn = bag.worn || {};
    SLOTS.forEach(([key, label, fallback]) => {
      const box = document.createElement("button");
      box.type = "button";
      box.className = "body-box";
      const used = worn[key];
      box.textContent = (used ? emojiFor(used) : fallback) + " " + label;
      box.title = used || "empty " + label.toLowerCase();
      box.addEventListener("click", () => {
        const names = bag.items.map((it) => it.name);
        const pick = prompt(label + " equipment. Type a name, or blank to clear.\nIn this bag: " + (names.join(", ") || "none"), used || "");
        if (pick == null) return;
        const next = load();
        const found = next.bags.find((b) => b.id === bag.id);
        if (!found) return;
        found.worn = found.worn || {};
        if (!pick.trim()) delete found.worn[key];
        else found.worn[key] = pick.trim();
        save(next);
        paint();
      });
      grid.appendChild(box);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // Same header as every panel: title + hide / show toggle (js/panel-toggle.js)
  function panelHead(id, text) {
    const head = document.createElement("div");
    head.className = "sf-phead";
    const title = document.createElement("span");
    title.className = "sf-ptitle";
    title.textContent = text;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sf-ptoggle";
    btn.dataset.panelToggle = id;
    btn.innerHTML = '<span class="sf-pt-icon"></span><span class="sf-pt-label"></span>';
    head.append(title, btn);
    return head;
  }

  function paint() {
    const data = load();
    host.innerHTML = "";
    host.appendChild(panelHead("inventory", "🎒 Inventory"));
    const body = document.createElement("div");
    body.className = "sf-pbody";
    host.appendChild(body);

    const menu = document.createElement("details");
    menu.className = "inv-menu";
    menu.open = true;
    const sum = document.createElement("summary");
    sum.textContent = "New";
    menu.appendChild(sum);
    const newItem = document.createElement("input");
    newItem.placeholder = "new item";
    const newBag = document.createElement("input");
    newBag.placeholder = "new luggage name";
    const addItem = document.createElement("button");
    addItem.type = "button";
    addItem.textContent = "Add item to first bag";
    addItem.addEventListener("click", () => {
      const name = newItem.value.trim();
      if (!name) return;
      const next = load();
      if (!next.bags.length) next.bags.push({ id: uid(), name: "Luggage", mode: "stationary", items: [] });
      next.bags[0].items.push({ id: uid(), name });
      save(next);
      newItem.value = "";
      paint();
    });
    const addBag = document.createElement("button");
    addBag.type = "button";
    addBag.textContent = "New luggage";
    addBag.addEventListener("click", () => {
      const name = newBag.value.trim() || "Luggage";
      const next = load();
      next.bags.push({ id: uid(), name, mode: "stationary", items: [] });
      save(next);
      paint();
    });
    menu.append(newItem, newBag, addItem, addBag);
    body.appendChild(menu);

    data.bags.forEach((bag) => {
      const details = document.createElement("details");
      details.className = "inv-bag";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = bag.name + " · " + (bag.mode === "on-body" ? "on-body" : "stationary");
      details.appendChild(summary);

      const nameInput = document.createElement("input");
      nameInput.value = bag.name;
      nameInput.addEventListener("change", () => {
        const next = load();
        const found = next.bags.find((b) => b.id === bag.id);
        if (!found) return;
        found.name = nameInput.value.trim() || found.name;
        save(next);
        paint();
      });
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = bag.mode === "on-body" ? "Switch to stationary" : "Switch to on-body";
      toggle.addEventListener("click", () => {
        const next = load();
        const found = next.bags.find((b) => b.id === bag.id);
        if (!found) return;
        found.mode = found.mode === "on-body" ? "stationary" : "on-body";
        save(next);
        paint();
      });
      const binBag = document.createElement("button");
      binBag.type = "button";
      binBag.textContent = "Bin luggage";
      binBag.addEventListener("click", () => {
        const next = load();
        next.bags = next.bags.filter((b) => b.id !== bag.id);
        save(next);
        paint();
      });
      details.append(nameInput, toggle, binBag);
      if (bag.mode === "on-body") details.appendChild(figure(bag, data));

      bag.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "inv-item";
        const input = document.createElement("input");
        input.value = item.name;
        input.addEventListener("change", () => {
          const next = load();
          const foundBag = next.bags.find((b) => b.id === bag.id);
          const found = foundBag && foundBag.items.find((it) => it.id === item.id);
          if (!found) return;
          found.name = input.value.trim() || found.name;
          save(next);
        });
        const bin = document.createElement("button");
        bin.type = "button";
        bin.textContent = "bin";
        bin.addEventListener("click", () => {
          const next = load();
          const foundBag = next.bags.find((b) => b.id === bag.id);
          if (foundBag) foundBag.items = foundBag.items.filter((it) => it.id !== item.id);
          save(next);
          paint();
        });
        row.append(input, bin);
        details.appendChild(row);
      });

      const itemInput = document.createElement("input");
      itemInput.placeholder = "item in this luggage";
      const addHere = document.createElement("button");
      addHere.type = "button";
      addHere.textContent = "Add item";
      addHere.addEventListener("click", () => {
        const name = itemInput.value.trim();
        if (!name) return;
        const next = load();
        const found = next.bags.find((b) => b.id === bag.id);
        if (!found) return;
        found.items.push({ id: uid(), name });
        save(next);
        paint();
      });
      details.append(itemInput, addHere);
      body.appendChild(details);
    });
    if (window.sfPanels) window.sfPanels.sync("inventory");
  }
  paint();
})();
