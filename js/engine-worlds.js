/* Patch TripSearchEngine so world ticks become OSM tags, not name keywords. */
(function (global) {
  const E = global.TripSearchEngine;
  if (!E) return;

  const WORLD_TAGS = {
    ruins: [["historic", "ruins|archaeological_site|fort|castle|monument"]],
    beauty: [["tourism", "viewpoint"], ["natural", "beach|volcano|cliff|hot_spring|bay"]],
    topographic: [["natural", "peak|ridge|volcano|saddle|glacier"]],
    astronomical: [["man_made", "observatory|telescope"], ["amenity", "planetarium"]],
    businesses: [["amenity", "cafe|restaurant|marketplace|pub"]]
  };

  E.tagsFromWorlds = function (worlds) {
    const extra = [];
    if (!worlds) return extra;
    Object.keys(WORLD_TAGS).forEach((k) => {
      if (worlds[k]) extra.push(...WORLD_TAGS[k]);
    });
    return extra;
  };

  E.bboxAroundCentroid = function (lat, lon, spanLat, spanLon) {
    return [Math.max(-85, lat - spanLat), lon - spanLon, Math.min(85, lat + spanLat), lon + spanLon];
  };

  const CENTROIDS = {
    "united states": [39.8, -98.6], canada: [56.1, -106.3], mexico: [23.6, -102.6],
    "united kingdom": [54.0, -2.9], ireland: [53.4, -8.2], france: [46.6, 2.2],
    germany: [51.2, 10.4], spain: [40.0, -3.7], portugal: [39.6, -8.0],
    italy: [42.8, 12.6], poland: [52.0, 19.1], greece: [39.1, 21.8],
    sweden: [62.0, 15.0], japan: [36.2, 138.3], india: [22.4, 78.7],
    china: [35.9, 104.2], thailand: [15.9, 100.9], indonesia: [-2.5, 118.0],
    "south korea": [35.9, 127.8], turkey: [39.0, 35.2], vietnam: [14.1, 108.3],
    brazil: [-10.3, -53.2], argentina: [-35.4, -65.2], chile: [-35.7, -71.5],
    peru: [-9.2, -75.0], colombia: [4.6, -74.3], australia: [-25.3, 133.8],
    "new zealand": [-41.0, 174.9], fiji: [-17.7, 178.1], "papua new guinea": [-6.3, 143.9],
    egypt: [26.8, 30.8], morocco: [31.8, -7.1], kenya: [0, 37.9],
    nigeria: [9.1, 8.7], "south africa": [-30.6, 22.9], ethiopia: [9.1, 40.5],
    ghana: [7.9, -1.0], tanzania: [-6.4, 34.9], cuba: [21.5, -79.5], guatemala: [15.8, -90.2]
  };

  E.countryCentroid = E.countryCentroid || function (name) {
    if (!name) return null;
    return CENTROIDS[String(name).trim().toLowerCase()] || null;
  };
})(window);
