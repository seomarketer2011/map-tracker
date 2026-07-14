/**
 * Scan orchestration.
 *
 * For one (grid, keyword) pair, collect a SERP at every point, match the target,
 * and record rank. All points for a keyword are collected in one pass so the
 * heatmap reflects geography, not time drift.
 *
 * Anomaly retry: after the first pass, any point whose visibility is far worse
 * than its neighbours' median is re-collected once. Isolated "20+" pins in a
 * sea of top-3s are usually collection glitches, not real dead zones — this
 * catches them cheaply without paying to retry the whole grid.
 */

import type { MapsSerpProvider, SerpBusiness } from "../collect/provider.js";
import { haversineMetres } from "./geo.js";
import { observeRank, type RankObservation } from "./rank.js";
import { scoreScan, visibilityWeight, type ScanScore, type ScoredPoint } from "./scoring.js";
import type { Business, Grid, Keyword } from "./types.js";

export interface ScanOptions {
  zoom?: number;
  depth?: number;
  /** Retry points whose visibility trails the neighbour median by this much. */
  anomalyThreshold?: number;
  /** How many nearest neighbours define "local expectation". */
  neighbourCount?: number;
}

export interface PointResult {
  pointId: string;
  lat: number;
  lng: number;
  distanceM: number;
  bearingDeg: number;
  observation: RankObservation;
  results: SerpBusiness[];
  retried: boolean;
  confidence: "high" | "medium" | "low";
  collectedAt: string;
}

export interface ScanResult {
  gridId: string;
  keyword: Keyword;
  device: Grid["device"];
  surface: Grid["surface"];
  target: Business;
  points: PointResult[];
  score: ScanScore;
  startedAt: string;
  completedAt: string;
}

async function collectPoint(
  provider: MapsSerpProvider,
  grid: Grid,
  point: Grid["points"][number],
  keyword: Keyword,
  zoom: number,
  depth: number,
): Promise<SerpBusiness[]> {
  const res = await provider.collect({
    keyword: keyword.phrase,
    lat: point.lat,
    lng: point.lng,
    zoom,
    languageCode: keyword.languageCode,
    countryCode: keyword.countryCode,
    device: grid.device,
    depth,
  });
  return res.results;
}

export async function runScan(
  provider: MapsSerpProvider,
  grid: Grid,
  keyword: Keyword,
  target: Business,
  options: ScanOptions = {},
  now: () => string = () => new Date().toISOString(),
): Promise<ScanResult> {
  const zoom = options.zoom ?? 15;
  const depth = options.depth ?? 20;
  const anomalyThreshold = options.anomalyThreshold ?? 0.5;
  const neighbourCount = options.neighbourCount ?? 4;
  const startedAt = now();

  // Pass 1 — collect every point once.
  const points: PointResult[] = [];
  for (const gp of grid.points) {
    const results = await collectPoint(provider, grid, gp, keyword, zoom, depth);
    const observation = observeRank(target, results);
    points.push({
      pointId: gp.id,
      lat: gp.lat,
      lng: gp.lng,
      distanceM: gp.distanceM,
      bearingDeg: gp.bearingDeg,
      observation,
      results,
      retried: false,
      confidence: "high",
      collectedAt: now(),
    });
  }

  // Pass 2 — retry anomalies only.
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const neighbourMedianVis = neighbourMedianVisibility(points, i, neighbourCount);
    const vis = visibilityWeight(p.observation.rank);
    if (neighbourMedianVis !== null && neighbourMedianVis - vis >= anomalyThreshold) {
      const gp = grid.points.find((g) => g.id === p.pointId)!;
      const retryResults = await collectPoint(provider, grid, gp, keyword, zoom, depth);
      const retryObs = observeRank(target, retryResults);
      const retryVis = visibilityWeight(retryObs.rank);
      // Keep whichever agrees better with the neighbourhood (higher visibility
      // wins when the first pass looks like a glitch); flag as reduced confidence.
      if (retryVis > vis) {
        points[i] = { ...p, observation: retryObs, results: retryResults, retried: true, confidence: "medium" };
      } else {
        points[i] = { ...p, retried: true, confidence: "low" };
      }
    }
  }

  const scored: ScoredPoint[] = points.map((p) => ({
    distanceM: p.distanceM,
    bearingDeg: p.bearingDeg,
    observation: p.observation,
    results: p.results,
  }));
  const score = scoreScan(scored, target.placeId);

  return {
    gridId: grid.id,
    keyword,
    device: grid.device,
    surface: grid.surface,
    target,
    points,
    score,
    startedAt,
    completedAt: now(),
  };
}

function neighbourMedianVisibility(points: PointResult[], index: number, k: number): number | null {
  const self = points[index]!;
  const others = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== index)
    .map(({ p }) => ({ vis: visibilityWeight(p.observation.rank), d: haversineMetres(self, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  if (others.length === 0) return null;
  const vals = others.map((o) => o.vis).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
}
