# Тенью и чистым воздухом

A pedestrian navigator for Bishkek. It finds a route that is almost as fast as the shortest one but goes through more shade and further from car exhaust.

**How to use:** open the site → press **📍 Где я**. The map of the area around you downloads from OpenStreetMap. Then tap where you are going.

## How it works
- **Sun:** solar position for the date and time, then building and tree shadows rasterised at 2 m. The heat a standing person absorbs is `0.7 · f_p(h) · I_D(h) · 1.8 m²` (Meinel direct irradiance, Kasten–Young air mass, Fanger projected-area factor).
- **Exhaust:** every road is a line source with distance decay `0.6·e^(−d/40) + 0.4·e^(−d/250)` (shape after Karner et al., 2010). Hourly traffic profiles differ for arterials and local streets and for weekdays, weekends and holidays. A congestion factor `1 + c·k⁴` accounts for stop-and-go traffic.
- **Routing:** Dijkstra with Lagrangian relaxation to minimise harm subject to `T ≤ (1+ε)·T₀`. The search is limited to the ellipse `|PA|+|PB| ≤ v_max(1+ε)T₀`, which provably contains every admissible route.

## Files
- `index.html`, `app.js` — the app (static, no server needed)
- `parse.js` — OSM parser (Web Worker in the browser, also used by Node)
- `data/bishkek.json` — the whole of Bishkek, rebuilt daily by `.github/workflows/update-map.yml`
- `data/demo.json` — a small demo of the city centre
- `scripts/build-map.mjs` — `node scripts/build-map.mjs city.osm data/city.json`

Map data © OpenStreetMap contributors, ODbL.
