# Deploying the heatmap viewer to Cloudflare Pages

The `web/` directory is a static site with no build step. It deploys to
Cloudflare Pages as-is.

## Current deployment

- **Project:** `map-tracker`
- **URL:** https://map-tracker.pages.dev/
- **Account:** `Seomarketer2011@yahoo.co.uk` (`44799b719f2192a9f066f425aaff3106`)

> Note: the environment's default `CLOUDFLARE_ACCOUNT_ID` points at a *different*
> account. Deploys must set the account explicitly (below) to land in the
> Seomarketer2011 account.

## Deploy command

```bash
npm run demo   # regenerate web/index.html
CLOUDFLARE_ACCOUNT_ID=44799b719f2192a9f066f425aaff3106 \
  npx wrangler pages deploy web --project-name map-tracker --branch main
```

## Credential safety — please read

Deployment currently works because a **Cloudflare Global API Key** is present in
the environment (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`). That key grants
**complete control of every account it can see** and **cannot be scoped or
cleanly revoked** without resetting it everywhere it's used.

**Recommended: replace it with a scoped API token.**

1. Cloudflare dashboard → My Profile → API Tokens → *Create Token*.
2. Permission: **Account › Cloudflare Pages › Edit**, restricted to the
   Seomarketer2011 account only.
3. Store it as `CLOUDFLARE_API_TOKEN` (never in the repo).
4. Wrangler picks it up automatically; you can then unset the global key.

This limits blast radius to Pages on one account instead of everything.

## Making the live site show *real* data

Today the deployed page renders the mock demo bundle. To publish a real scan:

1. Set `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`.
2. Swap `MockProvider` for `DataForSeoProvider` in a scan run (same interface).
3. `renderHeatmapHtml(...)` the result into `web/index.html`.
4. Redeploy with the command above.

For multi-business SaaS you'd instead build a small API + database (see
`docs/NEXT-STEPS.md`) rather than regenerating a single static page.
