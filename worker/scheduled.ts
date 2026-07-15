/**
 * Weekly auto-scan Worker.
 *
 * Cloudflare Pages Functions can't be cron-triggered, so scheduled scans run in
 * this standalone Worker, bound to the same D1 database. On each fire it:
 *   1. loads every target with auto_weekly = 1,
 *   2. reads that target's most recent scan (the baseline),
 *   3. runs a fresh scan and saves it,
 *   4. compares to the baseline and records an alert if visibility dropped
 *      meaningfully (and emails it, if a mail provider is configured).
 *
 * Deploy separately: `wrangler deploy` from ./worker (see worker/wrangler.toml).
 */

import { runGridScan, persistScan } from "../functions/_scan";
import { randomId, type DBEnv } from "../functions/_db";

interface Env extends DBEnv {
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
}

const SOLV_DROP_ALERT = 0.1; // 10 percentage points

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeekly(env));
  },
  // Allow manual triggering via GET for testing: /?run=1
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).searchParams.get("run") === "1") {
      const summary = await runWeekly(env);
      return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("map-tracker weekly scan worker");
  },
};

async function runWeekly(env: Env): Promise<{ scanned: number; alerts: number }> {
  const { results: targets } = await env.DB
    .prepare("SELECT * FROM targets WHERE auto_weekly = 1").all<any>();
  let scanned = 0, alerts = 0;

  for (const t of targets ?? []) {
    const baseline = await env.DB
      .prepare("SELECT solv, pct_top3 FROM scans WHERE target_id=? ORDER BY ran_at DESC LIMIT 1")
      .bind(t.id).first<any>();

    let out;
    try {
      out = await runGridScan(
        { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD },
        {
          name: t.name, placeId: t.place_id, cid: t.cid, website: t.website, phone: t.phone,
          lat: t.lat, lng: t.lng, keyword: t.keyword, gridSize: t.grid_size, spacingM: t.spacing_m,
          device: t.device, languageCode: t.language_code,
        },
      );
    } catch { continue; }

    await persistScan(env, out, {
      name: t.name, placeId: t.place_id, cid: t.cid, website: t.website, phone: t.phone,
      lat: t.lat, lng: t.lng, keyword: t.keyword, gridSize: t.grid_size, spacingM: t.spacing_m,
      device: t.device, languageCode: t.language_code,
    });
    scanned++;

    if (baseline && typeof baseline.solv === "number") {
      const drop = baseline.solv - out.score.shareOfLocalVoice;
      const fellOutOfPack = baseline.pct_top3 > 0 && out.score.pctTop3 === 0;
      if (drop >= SOLV_DROP_ALERT || fellOutOfPack) {
        const type = fellOutOfPack ? "fell_out_top3" : "solv_drop";
        const msg = fellOutOfPack
          ? `${t.name} ("${t.keyword}") no longer ranks in the local 3-pack anywhere on the grid.`
          : `${t.name} ("${t.keyword}") Share of Local Voice fell ${(drop * 100).toFixed(0)} pts to ${(out.score.shareOfLocalVoice * 100).toFixed(0)}%.`;
        await env.DB.prepare(
          "INSERT INTO alert_events (id,target_id,scan_id,type,message,acknowledged,created_at) VALUES (?,?,?,?,?,0,?)",
        ).bind(randomId("al"), t.id, null, type, msg, new Date().toISOString()).run();
        alerts++;
        await maybeEmail(env, msg);
      }
    }
  }
  return { scanned, alerts };
}

/** Send an alert email via Resend if configured; silently skip otherwise. */
async function maybeEmail(env: Env, message: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Rank Tracker <alerts@resend.dev>",
        to: [env.ALERT_EMAIL_TO],
        subject: "Local ranking alert",
        text: message,
      }),
    });
  } catch { /* best-effort */ }
}
