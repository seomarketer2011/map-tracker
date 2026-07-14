/**
 * Scoring layer.
 *
 * "Average position 7.2" hides the shape of performance. The commercially useful
 * output is a *weighted* picture: how much of the local map you own, where you
 * are strong and weak, and who beats you. This module turns per-point rank
 * observations into those metrics.
 */

import { compassSector } from "./geo.js";
import type { SerpBusiness } from "../collect/provider.js";
import type { RankObservation } from "./rank.js";

/** Share-of-Local-Voice weights: how much visibility each rank position earns. */
export function visibilityWeight(rank: number | null): number {
  if (rank === null) return 0;
  if (rank === 1) return 1.0;
  if (rank === 2) return 0.85;
  if (rank === 3) return 0.7;
  if (rank <= 5) return 0.5;
  if (rank <= 10) return 0.25;
  if (rank <= 20) return 0.08;
  return 0;
}

export interface ScoredPoint {
  distanceM: number;
  bearingDeg: number;
  observation: RankObservation;
  /** Full ordered result list at this point, for competitor analysis. */
  results: SerpBusiness[];
}

export interface CompetitorStanding {
  placeId?: string;
  name: string;
  appearances: number;
  wins: number; // times ranked #1 across the grid
  avgPosition: number;
}

export interface ScanScore {
  validPoints: number;
  /** Grid-wide Share of Local Voice, 0..1 (report as %). */
  shareOfLocalVoice: number;
  pctTop3: number;
  pctTop10: number;
  pctFound: number;
  medianRank: number | null;
  /** Furthest distance (m) at which the business still ranked in the top 10. */
  maxRankingRadiusM: number;
  strongestDirection: string | null;
  weakestDirection: string | null;
  dominantCompetitor: CompetitorStanding | null;
  competitors: CompetitorStanding[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function scoreScan(points: ScoredPoint[], targetPlaceId?: string): ScanScore {
  const valid = points.filter((p) => p.observation.checkedDepth > 0);
  const n = valid.length || 1;

  const visibilities = valid.map((p) => visibilityWeight(p.observation.rank));
  const shareOfLocalVoice = visibilities.reduce((a, b) => a + b, 0) / n;

  const foundRanks = valid.map((p) => p.observation.rank).filter((r): r is number => r !== null);
  const pctTop3 = valid.filter((p) => p.observation.inTop3).length / n;
  const pctTop10 = valid.filter((p) => p.observation.inTop10).length / n;
  const pctFound = foundRanks.length / n;

  const maxRankingRadiusM = valid
    .filter((p) => p.observation.inTop10)
    .reduce((max, p) => Math.max(max, p.distanceM), 0);

  // Strongest / weakest direction: average visibility per 8-point compass sector.
  const bySector = new Map<string, number[]>();
  for (const p of valid) {
    const sector = compassSector(p.bearingDeg);
    (bySector.get(sector) ?? bySector.set(sector, []).get(sector)!).push(visibilityWeight(p.observation.rank));
  }
  let strongestDirection: string | null = null;
  let weakestDirection: string | null = null;
  let bestAvg = -1;
  let worstAvg = Infinity;
  for (const [sector, vals] of bySector) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      strongestDirection = sector;
    }
    if (avg < worstAvg) {
      worstAvg = avg;
      weakestDirection = sector;
    }
  }

  const competitors = rankCompetitors(points, targetPlaceId);

  return {
    validPoints: valid.length,
    shareOfLocalVoice,
    pctTop3,
    pctTop10,
    pctFound,
    medianRank: median(foundRanks),
    maxRankingRadiusM,
    strongestDirection,
    weakestDirection,
    dominantCompetitor: competitors[0] ?? null,
    competitors,
  };
}

/** Who else shows up across the grid, and who wins where. */
export function rankCompetitors(points: ScoredPoint[], targetPlaceId?: string): CompetitorStanding[] {
  const agg = new Map<string, { name: string; placeId?: string; positions: number[]; wins: number }>();
  for (const p of points) {
    for (const r of p.results) {
      const key = r.placeId ?? r.name.toLowerCase();
      if (targetPlaceId && r.placeId === targetPlaceId) continue; // exclude the tracked business
      const entry = agg.get(key) ?? { name: r.name, placeId: r.placeId, positions: [], wins: 0 };
      entry.positions.push(r.position);
      if (r.position === 1) entry.wins++;
      agg.set(key, entry);
    }
  }
  return [...agg.values()]
    .map((e) => ({
      placeId: e.placeId,
      name: e.name,
      appearances: e.positions.length,
      wins: e.wins,
      avgPosition: e.positions.reduce((a, b) => a + b, 0) / e.positions.length,
    }))
    .sort((a, b) => b.wins - a.wins || b.appearances - a.appearances || a.avgPosition - b.avgPosition);
}
