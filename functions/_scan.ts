/**
 * Shared scan logic used by the on-demand API (batched from the client), the
 * legacy single-shot /api/scan, and the weekly cron Worker.
 *
 * Collection uses Google **local_finder** (the expanded local pack / "more
 * places") rather than the Maps app view — the Maps endpoint truncates to a
 * couple of results for service-area businesses, while local_finder returns the
 * full ranked list a searcher actually competes in.
 */

import {
  generateSquareGrid, observeRank, parseMapsItems, scoreScan, b64, visibilityWeight,
  type ScoredPoint, type SerpBusiness, type Observation,
} from "./_core";
import { targetId, randomId, upsertTarget, insertScan, type DBEnv } from "./_db";

const ENDPOINT = "https://api.dataforseo.com/v3/serp/google/local_finder/live/advanced";

export interface ScanInput {
  name: string; placeId?: string | null; cid?: string | null; website?: string | null; phone?: string | null;
  lat: number; lng: number; keyword: string;
  gridSize?: number; spacingM?: number; device?: string; languageCode?: string; depth?: number;
}

export interface GridPointLite { lat: number; lng: number; row: number; col: number; distanceM: number; bearingDeg: number }

export interface ScannedPoint extends GridPointLite {
  observation: Observation;
  error: boolean;
  top: { position: number; name: string; placeId?: string; cid?: string }[];
  results: SerpBusiness[]; // full list, used for scoring (not returned to client)
  retried?: boolean;
  confidence?: "high" | "medium" | "low";
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

interface Target { name: string; placeId?: string; cid?: string; website?: string; phone?: string }

/** Collect a set of grid points concurrently. Reusable by batch + full scan. */
export async function collectPoints(
  creds: { login: string; password: string },
  params: { keyword: string; device: string; languageCode: string; depth: number; target: Target },
  points: GridPointLite[],
  concurrency = 24,
): Promise<ScannedPoint[]> {
  const auth = `Basic ${b64(`${creds.login}:${creds.password}`)}`;
  const fetchPoint = async (p: GridPointLite) => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: params.keyword, location_coordinate: `${p.lat},${p.lng},15z`, language_code: params.languageCode, device: params.device, depth: params.depth }]),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return parseMapsItems(await res.json(), params.depth);
  };
  const one = async (p: GridPointLite): Promise<ScannedPoint> => {
    // Up to 3 attempts per pin — a transient failure must not become a data hole.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const results = await fetchPoint(p);
        return {
          ...p, observation: observeRank(params.target, results), error: false,
          // Keep top 10 so competitor standings are computed from real depth.
          top: results.slice(0, 10).map((r) => ({ position: r.position, name: r.name, placeId: r.placeId, cid: r.cid })),
          results,
        };
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    return { ...p, observation: observeRank(params.target, []), error: true, top: [], results: [] };
  };
  const out: ScannedPoint[] = new Array(points.length);
  let cursor = 0;
  const worker = async () => { while (cursor < points.length) { const i = cursor++; out[i] = await one(points[i]!); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, points.length || 1) }, worker));
  return out;
}

export function buildGrid(input: { lat: number; lng: number; gridSize?: number; spacingM?: number }): GridPointLite[] {
  const gridSize = clampOdd(Number(input.gridSize) || 7, 3, 15);
  const spacingM = Math.min(Math.max(Number(input.spacingM) || 500, 50), 3000);
  return generateSquareGrid({ lat: input.lat, lng: input.lng }, gridSize, spacingM);
}

export function toTarget(input: ScanInput): Target {
  return { name: String(input.name).trim(), placeId: input.placeId ?? undefined, cid: input.cid ?? undefined, website: input.website ?? undefined, phone: input.phone ?? undefined };
}

/**
 * Quality pass: re-collect suspicious pins once before scoring.
 *
 * A pin is suspicious if it errored, or its visibility is far below the median
 * of its adjacent grid neighbours (the classic isolated "×" in a sea of green —
 * usually a collection glitch, not a real dead zone). The retry only replaces
 * the original when it agrees better with the neighbourhood; genuine dead
 * zones survive because their retry comes back just as bad. Bounded to ~15% of
 * the grid so a truly volatile keyword can't double the scan cost.
 */
export async function retryAnomalies(
  creds: { login: string; password: string },
  params: { keyword: string; device: string; languageCode: string; depth: number; target: Target },
  points: ScannedPoint[],
): Promise<{ points: ScannedPoint[]; retriedCount: number }> {
  const vis = (p: ScannedPoint) => visibilityWeight(p.observation.rank);
  const neighbourMedian = (p: ScannedPoint): number | null => {
    const vals = points
      .filter((q) => q !== p && Math.abs(q.row - p.row) <= 1 && Math.abs(q.col - p.col) <= 1 && !q.error)
      .map(vis).sort((a, b) => a - b);
    if (!vals.length) return null;
    const m = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[m]! : (vals[m - 1]! + vals[m]!) / 2;
  };

  const suspects = points
    .map((p, i) => ({ p, i, nm: neighbourMedian(p) }))
    .filter(({ p, nm }) => p.error || (nm !== null && nm - vis(p) >= 0.5));
  const cap = Math.max(3, Math.ceil(points.length * 0.15));
  const toRetry = suspects.slice(0, cap);
  if (!toRetry.length) return { points, retriedCount: 0 };

  const redone = await collectPoints(creds, params, toRetry.map(({ p }) => p), toRetry.length);
  const out = [...points];
  redone.forEach((fresh, k) => {
    const { p, i } = toRetry[k]!;
    if (p.error && !fresh.error) {
      out[i] = { ...fresh, retried: true, confidence: "medium" } as ScannedPoint;
    } else if (!fresh.error && visibilityWeight(fresh.observation.rank) > vis(p)) {
      out[i] = { ...fresh, retried: true, confidence: "medium" } as ScannedPoint; // first pass looked like a glitch
    } else {
      out[i] = { ...p, retried: true, confidence: "low" } as ScannedPoint; // retry agreed — original stands, flagged
    }
  });
  return { points: out, retriedCount: toRetry.length };
}

/** Assemble a full ScanOutput from already-collected points (batched client flow). */
export function buildScanOutput(input: ScanInput, scanned: ScannedPoint[]): ScanOutput {
  const scored: ScoredPoint[] = scanned.map((s) => ({
    distanceM: s.distanceM, bearingDeg: s.bearingDeg, observation: s.observation,
    results: (s.results && s.results.length ? s.results : (s.top ?? [])) as any,
  }));
  const score = scoreScan(scored, { placeId: input.placeId, cid: input.cid, website: input.website, name: input.name });
  const gridSize = clampOdd(Number(input.gridSize) || 7, 3, 15);
  const spacingM = Math.min(Math.max(Number(input.spacingM) || 500, 50), 3000);
  const points = scanned.map((s) => ({ lat: s.lat, lng: s.lng, row: s.row, col: s.col, distanceM: s.distanceM, bearingDeg: s.bearingDeg, observation: s.observation, error: s.error, top: s.top, retried: s.retried ?? false, confidence: s.confidence ?? "high" }));
  return {
    business: { name: String(input.name).trim(), placeId: input.placeId ?? null, website: input.website ?? null, location: { lat: input.lat, lng: input.lng } },
    keyword: String(input.keyword).trim(), device: input.device === "desktop" ? "desktop" : "mobile", gridSize, spacingM,
    dataSource: "live", estCostUsd: Math.round(scanned.length * 0.004 * 1000) / 1000, points, score,
  };
}

/** Single-shot full-grid scan (used by the cron Worker and legacy /api/scan). */
export async function runGridScan(creds: { login: string; password: string }, input: ScanInput, concurrency = 24): Promise<ScanOutput> {
  const grid = buildGrid(input);
  const params = {
    keyword: String(input.keyword).trim(), device: input.device === "desktop" ? "desktop" : "mobile",
    languageCode: String(input.languageCode ?? "en"), depth: Math.min(Math.max(Number(input.depth) || 20, 10), 100), target: toTarget(input),
  };
  const scanned = await collectPoints(creds, params, grid, concurrency);
  const { points } = await retryAnomalies(creds, params, scanned);
  return buildScanOutput(input, points);
}

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
