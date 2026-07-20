# Deploying to Cloudflare (Pages + D1 + Queues + cron Worker)

The app is a Cloudflare Pages project: static front-end in `web/`, API in
`functions/` (Pages Functions), scan history in a **D1** database, async scan
jobs on a **Queue**, and a separate scheduled **Worker** (`worker/`) that runs
weekly re-scans, consumes the scan queue, and raises alerts.

## Current deployment

- **Project:** `map-tracker`
- **URL:** https://map-tracker.pages.dev/
- **Account:** `Seomarketer2011@yahoo.co.uk` (`44799b719f2192a9f066f425aaff3106`)
- **D1 database:** `map-tracker-db` (`009d9049-832a-47f4-a7b2-138d1af0aaab`)
- **Queue:** `map-scan-jobs` (Pages API enqueues, cron Worker consumes)
- **Cron Worker:** `map-tracker-cron` — every Monday 06:00 UTC

> Note: the environment's default `CLOUDFLARE_ACCOUNT_ID` points at a *different*
> account. Deploys must set the account explicitly (below) to land in the
> Seomarketer2011 account.

## Deploying the Pages app (front-end + API)

```bash
CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106 \
  npx wrangler pages deploy web --project-name map-tracker --branch main
```

`wrangler.toml` at the repo root binds D1 (`DB`) and the queue producer
(`SCAN_QUEUE`); `functions/` is picked up automatically as the Pages API.

Apply any new D1 migrations before deploying code that needs them:

```bash
CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106 \
  npx wrangler d1 migrations apply map-tracker-db --remote
```

## Deploying the cron/queue Worker

```bash
cd worker
CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106 npx wrangler deploy
```

## Secrets

Set on **both** the Pages project and the Worker (they are separate):

- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — live Maps SERP source (required)
- `RESEND_API_KEY` / `ALERT_EMAIL_TO` — alert emails (optional, Worker only)

```bash
npx wrangler pages secret put DATAFORSEO_LOGIN --project-name map-tracker
cd worker && npx wrangler secret put DATAFORSEO_LOGIN   # etc.
```

Credentials live only as Cloudflare secrets — never in the client or repo.

## Credential safety — please read

Deployment currently works because a **Cloudflare Global API Key** is present in
the environment (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`). That key grants
**complete control of every account it can see** and **cannot be scoped or
cleanly revoked** without resetting it everywhere it's used.

**Recommended: replace it with a scoped API token.**

1. Cloudflare dashboard → My Profile → API Tokens → *Create Token*.
2. Permissions: **Account › Cloudflare Pages › Edit** plus **Workers Scripts,
   D1 and Queues › Edit**, restricted to the Seomarketer2011 account only.
3. Store it as `CLOUDFLARE_API_TOKEN` (never in the repo).
4. Wrangler picks it up automatically; you can then unset the global key.

This limits blast radius to one account instead of everything.

## Offline demo (unrelated to the live site)

`npm run demo` renders a mock-data heatmap to `web/index.html` locally. Don't
deploy that output over the live dashboard — the deployed `web/index.html` is
the real app.
