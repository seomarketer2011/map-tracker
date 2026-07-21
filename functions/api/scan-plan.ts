/**
 * POST /api/scan-plan  { lat, lng, gridSize, spacingM }
 * Returns the geodesic grid coordinates. The client then scans them in batches.
 */

import { json } from "../_http";
import { buildGrid } from "../_scan";
import { splitByWater } from "../_water";
import type { DBEnv } from "../_db";

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const lat = Number(cfg.lat), lng = Number(cfg.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: "numeric lat/lng required" }, 400);
  const grid = buildGrid({ lat, lng, gridSize: cfg.gridSize, spacingM: cfg.spacingM });
  // Water pins are excluded up front — the client should only ever scan land.
  const { land: points, water } = env.WATER_FILTER === "off"
    ? { land: grid, water: [] as typeof grid }
    : await splitByWater(grid);
  return json({
    points,
    count: points.length,
    skippedWaterPoints: water.length,
    estCostUsd: Math.round(points.length * 0.004 * 1000) / 1000,
  });
};
