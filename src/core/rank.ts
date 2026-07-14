/**
 * Rank extraction — turn "we matched (or didn't) at depth N" into the several
 * distinct concepts of rank the product needs. A single integer is not enough.
 */

import type { SerpBusiness } from "../collect/provider.js";
import { matchTarget, type MatchMethod } from "./match.js";
import type { Business } from "./types.js";

export type RankBucket = "1-3" | "4-10" | "11-20" | "20+" | null;

export interface RankObservation {
  /** Position in the Maps list, or null if not found within checkedDepth. */
  rank: number | null;
  /** How far we actually looked. Critical context for a null rank. */
  checkedDepth: number;
  inTop3: boolean;
  inTop10: boolean;
  bucket: RankBucket;
  matchMethod: MatchMethod;
}

export function bucketFor(rank: number | null): RankBucket {
  if (rank === null) return "20+";
  if (rank <= 3) return "1-3";
  if (rank <= 10) return "4-10";
  if (rank <= 20) return "11-20";
  return "20+";
}

/**
 * Build a rank observation for `target` from one collected result list.
 *
 * `checkedDepth` is how deep the list actually went (not the requested depth —
 * the provider may return fewer). A null rank means "looked this deep, not
 * found" — never store it as rank = depth+1.
 */
export function observeRank(target: Business, results: SerpBusiness[]): RankObservation {
  const checkedDepth = results.length;
  const { business, method } = matchTarget(target, results);
  const rank = business ? business.position : null;
  return {
    rank,
    checkedDepth,
    inTop3: rank !== null && rank <= 3,
    inTop10: rank !== null && rank <= 10,
    bucket: bucketFor(rank),
    matchMethod: method,
  };
}
