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

import { runGridScan, persistScan, collectPoints, buildScanOutput, toTarget } from "../functions/_scan";
import { randomId, type DBEnv } from "../functions/_db";
import { getJob, writeJobPoints, countJobPoints, readJobPoints, claimFinalize, completeJob, failJob } from "../functions/_jobs";

interface Env extends DBEnv {
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
}

interface ScanMessage { jobId: string; points: { idx: number; lat: number; lng: number; row: number; col: number; distanceM: number; bearingDeg: number }[] }

const SOLV_DROP_ALERT = 0.1; // 10 percentage points

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeekly(env));
  },

  // Queue consumer: each message is a batch of grid points for one job.
  async queue(batch: MessageBatch<ScanMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processBatch(env, msg.body);
        msg.ack();
      } catch (e: any) {
        // Retry transient failures; give up (and record why) after 3 attempts.
        if (msg.attempts >= 3) { await failJob(env, msg.body.jobId, e?.message ?? "batch error").catch(() => {}); msg.ack(); }
        else msg.retry();
      }
    }
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

/** Process one enqueued batch of points for a job, then finalize if it's the last. */
async function processBatch(env: Env, msg: ScanMessage): Promise<void> {
  const job = await getJob(env, msg.jobId);
  if (!job || job.status === "complete" || job.status === "failed") return; // nothing to do

  const target = toTarget({ name: job.name, placeId: job.place_id, cid: job.cid, website: job.website, phone: job.phone, lat: job.lat, lng: job.lng, keyword: job.keyword });
  const scanned = await collectPoints(
    { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD },
    { keyword: job.keyword, device: job.device, languageCode: job.language_code, depth: 20, target },
    msg.points,
    msg.points.length,
  );
  // Store each collected point (without the heavy full results list) at its index.
  await writeJobPoints(env, job.id, scanned.map((s, k) => {
    const { results, ...rest } = s;
    return { idx: msg.points[k]!.idx, data: rest };
  }));

  // If all points are in, one caller finalizes: score + persist the scan.
  const done = await countJobPoints(env, job.id);
  if (done >= job.total_points && await claimFinalize(env, job.id)) {
    const points = await readJobPoints(env, job.id);
    const input = {
      name: job.name, placeId: job.place_id, cid: job.cid, website: job.website, phone: job.phone,
      lat: job.lat, lng: job.lng, keyword: job.keyword, device: job.device, gridSize: job.grid_size,
      spacingM: job.spacing_m, languageCode: job.language_code,
    };
    const out = buildScanOutput(input, points as any);
    const scanId = await persistScan(env, out, input);
    await completeJob(env, job.id, scanId ?? "unsaved");
  }
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
