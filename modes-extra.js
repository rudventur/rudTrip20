// ==========================================================================
// modes-extra.js — extra Lucky modes, kept out of search-engine.js
//
// Historical / Geographical / Topo & Gems each register a handful of
// different OSM tag "mixes" via TripSearchEngine.registerCategoryTags() —
// one mix is picked at random per search, so the same mode doesn't always
// pull the exact same flavor of place twice in a row.
//
// Viral has no OSM/GDELT equivalent of "trending", so it's wired to
// Wikipedia's own live trending-pageviews feed instead, filtered to
// whichever trending articles actually resolve to a map location. Its
// "mix" is which Wikipedia language edition's trending list gets checked
// this time, for some geographic spread beyond English-language topics.
//
// Load this AFTER search-engine.js and BEFORE the page's own script.
// ==========================================================================
(function (global) {
  "use strict";

  const T = global.TripSearchEngine;
  if (!T) {
    console.error("modes-extra.js loaded before search-engine.js — the four extra modes will not work.");
    return;
  }

  // ---------- Historical / Geographical / Topo & Gems ----------
  T.registerCategoryTags("historical", {
    present: {
      mixes: [
        [["historic", "ruins|archaeological_site|fort|castle"]],
        [["historic", "monument|memorial|wayside_cross|wayside_shrine"]],
        [["historic", ".*"]]
      ]
    }
  });

  T.registerCategoryTags("geographical", {
    present: {
      mixes: [
        [["natural", "peak|volcano|glacier|cliff"]],
        [["natural", "cape|bay|strait|spring|reef|waterfall"], ["place", "island"]],
        [["natural", "cave_entrance|geyser|hot_spring|sinkhole|dune"]]
      ]
    }
  });

  T.registerCategoryTags("gems", {
    present: {
      mixes: [
        [["tourism", "viewpoint"]],
        [["natural", "cave_entrance|sinkhole|arch|rock|stone"]],
        [["historic", "wayside_cross|wayside_shrine"]]
      ]
    }
  });

  // ---------- Viral: Wikipedia trending, filtered to real places ----------
  const WIKI_TIMEOUT_MS = 10000;
  const WIKI_TRENDING_EXCLUDE = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Category:|Talk:|User:)/i;
  // A handful of language editions to rotate through, so "what's trending"
  // isn't always English-language-only. Each has its own trending list.
  const WIKI_LANGS = ["en", "es", "fr", "de", "ja"];

  function pageviewsDateParts(daysAgo) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    return {
      y: d.getUTCFullYear(),
      m: String(d.getUTCMonth() + 1).padStart(2, "0"),
      day: String(d.getUTCDate()).padStart(2, "0")
    };
  }

  // The pageviews API usually lags a day or two behind "now", so this tries
  // progressively older dates instead of assuming yesterday always exists.
  async function fetchTrendingTitles(lang) {
    for (const daysAgo of [1, 2, 3]) {
      const { y, m, day } = pageviewsDateParts(daysAgo);
      try {
        const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${y}/${m}/${day}`;
        const data = await T.fetchJson(url, {}, WIKI_TIMEOUT_MS);
        const articles = (data.items && data.items[0] && data.items[0].articles) || [];
        const titles = articles
          .filter(a => a.article && !WIKI_TRENDING_EXCLUDE.test(a.article))
          .slice(0, 60)
          .map(a => ({ title: a.article, rank: a.rank }));
        if (titles.length) return titles;
      } catch (e) {
        console.warn(`Wikipedia (${lang}) pageviews unavailable for`, y, m, day, e && e.message);
      }
    }
    return [];
  }

  // Batch-looks-up coordinates (+ a blurb + thumbnail) for a set of trending
  // titles in one request, keeping only the ones that resolve to a real
  // place — a trending person or event with no fixed location just drops
  // out here rather than getting a fabricated pin.
  async function fetchCoordsForTitles(lang, titles) {
    const rankByTitle = new Map(titles.map(t => [t.title.replace(/_/g, " "), t.rank]));
    const batch = titles.slice(0, 50).map(t => t.title).join("|");
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=coordinates|pageimages|extracts&exintro=1&explaintext=1&exchars=200&piprop=thumbnail&pithumbsize=500&titles=${encodeURIComponent(batch)}`;
    const data = await T.fetchJson(url, {}, WIKI_TIMEOUT_MS);
    const pages = (data.query && data.query.pages) || {};

    const results = [];
    for (const page of Object.values(pages)) {
      if (!page.coordinates || !page.coordinates.length) continue;
      const coord = page.coordinates[0];
      results.push({
        name: page.title,
        extract: page.extract || "",
        lat: coord.lat,
        lon: coord.lon,
        link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        photoUrl: page.thumbnail ? page.thumbnail.source : null,
        rank: rankByTitle.get(page.title) || null
      });
    }
    return results;
  }

  T.fetchViralTarget = async function fetchViralTarget(onStatus) {
    const say = m => { if (onStatus) onStatus(m); };
    const lang = T.pick(WIKI_LANGS);
    try {
      say(`Checking what's trending on Wikipedia (${lang})…`);
      const titles = await fetchTrendingTitles(lang);
      if (!titles.length) return null;

      say("Finding trending topics that actually have a place…");
      const withCoords = await fetchCoordsForTitles(lang, titles);
      if (!withCoords.length) return null;

      const chosen = T.pick(withCoords);
      const rankLabel = chosen.rank ? ` (#${chosen.rank} today)` : "";
      return {
        name: chosen.name,
        loc: chosen.name,
        lat: chosen.lat,
        lon: chosen.lon,
        desc: `Trending on ${lang}.wikipedia${rankLabel}${chosen.extract ? " · " + chosen.extract : ""}`,
        link: chosen.link,
        photoUrl: chosen.photoUrl,
        source: "viral"
      };
    } catch (err) {
      console.warn("Viral/trending fallback unavailable:", err && err.message);
      return null;
    }
  };
})(window);
