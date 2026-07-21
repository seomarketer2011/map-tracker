/**
 * POST /api/scan
 *
 * Runs a live grid scan for one business + one keyword via DataForSEO Maps and
 * saves it to history (unless save:false). Body:
 *   { name, placeId?, cid?, website?, phone?, lat, lng, keyword,
 *     gridSize?=7, spacingM?=500, device?='mobile', languageCode?='en', save?=true }
 *
 * gridSize is capped so the whole grid finishes inside the Function's time and
 * subrequest budget. Bigger grids belong in an async job (see docs/NEXT-STEPS.md).
 */

import { json } from "../_http";
import { runGridScan, persistScan, type DBEnv } from "../_scan";
import { targetId as makeTargetId } from "../_db";

const MAX_POINTS = 60; // free-tier subrequest safety cap

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    return json({ error: "Collection credentials not configured on the server." }, 500);
  }
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const lat = Number(cfg.lat), lng = Number(cfg.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !String(cfg.keyword ?? "").trim() || !String(cfg.name ?? "").trim()) {
    return json({ error: "Need name, keyword and numeric lat/lng" }, 400);
  }
  const gridSize = Math.min(Math.max(Math.round(Number(cfg.gridSize) || 7), 3), 9);
  if (gridSize * gridSize > MAX_POINTS) {
    return json({ error: `Grid too large (${gridSize * gridSize} points). Max ${MAX_POINTS} for live scan.` }, 400);
  }

  let out;
  try {
    out = await runGridScan(
      { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD },
      { ...cfg, lat, lng },
      24,
      { waterFilter: env.WATER_FILTER !== "off" },
    );
  } catch (e: any) {
    if (String(e?.message ?? "").includes("water")) return json({ error: e.message }, 400);
    throw e;
  }

  let scanId: string | null = null;
  let targetId: string | null = null;
  if (cfg.save !== false) {
    scanId = await persistScan(env, out, { ...cfg, lat, lng });
    targetId = makeTargetId(cfg.placeId || out.business.name, out.keyword, out.device);
  }

  return json({ ...out, scanId, targetId });
};
