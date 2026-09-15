// ==========================================================================
// TripSearchEngine
// 1. Live Overpass search first — all mirrors raced in parallel, first one
//    back wins. Every place comes straight from live OpenStreetMap data.
// 2. If nothing found (or Overpass is unreachable / cooling down) → fetch
//    FRESH live news headlines from GDELT (free & keyless, no login),
//    placed on the map via a local country-centroid table — a single HTTP
//    request, no live geocoding chain to go wrong.
// Returns { target, widened } — or null if genuinely nothing turned up.
// ==========================================================================
(function (global) {
  "use strict";

  // ---------- Safe JSON fetch ----------
  // Free APIs often answer HTTP 200 with an HTML error page or an empty
  // body (rate limits, bot filters). res.json() on that throws a confusing
  // SyntaxError. Reading text first gives a clear, reportable error.
  async function fetchJson(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${new URL(url).host} answered with non-JSON (rate-limited or blocked?)`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Promise.any replacement ----------
  // Works in every browser (Promise.any needs ES2021) and, when all
  // endpoints fail, reports every error instead of an empty AggregateError.
  function firstSuccess(promises) {
    return new Promise((resolve, reject) => {
      let pending = promises.length;
      if (pending === 0) return reject(new Error("no endpoints to try"));
      const errors = [];
      promises.forEach(p =>
        Promise.resolve(p).then(resolve, err => {
          errors.push(err && err.message ? err.message : String(err));
          if (--pending === 0) reject(new Error(errors.join(" | ")));
        })
      );
    });
  }

  // ---------- Rate limiting (polite spacing for the free Overpass mirrors —
  // never blocks the user: inside the cooldown we just go straight to the
  // fresh-news fallback instead of making them wait) ----------
let lastOverpassCall = 0;
  const MIN_INTERVAL_MS = 15000;

  function canCallOverpassNow() {
    return Date.now() - lastOverpassCall >= MIN_INTERVAL_MS;
  }


  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ];
  // The default "place/present" query ORs together 4 broad tag categories
  // in one call, which measurably takes public Overpass mirrors 8-15s under
  // normal load — a short timeout here was cutting off genuinely-working
  // mirrors before they could ever answer, not just skipping dead ones.
  const OVERPASS_TIMEOUT_MS = 15000;

  const CATEGORY_TAGS = {
    place: {
      present: [
        ["tourism", "attraction|museum|viewpoint|artwork|gallery|zoo"],
        ["amenity", "cafe|restaurant|bar|pub|library|cinema|theatre|place_of_worship"],
        ["leisure", "park|garden|stadium"],
        ["historic", ".*"]
      ],
      past: [["historic", ".*"], ["tourism", "attraction|museum"]],
      future: [["building", "construction"], ["landuse", "construction"]]
    },
    event: {
      present: [
        ["amenity", "theatre|cinema|arts_centre|events_venue|marketplace"],
        ["leisure", "stadium|sports_centre"],
        ["tourism", "theme_park|attraction"]
      ],
      past: [["historic", ".*"]],
      future: [["building", "construction"], ["landuse", "construction"]]
    }
    // Further modes (historical/geographical/gems/...) are registered by
    // extension files like modes-extra.js via registerCategoryTags(),
    // rather than hardcoded here — this engine only owns Place/Event/Good
    // Trip, plus the generic machinery every mode reuses.
  };

  // A mode's present/past/future entry is either a flat tag-pair array
  // (the original shape) or { mixes: [ [...tag pairs...], [...], ... ] } —
  // a set of alternate tag combinations to keep the same mode from always
  // searching for exactly the same thing. One mix is picked at random per
  // search.
  function resolveTagSet(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) return entry;
    if (entry.mixes && entry.mixes.length) return pick(entry.mixes);
    return null;
  }

  function tagsFor(mode, sec) {
    if (mode === "both") {
      return [...(resolveTagSet(CATEGORY_TAGS.place[sec]) || resolveTagSet(CATEGORY_TAGS.place.present)),
              ...(resolveTagSet(CATEGORY_TAGS.event[sec]) || resolveTagSet(CATEGORY_TAGS.event.present))];
    }
    const table = CATEGORY_TAGS[mode] || CATEGORY_TAGS.place;
    return resolveTagSet(table[sec]) || resolveTagSet(table.present);
  }

  // Lets an extension file (e.g. modes-extra.js) add a new lucky-mode
  // without touching this file — same tag-pair/mixes shape as the built-in
  // modes above, picked up automatically by tagsFor() and therefore by
  // fetchRandomTarget/fetchRandomTargets.
  function registerCategoryTags(name, def) {
    CATEGORY_TAGS[name] = def;
  }

  function escapeForQuotedRegex(s) {
    return s.replace(/[\\"[\]().*+?^${}|]/g, "\\$&");
  }

  function buildOverpassQuery(bbox, tagPairs, keyword, limit = 35) {
    const [s, w, n, e] = bbox;
    const esc = keyword ? escapeForQuotedRegex(keyword) : null;
    const clauses = tagPairs.map(([k, v]) => {
      const pattern = v === ".*" ? ".*" : `^(${v})$`;
      const nameFilter = esc ? `["name"~"${esc}",i]` : "";
      return `nwr["${k}"~"${pattern}"]${nameFilter}(${s},${w},${n},${e});`;
    }).join("\n");
    return `[out:json][timeout:15];(${clauses});out center ${limit};`;
  }

  async function queryOverpassOnce(endpoint, query) {
    return fetchJson(endpoint, {
      method: "POST",
      body: "data=" + encodeURIComponent(query)
    }, OVERPASS_TIMEOUT_MS);
  }

  async function queryOverpassRace(query) {
    return firstSuccess(OVERPASS_ENDPOINTS.map(ep => queryOverpassOnce(ep, query)));
  }

  function elCenter(el) {
    if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
    if (el.center) return { lat: el.center.lat, lon: el.center.lon };
    return null;
  }

  function describeOsmElement(el) {
    const tags = el.tags || {};
    const coords = elCenter(el);
    if (!coords) return null;

    const name = tags.name || "Unnamed place";
    const label = tags.tourism || tags.amenity || tags.leisure || tags.historic || "Place";
    const loc = [tags["addr:street"], tags["addr:city"] || tags["addr:town"]].filter(Boolean).join(", ") || label;

    let photoUrl = null;
    if (tags.image && /^https?:\/\//i.test(tags.image)) photoUrl = tags.image;
    else if (tags.wikimedia_commons && tags.wikimedia_commons.startsWith("File:")) {
      photoUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(tags.wikimedia_commons.slice(5))}?width=500`;
    }

    return {
      name,
      loc,
      lat: coords.lat,
      lon: coords.lon,
      desc: `Found on OpenStreetMap · ${label}`,
      link: tags.website || tags["contact:website"] || null,
      photoUrl,
      wikipedia: tags.wikipedia || null,
      source: "osm"
    };
  }

  // ---------- Fresh-news fallback ----------
  // Real, live headlines from free news sites via GDELT (keyless, CORS-open,
  // aggregates BBC/Reuters/AP/Guardian/NPR/Al Jazeera/DW). Stories are placed
  // using a local country-centroid lookup table rather than a second live
  // geocoding call — one HTTP request instead of a fragile multi-step chain,
  // and nothing left that can silently rate-limit or time out on its own.
  const NEWS_DOMAINS = [
    "bbc.co.uk", "reuters.com", "apnews.com", "theguardian.com",
    "npr.org", "aljazeera.com", "dw.com"
  ];
  const NEWS_TIMEOUT_MS = 12000;

  // Rough country centroids so a real headline can be placed on the map
  // instantly, with no extra network round trip.
  const COUNTRY_CENTROIDS = {
    "united states": [39.8, -98.6], "canada": [56.1, -106.3], "mexico": [23.6, -102.6],
    "united kingdom": [54.0, -2.9], "ireland": [53.4, -8.2], "france": [46.6, 2.2],
    "germany": [51.2, 10.4], "spain": [40.0, -3.7], "portugal": [39.6, -8.0],
    "italy": [42.8, 12.6], "netherlands": [52.2, 5.5], "belgium": [50.5, 4.5],
    "switzerland": [46.8, 8.2], "austria": [47.5, 14.6], "sweden": [62.0, 15.0],
    "norway": [64.6, 11.5], "denmark": [56.0, 9.5], "finland": [64.9, 26.0],
    "iceland": [64.9, -19.0], "poland": [52.0, 19.1], "czech republic": [49.8, 15.5],
    "slovakia": [48.7, 19.7], "hungary": [47.2, 19.5], "romania": [45.9, 24.9],
    "bulgaria": [42.7, 25.5], "greece": [39.1, 21.8], "turkey": [39.0, 35.2],
    "ukraine": [48.4, 31.2], "belarus": [53.7, 27.9], "russia": [61.5, 105.3],
    "serbia": [44.0, 21.0], "croatia": [45.1, 15.2], "bosnia and herzegovina": [44.0, 17.7],
    "slovenia": [46.1, 14.8], "albania": [41.2, 20.2], "north macedonia": [41.6, 21.7],
    "moldova": [47.2, 28.5], "lithuania": [55.2, 23.9], "latvia": [56.9, 24.6],
    "estonia": [58.6, 25.0], "georgia": [42.3, 43.4], "armenia": [40.1, 45.0],
    "azerbaijan": [40.1, 47.6], "kazakhstan": [48.0, 66.9], "uzbekistan": [41.4, 64.6],
    "china": [35.9, 104.2], "japan": [36.2, 138.3], "south korea": [35.9, 127.8],
    "north korea": [40.3, 127.5], "taiwan": [23.7, 121.0], "hong kong": [22.3, 114.2],
    "mongolia": [46.9, 103.8], "india": [22.4, 78.7], "pakistan": [30.4, 69.3],
    "bangladesh": [23.7, 90.4], "sri lanka": [7.9, 80.8], "nepal": [28.4, 84.1],
    "afghanistan": [33.9, 67.7], "iran": [32.4, 53.7], "iraq": [33.2, 43.7],
    "syria": [34.8, 39.0], "lebanon": [33.9, 35.9], "israel": [31.0, 34.9],
    "palestinian territories": [31.9, 35.2], "jordan": [30.6, 36.2], "saudi arabia": [24.0, 45.1],
    "yemen": [15.6, 48.0], "united arab emirates": [23.4, 53.8], "qatar": [25.4, 51.2],
    "kuwait": [29.3, 47.5], "oman": [21.5, 55.9], "indonesia": [-2.5, 118.0],
    "philippines": [12.9, 121.8], "vietnam": [14.1, 108.3], "thailand": [15.9, 100.9],
    "malaysia": [4.2, 101.9], "singapore": [1.35, 103.8], "myanmar": [21.9, 96.0],
    "cambodia": [12.6, 105.0], "laos": [19.9, 102.5], "australia": [-25.3, 133.8],
    "new zealand": [-41.0, 174.9], "papua new guinea": [-6.3, 143.9], "fiji": [-17.7, 178.1],
    "brazil": [-10.3, -53.2], "argentina": [-35.4, -65.2], "chile": [-35.7, -71.5],
    "colombia": [4.6, -74.3], "peru": [-9.2, -75.0], "venezuela": [7.1, -66.1],
    "ecuador": [-1.8, -78.2], "bolivia": [-16.3, -63.6], "paraguay": [-23.4, -58.4],
    "uruguay": [-32.5, -55.8], "cuba": [21.5, -79.5], "dominican republic": [18.9, -70.5],
    "haiti": [19.0, -72.4], "jamaica": [18.1, -77.3], "panama": [8.5, -80.8],
    "costa rica": [9.7, -83.8], "guatemala": [15.8, -90.2], "honduras": [15.2, -86.2],
    "nicaragua": [12.9, -85.2], "trinidad and tobago": [10.7, -61.2],
    "egypt": [26.8, 30.8], "libya": [26.3, 17.2], "tunisia": [33.9, 9.5],
    "algeria": [28.0, 1.7], "morocco": [31.8, -7.1], "sudan": [15.6, 30.2],
    "south sudan": [7.3, 30.3], "ethiopia": [9.1, 40.5], "kenya": [-0.0, 37.9],
    "somalia": [5.2, 46.2], "tanzania": [-6.4, 34.9], "uganda": [1.4, 32.3],
    "rwanda": [-1.9, 29.9], "nigeria": [9.1, 8.7], "ghana": [7.9, -1.0],
    "ivory coast": [7.5, -5.5], "senegal": [14.5, -14.5], "cameroon": [3.8, 12.4],
    "democratic republic of the congo": [-4.0, 21.8], "angola": [-11.2, 17.9],
    "zambia": [-13.1, 27.8], "zimbabwe": [-19.0, 29.2], "mozambique": [-18.7, 35.5],
    "south africa": [-30.6, 22.9], "namibia": [-22.9, 18.5], "botswana": [-22.3, 24.7]
  };

  function countryCentroid(name) {
    if (!name) return null;
    return COUNTRY_CENTROIDS[String(name).trim().toLowerCase()] || null;
  }

  function buildNewsQuery(keyword) {
    const domainClause = "(" + NEWS_DOMAINS.map(d => `domain:${d}`).join(" OR ") + ")";
    return keyword ? `${domainClause} ${keyword}` : domainClause;
  }

  async function fetchNewsTarget(keyword, onStatus) {
    const say = m => { if (onStatus) onStatus(m); };
    try {
      // With the keyword first; if that finds nothing, retry with no keyword
      // so the fallback can always surface *some* fresh news.
      const attempts = keyword ? [keyword, null] : [null];
      let articles = [];
      for (const kw of attempts) {
        say("Fetching fresh headlines…");
        try {
          const q = encodeURIComponent(buildNewsQuery(kw));
          const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=50&timespan=3d&sort=datedesc&format=json`;
          const data = await fetchJson(url, {}, NEWS_TIMEOUT_MS);
          articles = (data && data.articles) || [];
        } catch (e) {
          console.warn("GDELT attempt failed:", e && e.message);
        }
        if (articles.length) break;
      }
      if (!articles.length) return null;

      // Only keep stories whose country resolves in the local table, then
      // pick one uniformly at random — no live geocoding, no extra request.
      const mappable = [];
      for (const a of articles) {
        const coords = countryCentroid(a.sourcecountry);
        if (coords) mappable.push({ a, coords });
      }
      if (mappable.length === 0) return null;

      const { a, coords } = mappable[Math.floor(Math.random() * mappable.length)];
      // Small random spread so headlines from the same country don't all
      // stack on exactly the same pixel.
      const lat = Math.max(-85, Math.min(85, coords[0] + (Math.random() - 0.5) * 4));
      const lon = coords[1] + (Math.random() - 0.5) * 4;

      return {
        name: a.title || "Untitled story",
        loc: a.sourcecountry || a.domain || "Somewhere out there",
        lat, lon,
        desc: `Live headline from ${a.domain || "a free news site"}`,
        link: a.url || null,
        photoUrl: /^https?:\/\//i.test(a.socialimage || "") ? a.socialimage : null,
        source: "news"
      };
    } catch (err) {
      console.warn("News fallback unavailable:", err && err.message);
      return null;
    }
  }

  // "Viral" and any other non-OSM-tag modes live in extension files (see
  // modes-extra.js), which call registerCategoryTags() for tag-based modes
  // and attach their own fetch-a-target function (e.g. fetchViralTarget)
  // directly onto TripSearchEngine — this engine doesn't know about them.

  // ---------- Main ----------
  async function fetchRandomTarget(map, mode, sec, keyword, onStatus) {
    const say = m => { if (onStatus) onStatus(m); };

    // 1. Live Overpass search inside the current map view.
    if (canCallOverpassNow()) {
      try {
        const b = map.getBounds();
        const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
        const tagPairs = tagsFor(mode, sec);
        lastOverpassCall = Date.now();

        say("Searching OpenStreetMap live in this view…");
        const data = await queryOverpassRace(buildOverpassQuery(bbox, tagPairs, keyword, 35));
        const pool = [];
        for (const el of (data.elements || [])) {
          const t = describeOsmElement(el);
          if (t) pool.push(t);
        }
        if (pool.length > 0) {
          say("");
          return { target: pool[Math.floor(Math.random() * pool.length)], widened: false };
        }
        say("Nothing matched in this view — falling back to fresh news…");
      } catch (err) {
        console.warn("Live Overpass unavailable, trying live news instead:", err && err.message);
        say("OpenStreetMap unreachable — falling back to fresh news…");
      }
    } else {
      say("Overpass is cooling down — this click uses fresh news…");
    }

    // 2. Fresh live news, geolocated live. If this also comes up empty we
    //    honestly report "no luck" instead of inventing anything.
    const newsTarget = await fetchNewsTarget(keyword, onStatus);
    if (newsTarget) return { target: newsTarget, widened: true };
    return null;
  }

  // Like fetchRandomTarget, but for a loop: pulls up to `count` DISTINCT
  // real targets from a single Overpass query (a bigger pool, sampled
  // without replacement) rather than calling Overpass/GDELT once per stop —
  // that would burn through both the client-side cooldown and GDELT's very
  // real rate limit inside one click. If Overpass comes up empty, the loop
  // degrades honestly to a single live-news stop rather than inventing
  // anything to fill the requested count.
  async function fetchRandomTargets(map, mode, sec, keyword, count, onStatus) {
    const say = m => { if (onStatus) onStatus(m); };

    if (canCallOverpassNow()) {
      try {
        const b = map.getBounds();
        const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
        const tagPairs = tagsFor(mode, sec);
        lastOverpassCall = Date.now();

        say("Searching OpenStreetMap live in this view…");
        const poolLimit = Math.min(60, Math.max(35, count * 15));
        const data = await queryOverpassRace(buildOverpassQuery(bbox, tagPairs, keyword, poolLimit));
        const pool = [];
        for (const el of (data.elements || [])) {
          const t = describeOsmElement(el);
          if (t) pool.push(t);
        }
        if (pool.length > 0) {
          say("");
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          return { targets: pool.slice(0, count), widened: false };
        }
        say("Nothing matched in this view — falling back to fresh news…");
      } catch (err) {
        console.warn("Live Overpass unavailable, trying live news instead:", err && err.message);
        say("OpenStreetMap unreachable — falling back to fresh news…");
      }
    } else {
      say("Overpass is cooling down — this click uses fresh news…");
    }

    const newsTarget = await fetchNewsTarget(keyword, onStatus);
    if (newsTarget) return { targets: [newsTarget], widened: true };
    return null;
  }

  async function fetchWikipediaThumbnail(wikipediaTag) {
    try {
      const parts = wikipediaTag.split(":");
      const lang = parts.length > 1 ? parts[0] : "en";
      const title = parts.length > 1 ? parts.slice(1).join(":") : parts[0];
      const data = await fetchJson(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        {}, 8000
      );
      return (data.thumbnail && data.thumbnail.source) || null;
    } catch {
      return null;
    }
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- Mode-aware trip planning ----------
  // Turns "X km away" into actual legs (walk/bike/car/bus/train/flight)
  // honoring the transport checkboxes, with plausible average speeds and
  // per-leg overhead — still an estimate, but one that responds to real
  // distance and real choices instead of a flat random number.
  const MODE_SPEED_KMH = { walk: 4.5, bike: 15, car: 75, bus: 50, train: 90, flight: 750 };
  // Fixed overhead per leg: waiting for a bus, airport check-in, etc.
  const MODE_OVERHEAD_H = { walk: 0, bike: 0, car: 0.15, bus: 0.3, train: 0.35, flight: 2.5 };
  // Real routes are never as the crow flies — pad ground/air legs for
  // roads, rail curves and flight paths.
  const MODE_ROAD_FACTOR = { walk: 1.2, bike: 1.25, car: 1.3, bus: 1.3, train: 1.15, flight: 1.05 };
  const MODE_NOUN = {
    walk: "on foot", bike: "by bike", car: "by car",
    bus: "by bus", train: "by train", flight: "by plane"
  };
  const MODE_PLAIN = {
    walk: "walking", bike: "bike", car: "car",
    bus: "bus", train: "train", flight: "plane"
  };

  function legHours(mode, km) {
    return (km * MODE_ROAD_FACTOR[mode]) / MODE_SPEED_KMH[mode] + MODE_OVERHEAD_H[mode];
  }

  // Picks a realistic mode (or short chain of modes) for a given distance,
  // honoring the transport checkboxes. `variant` (0 or 1) nudges the second
  // generated route towards a genuinely different plan — e.g. public
  // transport instead of a car — rather than repeating the first almost
  // verbatim.
  function planLegs(km, opts, variant) {
    const { allowWalk, allowBike, allowCar, preferPublic } = opts;
    const publicFirst = preferPublic || variant === 1;

    if (km < 1.5) {
      if (allowWalk) return [{ mode: "walk", km, label: "" }];
      if (allowBike) return [{ mode: "bike", km, label: "" }];
      return [{ mode: publicFirst ? "bus" : "car", km, label: "" }];
    }
    if (km < 8) {
      if (allowBike && !publicFirst && km < 6) return [{ mode: "bike", km, label: "" }];
      if (publicFirst) return [{ mode: "bus", km, label: "" }];
      if (allowCar) return [{ mode: "car", km, label: "" }];
      if (allowWalk) return [{ mode: "walk", km, label: "" }];
      return [{ mode: "bus", km, label: "" }];
    }
    if (km < 60) {
      if (publicFirst) return [{ mode: "bus", km, label: "" }];
      if (allowCar) return [{ mode: "car", km, label: "" }];
      return [{ mode: "bus", km, label: "" }];
    }
    if (km < 400) {
      if (publicFirst) return [{ mode: "train", km, label: "" }];
      if (allowCar) return [{ mode: "car", km, label: "" }];
      return [{ mode: "train", km, label: "" }];
    }
    if (km < 1200) {
      if (allowCar && !publicFirst) return [{ mode: "car", km, label: "" }];
      return [{ mode: "train", km, label: "" }];
    }

    // Long-haul is the one case that's genuinely more than a single leg —
    // you still have to actually get to an airport first.
    const hop = 12 + Math.random() * 18;
    const hopMode = allowCar ? "car" : (allowBike && hop < 10 ? "bike" : (allowWalk && hop < 3 ? "walk" : "bus"));
    return [
      { mode: hopMode, km: hop, label: "to the airport" },
      { mode: "flight", km: Math.max(km - hop * 2, 50), label: "" },
      { mode: hopMode, km: hop, label: "from the airport" }
    ];
  }

  function totalHours(legs) {
    return legs.reduce((sum, leg) => sum + legHours(leg.mode, leg.km), 0);
  }

  // A wink to the "Weird vehicles (higher rudness)" checkbox: a rough,
  // deliberately silly score for how much this itinerary defies common
  // sense — flavor, not a real metric.
  function rudenessScore(legs, opts) {
    let score = 8 + Math.round(Math.random() * 12);
    if (opts.allowWeird) score += 35 + Math.round(Math.random() * 20);
    if (legs.some(l => l.mode === "flight")) score += 10;
    if (legs.length > 1) score += 5;
    return Math.max(0, Math.min(100, score));
  }

  function rudenessBadge(score) {
    const face = score >= 70 ? "😈" : score >= 40 ? "😏" : "😇";
    return `${face} Rudeness ${score}%`;
  }

  // ---------- Funny route ----------
  const FUNNY_VEHICLES = [
    "a caffeinated pigeon courier", "a shopping cart with one wobbly wheel",
    "a unicycle borrowed from a circus", "a suspiciously fast tortoise",
    "a hot air balloon named Gerald", "a fleet of confused Roombas",
    "a llama with a passport", "the last known flying carpet",
    "a golf cart that should not be street legal", "a very motivated goose",
    "a rowboat and pure optimism", "a skateboard with rocket boosters",
    "a rented segway and a dream", "a mysterious portal behind the shed",
    "a marching band that happens to be going that way",
    "a paper airplane, scaled up considerably", "a tandem bike missing its second rider"
  ];
  const FUNNY_HUBS = [
    "the nearest questionable food truck", "a roundabout with strong opinions",
    "the town's one confusing bus stop", "a suspiciously well-lit alley",
    "a vending machine that dispenses directions", "the local pigeon parliament",
    "a fortune teller's tent", "an unattended lemonade stand",
    "a payphone that still somehow works", "a duck pond with excellent Wi-Fi"
  ];

  function distanceJoke(km) {
    if (km > 8000) return " (bring snacks, and maybe a visa)";
    if (km > 3000) return " (pack a book, it's a while)";
    if (km > 500) return " (stretch your legs first)";
    return "";
  }

  // One leg's stage line: real mode + real (padded) distance/time, with an
  // optional "weird vehicle" reskin when that checkbox is on — the number
  // still reflects the underlying mode's speed, only the label gets silly.
  // `destLabel` is just the place name to print ("towards X") — a plain
  // string so this works equally for an outbound leg (target.loc), a
  // different-way-back return leg (the start's name), or one hop of a loop.
  function legStageText(leg, opts, isFirst, isMain, destLabel) {
    const h = legHours(leg.mode, leg.km);
    const kmLabel = `${Math.round(leg.km).toLocaleString()} km`;
    const timeLabel = h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
    const weird = opts.allowWeird && leg.mode !== "flight" && Math.random() < 0.5;
    const vehiclePhrase = weird
      ? `aboard ${pick(FUNNY_VEHICLES)} (moving at roughly ${MODE_PLAIN[leg.mode]} speed, scientifically dubious)`
      : `travelling ${MODE_NOUN[leg.mode]}`;
    const destPhrase = isMain ? ` towards ${destLabel}` : (leg.label ? ` ${leg.label}` : "");
    const verb = isFirst ? "Head out" : "Continue";
    const joke = isMain ? distanceJoke(Math.round(leg.km)) : "";
    return `${verb}${destPhrase} ${vehiclePhrase} — ${kmLabel}, about ${timeLabel}${joke}`;
  }

  // Plans one directional hop (a single planLegs() call) and renders all of
  // its stage lines in one go — the one piece shared by an outbound leg, a
  // "return, different way" leg, and every hop of a loop.
  function describeLegSet(legs, opts, destLabel) {
    const mainIdx = legs.reduce((best, l, i) => (l.km > legs[best].km ? i : best), 0);
    const lines = legs.map((leg, i) => legStageText(leg, opts, i === 0, i === mainIdx, destLabel));
    return { lines, hours: totalHours(legs) };
  }

  function normalizeModeOpts(opts) {
    return {
      allowWalk: opts.allowWalk !== false,
      allowBike: opts.allowBike !== false,
      allowCar: opts.allowCar !== false,
      preferPublic: !!opts.preferPublic,
      allowWeird: !!opts.allowWeird
    };
  }

  // Builds a full route: real mode-aware legs (driven by the transport
  // checkboxes) dressed up with comedy, plus the actual timing/rudeness
  // numbers that drive the UI's countdown and badges.
  // `tripType` is one of "oneway" | "return-same" | "return-other":
  //   - oneway: just the outbound leg.
  //   - return-same: the classic "reversed" return, timed as 2x outbound.
  //   - return-other: a genuinely different plan (and mode mix) for the
  //     way back, timed on its own.
  function buildFunnyRoute(startName, target, startLat, startLon, tripType = "oneway", opts = {}, variant = 0, weatherLine = null) {
    const options = normalizeModeOpts(opts);
    const stages = [];
    const from = startName || "your current position";
    const hasCoords = typeof startLat === "number" && typeof startLon === "number";
    const km = hasCoords ? haversineKm(startLat, startLon, target.lat, target.lon) : 0;

    if (weatherLine) stages.push(weatherLine);
    stages.push(`Leave ${from}`);

    const outboundLegs = hasCoords ? planLegs(km, options, variant) : [{ mode: "car", km: 0, label: "" }];
    const outbound = describeLegSet(outboundLegs, options, target.loc);
    stages.push(...outbound.lines);

    stages.push(`Stop at ${pick(FUNNY_HUBS)} to ask for directions (they will be confidently wrong)`);
    stages.push(`Arrive at ${target.name}, slightly dizzy but triumphant`);

    let returnHours = 0;
    if (tripType === "return-same") {
      stages.push(`Return leg: same route, reversed${options.allowWeird ? `, aboard ${pick(FUNNY_VEHICLES)}` : ""}`);
      returnHours = outbound.hours;
    } else if (tripType === "return-other") {
      const returnLegs = hasCoords ? planLegs(km, options, variant === 0 ? 1 : 0) : outboundLegs;
      const ret = describeLegSet(returnLegs, options, from);
      stages.push(`Return leg — a completely different way back:`);
      stages.push(...ret.lines);
      returnHours = ret.hours;
    }

    return {
      stages,
      hours: Math.round(outbound.hours * 10) / 10,
      roundTripHours: tripType === "oneway" ? null : Math.round((outbound.hours + returnHours) * 10) / 10,
      rudeness: rudenessScore(outboundLegs, options)
    };
  }

  // A loop: start -> stop 1 -> stop 2 -> ... -> back to start. Every hop is
  // a real mode-aware leg between two real targets, closed by one final hop
  // back to the start — "figure of 8" in spirit, a simple closed circuit in
  // practice (still driven entirely by real distances).
  function buildLoopRoute(startName, targets, startLat, startLon, opts = {}, weatherLine = null) {
    const options = normalizeModeOpts(opts);
    const stages = [];
    const from = startName || "your current position";
    const hasCoords = typeof startLat === "number" && typeof startLon === "number";

    if (weatherLine) stages.push(weatherLine);
    stages.push(`Leave ${from} on a loop through ${targets.length} stop${targets.length === 1 ? "" : "s"}`);

    let totalH = 0;
    let cLat = startLat, cLon = startLon;
    const legsAll = [];
    targets.forEach((t, i) => {
      const km = hasCoords ? haversineKm(cLat, cLon, t.lat, t.lon) : 0;
      const legs = hasCoords ? planLegs(km, options, i % 2) : [{ mode: "car", km: 0, label: "" }];
      const { lines, hours } = describeLegSet(legs, options, t.loc);
      stages.push(...lines);
      stages.push(`Stop ${i + 1}: ${t.name} — poke around, take a photo, pretend you planned this`);
      totalH += hours;
      legsAll.push(...legs);
      cLat = t.lat; cLon = t.lon;
    });

    stages.push(`Somewhere along the way, stop at ${pick(FUNNY_HUBS)} to ask for directions (they will be confidently wrong)`);

    const closingKm = hasCoords ? haversineKm(cLat, cLon, startLat, startLon) : 0;
    const closingLegs = hasCoords ? planLegs(closingKm, options, targets.length % 2) : [{ mode: "car", km: 0, label: "" }];
    const closing = describeLegSet(closingLegs, options, from);
    stages.push(`Close the loop back to ${from}:`);
    stages.push(...closing.lines);
    totalH += closing.hours;
    legsAll.push(...closingLegs);

    stages.push(`Arrive back where you started, having somehow visited ${targets.length} real place${targets.length === 1 ? "" : "s"} and explained none of it to anyone`);

    return {
      stages,
      hours: Math.round(totalH * 10) / 10,
      roundTripHours: Math.round(totalH * 10) / 10,
      rudeness: rudenessScore(legsAll, options)
    };
  }

  const KEYWORD_IDEAS = [
    "castle", "waterfall", "lighthouse", "cave", "bridge", "market",
    "brewery", "vineyard", "island", "ruins", "garden", "tower",
    "monastery", "windmill", "harbour", "canyon", "volcano", "lake",
    "fortress", "abbey", "palace", "museum", "library", "park", "beach"
  ];

  // Public API
  global.TripSearchEngine = {
    fetchRandomTarget,
    fetchRandomTargets,
    fetchNewsTarget,
    fetchWikipediaThumbnail,
    buildFunnyRoute,
    buildLoopRoute,
    rudenessBadge,
    haversineKm,
    pick,
    KEYWORD_IDEAS,
    // Extension points for files like modes-extra.js:
    registerCategoryTags,
    fetchJson
  };
})(window);
