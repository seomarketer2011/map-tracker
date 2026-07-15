/**
 * POST /api/scan-plan  { lat, lng, gridSize, spacingM }
 * Returns the geodesic grid coordinates. The client then scans them in batches.
 */

import { json } from "../_http";
import { buildGrid } from "../_scan";
import type { DBEnv } from "../_db";

export const onRequestPost: PagesFunction<DBEnv> = async ({ request }) => {
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const lat = Number(cfg.lat), lng = Number(cfg.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "numeric lat/lng required" }, 400);
  const points = buildGrid({ lat, lng, gridSize: cfg.gridSize, spacingM: cfg.spacingM });
  return json({ points, count: points.length, estCostUsd: Math.round(points.length * 0.004 * 1000) / 1000 });
};
