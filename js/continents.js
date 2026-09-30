export const CONTINENTS = {
  africa: { label: "Africa", bbox: [-35, -18, 38, 52], countries: ["egypt", "morocco", "kenya", "nigeria", "south africa", "ethiopia", "ghana", "tanzania"] },
  europe: { label: "Europe", bbox: [35, -25, 72, 40], countries: ["united kingdom", "france", "spain", "italy", "germany", "poland", "greece", "sweden", "portugal", "ireland"] },
  asia: { label: "Asia", bbox: [5, 26, 78, 146], countries: ["japan", "india", "china", "thailand", "indonesia", "south korea", "turkey", "vietnam"] },
  "north-america": { label: "North America", bbox: [7, -168, 84, -52], countries: ["united states", "canada", "mexico", "cuba", "guatemala"] },
  "south-america": { label: "South America", bbox: [-56, -82, 13, -34], countries: ["brazil", "argentina", "chile", "peru", "colombia"] },
  oceania: { label: "Oceania", bbox: [-47, 110, -10, 180], countries: ["australia", "new zealand", "fiji", "papua new guinea"] },
  antarctica: { label: "Antarctica", bbox: [-90, -180, -60, 180], countries: [] }
};
export const SHAPES = {
  africa: [[-17,32],[-10,36],[10,37],[32,31],[43,11],[51,11],[43,-11],[40,-15],[32,-26],[19,-35],[12,-18],[13,-8],[8,4],[-5,5],[-10,6],[-17,12],[-17,21],[-17,32]],
  europe: [[-10,36],[-9,42],[-8,43],[-5,48],[-5,58],[-1,60],[5,62],[12,66],[25,71],[30,70],[30,60],[28,53],[24,45],[29,41],[20,40],[12,36],[3,36],[-5,36],[-10,36]],
  asia: [[26,41],[36,36],[44,40],[60,37],[68,37],[77,28],[90,22],[104,1],[109,14],[121,22],[140,35],[142,46],[130,50],[90,55],[80,50],[70,55],[60,50],[45,47],[40,45],[32,41],[26,41]],
  "north-america": [[-168,66],[-140,70],[-105,68],[-84,73],[-60,60],[-55,50],[-68,48],[-80,25],[-97,16],[-105,22],[-117,32],[-124,48],[-153,58],[-168,66]],
  "south-america": [[-81,12],[-60,8],[-50,2],[-35,-7],[-40,-22],[-54,-28],[-67,-55],[-75,-52],[-71,-18],[-79,-5],[-81,12]],
  oceania: [[113,-22],[135,-12],[146,-16],[153,-27],[150,-38],[140,-38],[114,-35],[113,-22]],
  antarctica: [[-180,-62],[180,-62],[180,-85],[-180,-85],[-180,-62]]
};
export function lonLatToXy(lon, lat, width, height) {
  return [(lon + 180) / 360 * width, (90 - lat) / 180 * height];
}
export function unionBbox(ids) {
  const boxes = ids.map((id) => CONTINENTS[id]?.bbox).filter(Boolean);
  if (!boxes.length) return [-60, -180, 75, 180];
  return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}
export function shrinkBbox(bbox, frac = 0.22) {
  const [s, w, n, e] = bbox;
  const latPad = (n - s) * frac;
  const lonPad = (e - w) * frac;
  const lat = s + (n - s) * (0.3 + Math.random() * 0.4);
  const lon = w + (e - w) * (0.3 + Math.random() * 0.4);
  return [Math.max(-85, lat - latPad), lon - lonPad, Math.min(85, lat + latPad), lon + lonPad];
}
