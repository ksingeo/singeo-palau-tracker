# Palau Tracker

A live dashboard for the Republic of Palau: ships in and around the EEZ,
flights, Palau news and Facebook pages, weather and sea state, typhoons,
earthquakes and tsunami bulletins, coral heat stress and fishing activity.
Hover over anything (map markers, list rows, tiles, chart points, news cards)
to see its details.

## What's on it

| Panel | Source | Refresh |
|---|---|---|
| **Ships (AIS)** in/around the EEZ, with flag, type, speed, destination, EEZ / territorial-sea status, tracks and a watch list | [aisstream.io](https://aisstream.io) (free key) | every run (~20 min) |
| **Flights** within 250 NM of Roman Tmetuchl Intl (ROR), 24 h flight log, likely arrivals | adsb.lol + adsb.fi; optional live mode from OpenSky in your browser | every run / 3 min live |
| **News**: Island Times, PalauGov.pw, RNZ Pacific, Pacific Island Times, Google News, Bing News, filtered for Palau and tagged by topic and country | RSS | every run |
| **Facebook**: Island Times, Office of the President, Tia Belau, PVA, MHHS, NEMO, Palau Weather Service | Facebook page plugin | live |
| **Weather & sea**: current conditions, 7-day forecast, 48 h temperature and rain, waves and swell, Malakal Harbor tides | Open-Meteo, NOAA CO-OPS | live in browser |
| **Typhoons** (tracks + forecast cones), **tsunami bulletins**, **earthquakes** within 1,500 km | GDACS, NOAA PTWC/NTWC, USGS | every run / live |
| **Coral health**: reef SST vs bleaching threshold, Degree Heating Weeks, bleaching alert level; satellite true colour and SST map layers | NOAA Coral Reef Watch, NASA GIBS | daily |
| **Fishing activity**: fishing, encounters (possible transshipment), loitering, AIS gaps, port visits, effort by flag, effort grid | Global Fishing Watch (free token) | every 6 h |
| **Backup live maps**: VesselFinder, MarineTraffic and the adsb.lol globe | embeds | live |
| **Data sources** status, **traffic trends** (14 days), **watch list** | | |

## Set-up (one time, about 10 minutes)

1. **Merge this branch into `main`.** Scheduled GitHub Actions only run on the default branch.
2. **Turn on GitHub Pages:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Add the free API keys** under **Settings → Secrets and variables → Actions → New repository secret**:
   - `AISSTREAM_API_KEY`: sign in at <https://aisstream.io/authenticate> and create a key (ships).
   - `GFW_TOKEN`: request a non-commercial token at <https://globalfishingwatch.org/our-apis/tokens> (fishing activity).

   Without them the dashboard still works and shows set-up hints in those panels.
4. **Run it:** **Actions → Update data & deploy → Run workflow.** The site appears at
   `https://<your-user>.github.io/singeo-palau-tracker/`, and the workflow then re-runs every ~20 minutes.

> The site is public (it's a public repo on GitHub Pages). It contains only public data. Your API keys stay in GitHub secrets and are never published.

> GitHub pauses scheduled workflows in a repo with no activity for 60 days. If the data stops updating, re-enable the workflow on the Actions tab.

## Customising

- **Facebook pages:** edit `FACEBOOK_PAGES` in `assets/js/config.js`, or use **Edit pages** on the dashboard (saved per browser).
- **News sources and filters:** `SOURCES`, `EXCLUDE` and `TOPICS` in `scripts/fetch_news.py`.
- **Ship watch list:** `WATCH_NAME` regex in `scripts/fetch_ships.py` (or a `SHIP_WATCH_REGEX` env var); flag rules are in `enrich()`.
- **AIS listening time:** repository variable `AIS_LISTEN_SECONDS` (default 150).
- **Map centre, quake radius, tide station:** `assets/js/config.js`.

## Run locally

```bash
pip install -r requirements.txt
```

```bash
AISSTREAM_API_KEY=... GFW_TOKEN=... python scripts/update_all.py
```

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Tests: `python tests/test_pipeline.py`.

## Layout

```
index.html                 dashboard page
assets/css/styles.css      light/dark theme
assets/js/                 app.js (panels), map.js (Leaflet), charts.js (SVG charts), tips.js (hover cards), config.js
assets/geo/                Palau EEZ, 12 NM territorial sea, boundary lines (Marine Regions, CC-BY 4.0)
scripts/                   data fetchers run by the GitHub Action (update_all.py runs them all)
data/                      generated JSON (the deployed site always has the latest; this copy is a seed)
.github/workflows/         scheduled update + Pages deploy
```

## Limits worth knowing

- **AIS and ADS-B coverage around Palau is thin.** Both depend on volunteer shore receivers, so ships far offshore and aircraft away from Koror can be missing. Global Fishing Watch (satellite AIS, ~3–5 day lag) and the backup maps fill some of the gap. Vessels that switch AIS off are invisible to all of these.
- **Facebook** doesn't allow searching public posts, so the dashboard embeds specific public pages. Browser tracking protection or ad blockers can hide the embeds; each tab has an "Open on Facebook" link.
- **The western EEZ edge** with the Philippines and Indonesia is a provisional median line, not a settled boundary.
- Not for navigation or safety-of-life decisions. Follow Palau NEMO and the National Weather Service for warnings.
