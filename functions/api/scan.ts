/**
 * POST /api/scan
 *
 * Runs a live grid scan for one business + one keyword via DataForSEO Maps.
 * Body: { name, placeId?, cid?, website?, phone?, lat, lng, keyword,
 *         gridSize?=7, spacingM?=500, device?='mobile', languageCode?='en', depth?=20 }
 *
 * Each grid point is one Maps SERP call (~$0.002). Concurrency-limited so the
 * whole grid finishes inside the Function's time budget. To stay within the
 * free-tier subrequest cap, gridSize is limited here — larger grids belong in an
 * async job queue (see docs/NEXT-STEPS.md).
 */

import {
  generateSquareGrid, observeRank, parseMapsItems, scoreScan, b64,
  type ScoredPoint, type SerpBusiness,
} from "../_core";

interface Env {
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
}

const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";
const CONCURRENCY = 24;
const MAX_POINTS = 60; // free-tier subrequest safety cap

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    return json({ error: "Collection credentials not configured on the server." }, 500);
  }
  let cfg: any;
  try { cfg = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const lat = Number(cfg.lat), lng = Number(cfg.lng);
  const keyword = String(cfg.keyword ?? "").trim();
  const name = String(cfg.name ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !keyword || !name) {
    return json({ error: "Need name, keyword and numeric lat/lng" }, 400);
  }
  const gridSize = clampOdd(Number(cfg.gridSize) || 7, 3, 9);
  const spacingM = Math.min(Math.max(Number(cfg.spacingM) || 500, 100), 2000);
  const device = cfg.device === "desktop" ? "desktop" : "mobile";
  const languageCode = String(cfg.languageCode ?? "en");
  const depth = Math.min(Math.max(Number(cfg.depth) || 20, 10), 100);

  const grid = generateSquareGrid({ lat, lng }, gridSize, spacingM);
  if (grid.length > MAX_POINTS) {
    return json({ error: `Grid too large (${grid.length} points). Max ${MAX_POINTS} for live scan.` }, 400);
  }

  const target = { name, placeId: cfg.placeId, cid: cfg.cid, website: cfg.website, phone: cfg.phone };
  const auth = `Basic ${b64(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`;

  const collectPoint = async (p: (typeof grid)[number]): Promise<SerpBusiness[]> => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{
        keyword,
        location_coordinate: `${p.lat},${p.lng},15z`,
        language_code: languageCode,
        device,
        depth,
      }]),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return parseMapsItems(await res.json(), depth);
  };

  // Concurrency-limited pass over the grid.
  const scored: (ScoredPoint & { lat: number; lng: number; row: number; col: number; error?: boolean })[] = new Array(grid.length);
  let cursor = 0;
  async function worker() {
    while (cursor < grid.length) {
      const idx = cursor++;
      const p = grid[idx]!;
      try {
        const results = await collectPoint(p);
        scored[idx] = { lat: p.lat, lng: p.lng, row: p.row, col: p.col, distanceM: p.distanceM, bearingDeg: p.bearingDeg, observation: observeRank(target, results), results };
      } catch {
        scored[idx] = { lat: p.lat, lng: p.lng, row: p.row, col: p.col, distanceM: p.distanceM, bearingDeg: p.bearingDeg, observation: observeRank(target, []), results: [], error: true };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, grid.length) }, worker));

  const score = scoreScan(scored, cfg.placeId);

  // Trim per-point payload to top 5 for a lean response.
  const points = scored.map((s) => ({
    lat: s.lat, lng: s.lng, row: s.row, col: s.col, distanceM: s.distanceM, bearingDeg: s.bearingDeg,
    observation: s.observation,
    error: s.error ?? false,
    top: s.results.slice(0, 5).map((r) => ({ position: r.position, name: r.name, placeId: r.placeId })),
  }));

  return json({
    business: { name, placeId: cfg.placeId ?? null, website: cfg.website ?? null, location: { lat, lng } },
    keyword, device, gridSize, spacingM,
    dataSource: "live",
    estCostUsd: Math.round(grid.length * 0.002 * 1000) / 1000,
    points, score,
  });
};

function clampOdd(n: number, min: number, max: number): number {
  let v = Math.round(n);
  if (v % 2 === 0) v += 1;
  return Math.min(max, Math.max(min, v));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
