# What we need, what it costs, and what to build next

This is the honest "you are here" for turning the working foundation into a real
product.

## 1. What we need from you (inputs)

To move from mock data to real rankings, in rough priority order:

| # | Input | Why | Blocker? |
|---|-------|-----|----------|
| 1 | **DataForSEO account** (login + password) | The live Maps SERP source. Everything downstream already exists. | Yes — no real ranks without it |
| 2 | **Real GBP identity per business**: Place ID (ideally CID too), plus website, phone, exact lat/lng | Reliable matching. Place ID is the single most important field. | Yes |
| 3 | **Keyword lists** per business | Defines what we scan. Start with 5–10 real money keywords. | Yes |
| 4 | **Grid preferences**: radius + density (default 13×13 @ 500 m) | Controls cost vs coverage. See §2. | No (sensible default) |
| 5 | **Scoped Cloudflare API token** (replaces the global key) | Safety — see `docs/DEPLOY.md`. | No, but strongly recommended |
| 6 | **Budget ceiling** for SERP calls | Grid × keywords × devices multiplies fast (§2). | No |

Optional but valuable later: competitor Place IDs (to chart who replaces you
where), a preferred map provider key (Mapbox) if you outgrow free OSM tiles,
and a Postgres database (managed PG + PostGIS, or Cloudflare D1 for an
edge-native path).

### How to get Place IDs
Use the Google **Places API** (Text Search / Place Details) to resolve a
business name or Maps URL → Place ID + coordinates + address. Places API is for
*identity and enrichment only* — **not** for ranking. Ranking must come from the
Maps SERP source, because the Places result set is not the live Maps ordering a
searcher sees.

## 2. Cost model — read before choosing a grid

Every scan = **points × keywords × devices** separate SERP calls.

| Grid | Points | 10 keywords | 10 kw × mobile+desktop |
|------|-------:|------------:|-----------------------:|
| 9×9 | 81 | 810 | 1,620 |
| 13×13 | 169 | 1,690 | 3,380 |
| 5-mile @ 500 m (circular) | ~813 | 8,130 | 16,260 |

A full 500 m grid across 5 miles is **much** bigger than it sounds. **Do not
start there.** Recommended:

- Default to **13×13 @ 500 m** for routine tracking.
- Use **progressive density** (`mode: 'radial'`, already implemented): tight
  near the business, sparse at the edges.
- Offer "zoom into a weak area" as an on-demand denser second scan.

This gives ~all the useful insight at a fraction of the cost.

## 3. Recommended build order

The foundation (grid, matching, rank, scoring, heatmap, provider interface) is
done. Next, in order:

1. **Wire DataForSEO live** — validate the adapter against a real sample, confirm
   field mapping, retain raw JSON. *(adapter exists: `src/collect/dataForSeoProvider.ts`)*
2. **Persistence** — implement a Postgres/PostGIS repository behind the existing
   store seam (`schema.sql` is ready). Grids and points are permanent; scans and
   results append over time.
3. **Job queue** — one job per (keyword, point). BullMQ/Redis or Celery. Add rate
   limiting, retries, and the anomaly-rerun pass (logic exists in `scan.ts`).
4. **Scheduling** — recurring scans in a single tight time window per keyword so
   heatmap colour reflects geography, not time drift.
5. **Multi-tenant API + auth** — businesses, keywords, grids, scans as real
   resources; the heatmap becomes a data-driven page, not a regenerated file.
6. **History & alerts** — Share-of-Local-Voice over time, movement alerts,
   competitor-change alerts.
7. **Second surface** — add Google Search local 3-pack as a *separate* tracker
   (never mixed with Maps). Keep mobile and desktop separate too.

## 4. Accuracy practices already designed in (keep them)

- Permanent, identical coordinates every scan (deterministic point IDs).
- Place-ID-first matching; `null` rank means "looked to depth N, not found" —
  never stored as depth+1.
- Anomaly retry for isolated bad pins.
- Raw payload retention for auditing and re-parsing.
- Signed-out, non-personalised, fixed language/country/zoom/device.
- Depth ≥ 20 so "not in top 20" is meaningful.

To add operationally: keep the **collection IP geographically compatible** with
the scan region (UK IP + `en-GB` + Europe/London for UK scans). A specialist
provider handles IP reputation, CAPTCHAs, and retries — another reason to start
with one rather than a self-built browser fleet.

## 5. Open decisions for you

1. **Scale**: how many businesses and keywords in v1? (drives cost & queue design)
2. **Cloudflare-native or classic?** Pages + Workers + **D1** + Queues + R2 keeps
   everything on Cloudflare (cheap, edge, but D1 is SQLite — no PostGIS). Versus
   Pages front-end + a managed Postgres/PostGIS backend (richer geo queries).
   Recommendation: **managed Postgres + PostGIS** — you will want real geo
   queries; keep Pages just for the viewer.
3. **Map tiles**: free OSM (fine to start) vs Mapbox (nicer, needs a key).
4. **Rotate the global API key to a scoped token?** (recommended yes)
