# rudTrip20 spec

Feeling Lucky travel surface. One live roll, a story-line trip, a globe with continent contours. Not a brochure. Not turn-by-turn routing.

Repo: `rudventur/rudTrip20`  
Working branch: `globe-itinerary` (leave `main` / Pages alone until this is ready)

---

## Product

- One real target per roll.
- Buttons later: **Lucky Place / Lucky Event / Good Trip**.
- Start = device GPS, else a random point on the ticked landmass.
- Finish = the rolled target (or last stop). Optional **return to start**.
- Duration: **1 / 2 / 3 days**. One-way or return.
- Multiple stops allowed. Times are bands with wiggle (rush vs linger), not timetables.

### Itinerary is a sentence, not a map route

No precise routing polyline on the globe. Show only the chain:

```
START
  — [you choose BIKE · ~2h · to Kings Cross]
  — [you choose TRAIN · ~2.5h · to Paris]
  — [you choose TAXI · ~0.5h · to Orly]
  — [you choose FLIGHT · ~2.5h · to Barcelona]
  — [you choose BIKE · ~1h · to La Rumba]
FINISH
```

Each step: ticked transport mode + duration band + place name.  
Transport ticks come from the map-merger-venti mode set (walk, bike, bus, train, taxi, ferry, flight, …). Unticked modes cannot appear in the chain.

---

## Globe

- Continent outlines. Ticked continents = target pool.
- One continent ticked → camera closes on that continent, then country / state / region ticks unlock.
- Start marker at GPS (or random). Target marker at the roll. Soft arc between them is allowed. No street geometry.

---

## Target worlds (tickboxes)

A roll picks **one** live thing from the ticked set:

| Tick | Meaning |
|------|--------|
| places | settlements, named spots |
| businesses | live OSM amenities / shops |
| events · past | historical |
| events · now | current |
| events · future | forthcoming |
| beauty | landscape / scenic |
| topographic | random relief or altitude band |
| astronomical | eclipses, showers, dark-sky, etc. |
| ruins | `historic=ruins` and kin |

No static curated lists. No KEYWORD_IDEAS button.

---

## Data

Live first. Fallback must also be live.

1. Race Overpass mirrors for OSM features. Honour ticks in the query.
2. Soft rate-limit: 429 / timeout / empty → fall through, do not block the user.
3. Fallback: live GDELT headlines, placed (point if known, else country centroid).
4. Weather: Open-Meteo, no key. Device geo, else London.
5. News bar: GDELT if CORS allows, else Wikipedia featured / news feed.

Existing `search-engine.js` is the starting engine. Extend it; do not replace it with a list.

---

## Shell (also planned)

- Expanding **news** bar (ticker → list).
- Expanding **weather** bar (now + 7-day).
- Stage: globe + itinerary strip + Lucky buttons.

---

## Build order

1. This spec (done).
2. Split the 74kb `index.html` so globe / itinerary / engine can move separately.
3. Globe with continent outlines + tick → zoom.
4. Itinerary strip (START — … — FINISH).
5. Hook `search-engine.js` to one Lucky Place roll.
6. Duration / return / multi-stop / transport ticks.
7. Merge to `main` only when the shell is usable.

## Constraints

- Static site. No backend unless CORS later forces a tiny proxy.
- Serve over http, not `file://`.
- Small commits. Branch first, Pages later.
