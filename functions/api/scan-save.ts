/**
 * POST /api/scan-save
 * Persist a scan assembled from batches. Computes the score server-side from the
 * supplied points and writes target + scan to D1.
 * Body: { name, placeId?, cid?, website?, phone?, lat, lng, keyword, device?, gridSize, spacingM, points:[scanned] }
 */

import { json } from "../_http";
import { buildScanOutput, persistScan } from "../_scan";
import { targetId as makeTargetId, type DBEnv } from "../_db";

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const pts = Array.isArray(cfg.points) ? cfg.points : [];
  if (!pts.length || !String(cfg.keyword ?? "").trim() || !String(cfg.name ?? "").trim()) {
    return json({ error: "name, keyword and points[] required" }, 400);
  }
  const out = buildScanOutput(cfg, pts);
  const scanId = await persistScan(env, out, cfg);
  const tid = makeTargetId(cfg.placeId || out.business.name, out.keyword, out.device);
  return json({ scanId, targetId: tid, score: out.score, estCostUsd: out.estCostUsd, gridSize: out.gridSize });
};
