// ═══════════════════════════════════════════════════════════════
//  globe-panels.js — registers every panel on globe.html with
//  js/panel-toggle.js (same pattern and storage as the Feeling Lucky page;
//  ids start with "globe-" so the two pages keep their own choices).
//
//    globe-header   top bar                     hidden → tab under the top edge
//    globe-news     News bar                    folds up to its header
//    globe-weather  Weather bar                 folds up to its header
//    globe-side     Trip controls               wide: edge tab · phone: header
// ═══════════════════════════════════════════════════════════════
(function () {
  const P = window.sfPanels;
  if (!P) return;
  const narrow = window.matchMedia("(max-width: 820px)");
  const reflow = () => window.dispatchEvent(new Event("resize"));

  function start() {
    P.register({
      id: "globe-header", el: "#globeHeader", label: "the top bar", side: "top",
      read: () => !document.body.classList.contains("sf-hidden-globe-header"),
      apply: (open) => { document.body.classList.toggle("sf-hidden-globe-header", !open); reflow(); }
    });
    P.set("globe-header", P.saved("globe-header", true), { noSave: true });

    P.register({ id: "globe-news", el: "#news-bar", label: "the news", side: "top", open: false });
    P.register({ id: "globe-weather", el: "#weather-bar", label: "the weather", side: "top", open: false });

    P.register({
      id: "globe-side", el: "#globeSide", label: "the trip controls",
      side: () => (narrow.matches ? "bottom" : "right"),
      apply: (open) => { document.getElementById("globeSide").classList.toggle("sf-panel-collapsed", !open); reflow(); }
    });
    const resync = () => P.sync("globe-side");
    if (narrow.addEventListener) narrow.addEventListener("change", resync);
    else if (narrow.addListener) narrow.addListener(resync);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
