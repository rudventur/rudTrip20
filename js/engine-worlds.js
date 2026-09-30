/* Fold world ticks into live Overpass queries. Ruins etc. are tags, not name keywords. */
(function (global) {
  const E = global.TripSearchEngine;
  if (!E) return;

  const ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ];

  const WORLD_TAGS = {
    ruins: [["historic", "ruins|archaeological_site|fort|castle|monument"]],
    beauty: [["tourism", "viewpoint"], ["natural", "beach|volcano|cliff|hot_spring|bay"]],
    topographic: [["natural", "peak|ridge|volcano|saddle|glacier"]],
    astronomical: [["man_made", "observatory|telescope"], ["amenity", "planetarium"]],
    businesses: [["amenity", "cafe|restaurant|marketplace|pub"]]
  };

  const MODE_TAGS = {
    place: [["tourism", "attraction|museum|viewpoint|artwork|gallery"], ["historic", ".*"], ["leisure", "park|garden"]],
    event: [["amenity", "theatre|cinema|arts_centre|events_venue|marketplace"], ["leisure", "stadium|sports_centre"]],
    both: [["tourism", "attraction|museum"], ["amenity", "theatre|events_venue"], ["historic", ".*"]]
  };

  E.tagsFromWorlds = function (worlds) {
    const extra = [];
    if (!worlds) return extra;
    Object.keys(WORLD_TAGS).forEach((k) => { if (worlds[k]) extra.push(...WORLD_TAGS[k]); });
    return extra;
  };

  E.bboxAroundCentroid = function (lat, lon, spanLat, spanLon) {
    return [Math.max(-85, lat - spanLat), lon - spanLon, Math.min(85, lat + spanLat), lon + spanLon];
  };

  E.countryCentroid = E.countryCentroid || function (name) {
    const table = E.COUNTRY_CENTROIDS || {};
    return name ? (table[String(name).trim().toLowerCase()] || null) : null;
  };

  function pairsFor(mode, worlds) {
    const extra = E.tagsFromWorlds(worlds);
    if (extra.length && worlds && !worlds.places) return extra;
    return [...(MODE_TAGS[mode] || MODE_TAGS.place), ...extra];
  }

  function query(bbox, tagPairs, limit) {
    const [s, w, n, e] = bbox;
    const clauses = tagPairs.map(([k, v]) => {
      const pattern = v === ".*" ? ".*" : "^(" + v + ")$";
      return "nwr[\"" + k + "\"~\"" + pattern + "\"](" + s + "," + w + "," + n + "," + e + ");";
    }).join("");
    return "[out:json][timeout:15];(" + clauses + ");out center " + limit + ";";
  }

  function describe(el) {
    const tags = el.tags || {};
    const lat = typeof el.lat === "number" ? el.lat : el.center && el.center.lat;
    const lon = typeof el.lon === "number" ? el.lon : el.center && el.center.lon;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    const label = tags.historic || tags.tourism || tags.natural || tags.amenity || tags.leisure || tags.man_made || "Place";
    return {
      name: tags.name || "Unnamed " + label,
      loc: tags["addr:city"] || tags["addr:town"] || label,
      lat, lon,
      desc: "OpenStreetMap · " + label,
      link: tags.website || null,
      source: "osm"
    };
  }

  async function overpassPool(map, mode, worlds, limit, onStatus) {
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    const q = query(bbox, pairsFor(mode, worlds), limit);
    if (onStatus) onStatus("Searching OpenStreetMap tags live…");
    const errors = [];
    const tries = ENDPOINTS.map(async (ep) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), signal: ctrl.signal });
        const text = await res.text();
        if (!res.ok) throw new Error(res.status);
        return JSON.parse(text);
      } finally { clearTimeout(t); }
    });
    let data = null;
    await Promise.all(tries.map((p) => p.then((d) => { if (!data && d && d.elements) data = d; }).catch((e) => errors.push(String(e)))));
    if (!data) throw new Error(errors.join(" | ") || "overpass failed");
    const pool = [];
    (data.elements || []).forEach((el) => { const t = describe(el); if (t) pool.push(t); });
    return pool;
  }

  const origTarget = E.fetchRandomTarget.bind(E);
  const origTargets = E.fetchRandomTargets.bind(E);

  E.fetchRandomTarget = async function (map, mode, sec, keyword, onStatus, worlds) {
    try {
      const pool = await overpassPool(map, mode, worlds, 35, onStatus);
      if (pool.length) return { target: pool[Math.floor(Math.random() * pool.length)], widened: false };
    } catch (err) {
      if (onStatus) onStatus("Tag search missed — using engine fallback…");
    }
    return origTarget(map, mode, sec, "", onStatus);
  };

  E.fetchRandomTargets = async function (map, mode, sec, keyword, count, onStatus, worlds) {
    try {
      const pool = await overpassPool(map, mode, worlds, Math.min(60, Math.max(35, count * 12)), onStatus);
      if (pool.length) {
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        return { targets: pool.slice(0, count), widened: false };
      }
    } catch (err) {
      if (onStatus) onStatus("Tag search missed — using engine fallback…");
    }
    return origTargets(map, mode, sec, "", count, onStatus);
  };
})(window);
