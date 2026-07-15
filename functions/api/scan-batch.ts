/**
 * POST /api/scan-batch
 * Collect a slice of grid points (kept small so each request finishes well
 * inside the Function's time + subrequest budget). No persistence.
 * Body: { name, placeId?, cid?, website?, phone?, keyword, device?, languageCode?, depth?, points:[{lat,lng,row,col,distanceM,bearingDeg}] }
 */

import { json } from "../_http";
import { collectPoints, toTarget } from "../_scan";
import type { DBEnv } from "../_db";

const MAX_BATCH = 40; // stay under the free-tier 50-subrequest cap

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return json({ error: "Credentials not configured" }, 500);
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const points = Array.isArray(cfg.points) ? cfg.points : [];
  if (!points.length) return json({ error: "points[] required" }, 400);
  if (points.length > MAX_BATCH) return json({ error: `Batch too large (max ${MAX_BATCH})` }, 400);
  if (!String(cfg.keyword ?? "").trim() || !String(cfg.name ?? "").trim()) return json({ error: "name and keyword required" }, 400);

  const scanned = await collectPoints(
    { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD },
    {
      keyword: String(cfg.keyword).trim(),
      device: cfg.device === "desktop" ? "desktop" : "mobile",
      languageCode: String(cfg.languageCode ?? "en"),
      depth: Math.min(Math.max(Number(cfg.depth) || 20, 10), 100),
      target: toTarget(cfg),
    },
    points,
    MAX_BATCH, // fire the whole batch at once — batches also run in parallel client-side
  );
  // Strip the heavy full-results list; the client keeps observation + top 5.
  return json({ points: scanned.map(({ results, ...rest }) => rest) });
};
