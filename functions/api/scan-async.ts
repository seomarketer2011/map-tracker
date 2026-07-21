/**
 * POST /api/scan-async
 * Queue-backed scan: plans the grid, creates a job per keyword, enqueues the
 * points in batches, and returns immediately. Processing + saving happen in the
 * consumer Worker, so the browser can close mid-scan.
 * Body: { name, placeId?, cid?, website?, phone?, lat, lng, keywords:[..]|keyword, gridSize, spacingM, device?, languageCode? }
 */

import { json } from "../_http";
import { buildGrid } from "../_scan";
import { splitByWater } from "../_water";
import { createJob, type QueueEnv } from "../_jobs";

const BATCH = 40;

export const onRequestPost: PagesFunction<QueueEnv> = async ({ request, env }) => {
  if (!env.SCAN_QUEUE) return json({ error: "Queue not configured" }, 500);
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const lat = Number(cfg.lat), lng = Number(cfg.lng);
  const keywords: string[] = (Array.isArray(cfg.keywords) ? cfg.keywords : [cfg.keyword])
    .map((k: any) => String(k ?? "").trim()).filter(Boolean);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !String(cfg.name ?? "").trim() || !keywords.length) {
    return json({ error: "Need name, keyword(s) and numeric lat/lng" }, 400);
  }
  const device = cfg.device === "desktop" ? "desktop" : "mobile";
  const languageCode = String(cfg.languageCode ?? "en");
  const fullGrid = buildGrid({ lat, lng, gridSize: cfg.gridSize, spacingM: cfg.spacingM });
  const gridSize = Math.round(Math.sqrt(fullGrid.length)); // square
  // Drop pins that land on water before anything is enqueued — searches there
  // cost money and can never contain a customer.
  const { land: grid, water } = env.WATER_FILTER === "off"
    ? { land: fullGrid, water: [] as typeof fullGrid }
    : await splitByWater(fullGrid);
  if (!grid.length) return json({ error: "Every grid point falls on water — move the pin or shrink the grid/spacing." }, 400);
  const spacingM = Math.min(Math.max(Number(cfg.spacingM) || 500, 50), 3000);
  const now = new Date().toISOString();

  const jobs = [];
  for (const keyword of keywords) {
    const jobId = await createJob(env, {
      name: String(cfg.name).trim(), placeId: cfg.placeId, cid: cfg.cid, website: cfg.website, phone: cfg.phone,
      lat, lng, keyword, device, gridSize, spacingM, languageCode, totalPoints: grid.length,
    }, now);
    // Enqueue points in batches.
    const messages = [];
    for (let i = 0; i < grid.length; i += BATCH) {
      const slice = grid.slice(i, i + BATCH).map((p, k) => ({ idx: i + k, ...p }));
      messages.push({ body: { jobId, points: slice } });
    }
    // sendBatch caps at 100 messages; grids here produce far fewer.
    await env.SCAN_QUEUE.sendBatch(messages);
    jobs.push({ jobId, keyword, totalPoints: grid.length });
  }
  return json({
    jobs,
    skippedWaterPoints: water.length,
    estCostUsd: Math.round(grid.length * keywords.length * 0.004 * 1000) / 1000,
  });
};
