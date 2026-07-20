# Where we are, what it costs, and what to build next

This is the honest "you are here" for the product. The live app
(https://map-tracker.pages.dev/) already runs real scans end-to-end.

## 1. Already done (was the original roadmap)

1. ✅ **DataForSEO wired live** — the `local_finder` adapter powers real scans
   (`src/collect/dataForSeoProvider.ts`, `functions/_scan.ts`).
2. ✅ **Persistence** — Cloudflare **D1** database, migrations in `migrations/`.
3. ✅ **Job queue** — async scans via a Cloudflare Queue (`map-scan-jobs`):
   the API enqueues, the Worker consumes with retries; parallel batch scanning
   across keywords.
4. ✅ **Scheduling** — weekly cron Worker (Mondays 06:00 UTC) re-scans and
   raises alerts.
5. ✅ **Multi-business dashboard** — businesses with grouped keywords, bulk CSV
   import, deletion with confirmation.
6. ✅ **History & alerts** — scan history, compare/change heatmaps, SoLV trend
   charts, annotations, ≥10-pt SoLV-drop / 3-pack-exit alerts (optional email
   via Resend).
7. ✅ **Accuracy hardening** — per-pin retry, anomaly re-checks, deeper
   competitor data per pin.

## 2. What we still need from you

| # | Input | Why | Blocker? |
|---|-------|-----|----------|
| 1 | **Keyword lists** per business you want tracked | Defines what we scan. Start with 5–10 real money keywords each. | Only for new businesses |
| 2 | **Grid preferences**: radius + density (default 13×13 @ 500 m) | Controls cost vs coverage. See §3. | No (sensible default) |
| 3 | **Scoped Cloudflare API token** (replaces the global key) | Safety — see `docs/DEPLOY.md`. | No, but strongly recommended |
| 4 | **Budget ceiling** for SERP calls | Grid × keywords × devices multiplies fast (§3). | No |

Optional later: competitor Place IDs (to chart who replaces you where), Mapbox
key if you outgrow free OSM tiles.

## 3. Cost model — read before choosing a grid

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

## 4. What to build next

1. **Auth / multi-tenant** — the dashboard is currently open; add login before
   sharing the URL beyond yourselves.
2. **Second surface** — Google Search local 3-pack as a *separate* tracker
   (never mixed with Maps). Keep mobile and desktop separate too.
3. **Postgres/PostGIS option** — D1 (SQLite) works today; migrate behind the
   store seam (`schema.sql` is the PG target) if richer geo queries are needed.
4. **Mobile vs desktop device split** in scans and history.

## 5. Accuracy practices already designed in (keep them)

- Permanent, identical coordinates every scan (deterministic point IDs).
- Place-ID-first matching; `null` rank means "looked to depth N, not found" —
  never stored as depth+1.
- Anomaly retry for isolated bad pins; per-pin retry on failed collections.
- Raw payload retention for auditing and re-parsing.
- Signed-out, non-personalised, fixed language/country/zoom/device.
- Depth ≥ 20 so "not in top 20" is meaningful.

Operationally: keep the **collection IP geographically compatible** with the
scan region (UK IP + `en-GB` + Europe/London for UK scans) — the SERP provider
handles IP reputation, CAPTCHAs, and retries.
