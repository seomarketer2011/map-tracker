/**
 * Shared grid-scan runner used by both the on-demand API (/api/scan) and the
 * scheduled weekly Worker. Keeps the collection + scoring + persistence logic in
 * one place so manual and automatic scans are identical.
 */

import {
  generateSquareGrid, observeRank, parseMapsItems, scoreScan, b64,
  type ScoredPoint, type SerpBusiness,
} from "./_core";
import { targetId, randomId, upsertTarget, insertScan, type DBEnv } from "./_db";

const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";

export interface ScanInput {
  name: string; placeId?: string | null; cid?: string | null; website?: string | null; phone?: string | null;
  lat: number; lng: number; keyword: string;
  gridSize?: number; spacingM?: number; device?: string; languageCode?: string; depth?: number;
}

export interface ScanOutput {
  business: { name: string; placeId: string | null; website: string | null; location: { lat: number; lng: number } };
  keyword: string; device: string; gridSize: number; spacingM: number;
  dataSource: "live"; estCostUsd: number;
  points: any[]; score: ReturnType<typeof scoreScan>;
}

export function clampOdd(n: number, min: number, max: number): number {
  let v = Math.round(n); if (v % 2 === 0) v += 1; return Math.min(max, Math.max(min, v));
}

export async function runGridScan(
  creds: { login: string; password: string },
  input: ScanInput,
  concurrency = 24,
): Promise<ScanOutput> {
  const lat = Number(input.lat), lng = Number(input.lng);
  const keyword = String(input.keyword).trim();
  const name = String(input.name).trim();
  const gridSize = clampOdd(Number(input.gridSize) || 7, 3, 9);
  const spacingM = Math.min(Math.max(Number(input.spacingM) || 500, 100), 2000);
  const device = input.device === "desktop" ? "desktop" : "mobile";
  const languageCode = String(input.languageCode ?? "en");
  const depth = Math.min(Math.max(Number(input.depth) || 20, 10), 100);

  const grid = generateSquareGrid({ lat, lng }, gridSize, spacingM);
  const target = { name, placeId: input.placeId ?? undefined, cid: input.cid ?? undefined, website: input.website ?? undefined, phone: input.phone ?? undefined };
  const auth = `Basic ${b64(`${creds.login}:${creds.password}`)}`;

  const collect = async (p: (typeof grid)[number]): Promise<SerpBusiness[]> => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword, location_coordinate: `${p.lat},${p.lng},15z`, language_code: languageCode, device, depth }]),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return parseMapsItems(await res.json(), depth);
  };

  const scored: (ScoredPoint & { lat: number; lng: number; row: number; col: number; error?: boolean })[] = new Array(grid.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < grid.length) {
      const idx = cursor++; const p = grid[idx]!;
      try {
        const results = await collect(p);
        scored[idx] = { lat: p.lat, lng: p.lng, row: p.row, col: p.col, distanceM: p.distanceM, bearingDeg: p.bearingDeg, observation: observeRank(target, results), results };
      } catch {
        scored[idx] = { lat: p.lat, lng: p.lng, row: p.row, col: p.col, distanceM: p.distanceM, bearingDeg: p.bearingDeg, observation: observeRank(target, []), results: [], error: true };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, grid.length) }, worker));

  const score = scoreScan(scored, input.placeId ?? undefined);
  const points = scored.map((s) => ({
    lat: s.lat, lng: s.lng, row: s.row, col: s.col, distanceM: s.distanceM, bearingDeg: s.bearingDeg,
    observation: s.observation, error: s.error ?? false,
    top: s.results.slice(0, 5).map((r) => ({ position: r.position, name: r.name, placeId: r.placeId })),
  }));

  return {
    business: { name, placeId: input.placeId ?? null, website: input.website ?? null, location: { lat, lng } },
    keyword, device, gridSize, spacingM, dataSource: "live",
    estCostUsd: Math.round(grid.length * 0.002 * 1000) / 1000,
    points, score,
  };
}

/** Persist a scan result; returns the new scan id (or null on failure). */
export async function persistScan(env: DBEnv, out: ScanOutput, input: ScanInput): Promise<string | null> {
  if (!env.DB) return null;
  const tid = targetId(input.placeId || out.business.name, out.keyword, out.device);
  const ranAt = new Date().toISOString();
  const scanId = randomId("scan");
  try {
    await upsertTarget(env, {
      id: tid, name: out.business.name, place_id: input.placeId ?? null, cid: input.cid ?? null,
      website: input.website ?? null, phone: input.phone ?? null, lat: out.business.location.lat,
      lng: out.business.location.lng, keyword: out.keyword, device: out.device,
      grid_size: out.gridSize, spacing_m: out.spacingM, language_code: input.languageCode ?? "en", auto_weekly: 1,
    }, ranAt);
    await insertScan(env, {
      id: scanId, target_id: tid, ran_at: ranAt, data_source: "live",
      solv: out.score.shareOfLocalVoice, pct_top3: out.score.pctTop3, pct_top10: out.score.pctTop10,
      pct_found: out.score.pctFound, median_rank: out.score.medianRank, max_radius_m: out.score.maxRankingRadiusM,
      strongest: out.score.strongestDirection, weakest: out.score.weakestDirection,
      dominant_json: out.score.dominantCompetitor ? JSON.stringify(out.score.dominantCompetitor) : null,
      est_cost: out.estCostUsd, points_json: JSON.stringify(out.points),
    });
    return scanId;
  } catch { return null; }
}
