async function fromWikipedia() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`);
  if (!res.ok) throw new Error("wiki");
  const j = await res.json();
  const items = [];
  for (const bundle of j.news || []) {
    for (const link of bundle.links || []) {
      items.push({
        title: link.normalizedtitle || link.title,
        url: link.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(link.title)}`,
        source: "Wikipedia", time: now
      });
    }
  }
  return items;
}
export async function loadNews() {
  try {
    if (window.TripSearchEngine?.fetchNewsTarget) {
      const t = await window.TripSearchEngine.fetchNewsTarget(null, null);
      if (t) return { items: [{ title: t.name, url: t.link || "#", source: t.loc, time: new Date() }], source: "GDELT" };
    }
  } catch {}
  return { items: (await fromWikipedia()).slice(0, 12), source: "Wikipedia" };
}
