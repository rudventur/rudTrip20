// ═══════════════════════════════════════════════════════════════
//  panels.js — registers every panel on the Feeling Lucky page with
//  js/panel-toggle.js, so they all hide and show the same way and
//  remember it on this device (localStorage "rudTrip20.panels.v1").
//
//    header     the top panel (title)          hidden → tab under the top edge
//    weather    🌦️ Weather + news bar           folds up to its header
//    universe   🗺️ RudVentur Universe Map       folds up to its header
//    board      🧿 Living Trip Board            folds up to its header
//    inventory  🎒 left column                  wide: edge tab · phone: header
//    dashboard  📌 right column                 wide: edge tab · phone: header
// ═══════════════════════════════════════════════════════════════
(function () {
  const P = window.sfPanels;
  if (!P) return;
  const narrow = window.matchMedia("(max-width: 800px)");
  const reflow = () => window.dispatchEvent(new Event("resize"));   // the grid map re-measures

  P.register({
    id: "header", el: "#tripHeader", label: "the top panel", side: "top",
    read: () => !document.body.classList.contains("sf-hidden-header"),
    apply: (open) => document.body.classList.toggle("sf-hidden-header", !open)
  });
  P.set("header", P.saved("header", true), { noSave: true });

  P.register({ id: "weather", el: "#weatherTicker", label: "weather + news", side: "top", open: false });
  P.register({ id: "universe", el: "#rvuSection", label: "the Universe Map", side: "top", open: false });
  P.register({ id: "board", el: "#ltbSection", label: "the Living Trip Board", side: "top", open: false });

  const column = (id, el, label, wide, phone) => {
    P.register({
      id, el, label, side: () => (narrow.matches ? phone : wide),
      apply: (open) => { document.querySelector(el).classList.toggle("sf-panel-collapsed", !open); reflow(); }
    });
  };
  column("inventory", "#inventory", "the inventory", "left", "top");
  column("dashboard", "#dashPanel", "the dashboard", "right", "bottom");

  // chevrons follow the layout (column on wide screens, stacked on phones)
  const resync = () => ["inventory", "dashboard"].forEach((id) => P.sync(id));
  if (narrow.addEventListener) narrow.addEventListener("change", resync);
  else if (narrow.addListener) narrow.addListener(resync);
})();
