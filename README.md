# map-tracker

A Google Maps **grid rank tracker**. It measures how a Google Business Profile
(GBP) ranks on Google Maps from many precise geographic origins, then colours a
grid so you can see exactly where you are strong and weak.

The core idea: **each grid pin behaves like a separate person physically
standing at that latitude/longitude and searching Google Maps.** The coloured
grid is just the display layer — the hard, valuable part is producing a clean,
repeatable local search from every coordinate and matching your business
reliably in the results. This repo builds that hard part.

**Live app:** https://map-tracker.pages.dev/ — real Google Maps data via DataForSEO.

Type a business name → pick the right listing from the typeahead (auto-matched on
website) → enter a keyword → get a live grid heatmap. Scans are saved to a
Cloudflare D1 database so you can compare over time, and a weekly cron Worker
re-scans automatically and raises alerts on drops.

## The app (v2)

- **Find listing** — typeahead over the Google business-listings database
  (`/api/suggest`), auto-selected by website domain.
- **Live scan** — grid scans run through an async queue (`/api/scan`), saved to
  history. Keywords are grouped under a business, and multiple keywords scan in
  parallel batches; bigger grid sizes are supported.
- **Businesses** — dashboard of every tracked business; bulk CSV import;
  businesses and keywords can be deleted (with an in-app confirmation modal).
- **History & Compare** — pick any two scans (or "vs last") → **change heatmap**
  (green improved / red worse per pin), metric deltas, and a Share-of-Local-Voice
  **trend chart** over time.
- **Annotations** — pin notes ("added photos", "changed category") to dates so you
  can correlate actions with ranking movement.
- **Alerts** — the weekly Worker flags a ≥10-pt SoLV drop or falling out of the
  local 3-pack (optional email via Resend).
- **Accuracy safeguards** — per-pin retry on failed collections, anomaly
  re-checks (an isolated bad pin is re-collected before it's trusted), and
  deeper competitor data per pin.

Backend: Cloudflare Pages + Pages Functions + **D1** (SQLite) + a scheduled Worker.
Credentials live as Cloudflare secrets, never in the client or repo.

---

### Offline engine (also included)

---

## What works today

Running end-to-end, offline, with zero external services:

- **Geodesic grid generation** — square (9×9, 13×13…) and progressive-density
  radial grids, placed by true ground distance (not naive lat/lng addition),
  with permanent, deterministic point IDs so every scan reuses identical
  coordinates. `src/core/grid.ts`, `src/core/geo.ts`
- **Pluggable collection** — a `MapsSerpProvider` interface with two
  implementations: a **mock provider** that models a believable local world
  (runs offline), and a **DataForSEO adapter** ready for real API keys.
  `src/collect/`
- **Reliable business matching** — Place ID → CID → domain → phone → name+address,
  in strict priority order, recording *how* it matched. `src/core/match.ts`
- **Multiple rank concepts** — Maps rank, in-top-3, in-top-10, rank bucket, and a
  proper `null` for "not found within checked depth". `src/core/rank.ts`
- **Scoring** — Share of Local Voice, % top-3/top-10, median rank, max ranking
  radius, strongest/weakest compass direction, dominant competitor.
  `src/core/scoring.ts`
- **Scan orchestration** with **anomaly retry** — an isolated bad pin in a sea of
  good ones is re-collected once before it's trusted. `src/core/scan.ts`
- **Deployable heatmap** — a self-contained static site (Leaflet vendored
  locally) rendering the coloured grid, metrics, and per-pin detail.
  `src/report/heatmap.ts` → `web/`

19 unit tests cover the geodesy, grid determinism, matching priority, and scoring.

## Quickstart

```bash
npm install
npm test          # 19 tests
npm run demo      # runs a full scan with the mock provider -> writes web/index.html
```

Open `web/index.html`, or deploy the `web/` folder (see `docs/DEPLOY.md`).

## Architecture

Two clean halves, exactly as in the design brief:

**A. The tracker (this repo owns the value)** — business/competitor data,
keywords, grid generator, scheduling, result storage, matching, rank & visibility
scoring, heatmaps, history.

**B. Collection (swappable)** — a Maps SERP source behind the `MapsSerpProvider`
interface. Start with a hosted API (DataForSEO); later drop in your own browser
fleet without touching anything upstream.

```
GBP + keywords
      │
      ▼
generateGrid ──> permanent grid_points (deterministic, geodesic)
      │
      ▼
runScan ──> for each point: provider.collect() ──> matchTarget() ──> observeRank()
      │            (mock | DataForSEO)
      ▼
scoreScan ──> Share of Local Voice, %top3/10, directions, competitors
      │
      ▼
renderHeatmapHtml ──> web/index.html  (Cloudflare Pages)
```

Persistence: the demo uses a JSON store; `schema.sql` is the production
PostgreSQL + PostGIS target. Nothing in `src/core` depends on storage.

## Important honesty about accuracy

No tool can promise every result matches every real user's phone — a real
searcher may be signed in, carry search history, or stand slightly off the
claimed GPS point. The goal is **a standardised, signed-out, non-personalised,
repeatable measurement of how Maps visibility changes by search origin.** That is
accurate enough to measure SEO improvement, find geographic weak spots, and
compare against competitors consistently.

## Offline demo vs live app

The **live app** (link above) uses real Google Maps data via DataForSEO. The
`npm run demo` command is separate: it runs the offline engine with **mock
data** and overwrites `web/index.html` locally — don't deploy that output over
the live dashboard.

## Docs

- `docs/NEXT-STEPS.md` — what's done, costs, and what to build next
- `docs/DEPLOY.md` — Cloudflare Pages deployment & credential safety
- `schema.sql` — canonical PostgreSQL + PostGIS schema
