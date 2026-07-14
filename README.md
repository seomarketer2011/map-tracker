# map-tracker

A Google Maps **grid rank tracker**. It measures how a Google Business Profile
(GBP) ranks on Google Maps from many precise geographic origins, then colours a
grid so you can see exactly where you are strong and weak.

The core idea: **each grid pin behaves like a separate person physically
standing at that latitude/longitude and searching Google Maps.** The coloured
grid is just the display layer — the hard, valuable part is producing a clean,
repeatable local search from every coordinate and matching your business
reliably in the results. This repo builds that hard part.

**Live demo:** https://map-tracker.pages.dev/ *(mock data — see below)*

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

## What this is not (yet)

The demo's rankings are **mock data**, not live Google results. To produce real
numbers you need a Maps SERP source (DataForSEO keys) — see
`docs/NEXT-STEPS.md` for exactly what's required and the recommended build order.

## Docs

- `docs/NEXT-STEPS.md` — what we need from you, costs, and the roadmap
- `docs/DEPLOY.md` — Cloudflare Pages deployment & credential safety
- `schema.sql` — canonical PostgreSQL + PostGIS schema
