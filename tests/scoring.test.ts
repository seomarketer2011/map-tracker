import { describe, expect, it } from "vitest";
import { scoreScan, visibilityWeight, type ScoredPoint } from "../src/core/scoring.js";
import { bucketFor, observeRank } from "../src/core/rank.js";
import type { SerpBusiness } from "../src/collect/provider.js";
import type { Business } from "../src/core/types.js";

describe("rank", () => {
  it("buckets", () => {
    expect(bucketFor(1)).toBe("1-3");
    expect(bucketFor(7)).toBe("4-10");
    expect(bucketFor(15)).toBe("11-20");
    expect(bucketFor(null)).toBe("20+");
  });

  it("null rank when not found, not depth+1", () => {
    const results: SerpBusiness[] = [{ position: 1, name: "A", placeId: "X" }];
    const target: Business = { id: "t", name: "Target", placeId: "T" };
    const obs = observeRank(target, results);
    expect(obs.rank).toBeNull();
    expect(obs.checkedDepth).toBe(1);
    expect(obs.inTop10).toBe(false);
  });
});

describe("scoring", () => {
  it("visibility weight is monotonic non-increasing", () => {
    const ranks = [1, 2, 3, 4, 5, 10, 11, 20, 21];
    const weights = ranks.map(visibilityWeight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeLessThanOrEqual(weights[i - 1]!);
    }
    expect(visibilityWeight(null)).toBe(0);
  });

  it("all-rank-1 grid scores SoLV = 1", () => {
    const points: ScoredPoint[] = Array.from({ length: 9 }, (_, i) => ({
      distanceM: i * 100,
      bearingDeg: (i * 40) % 360,
      observation: { rank: 1, checkedDepth: 20, inTop3: true, inTop10: true, bucket: "1-3", matchMethod: "place_id" },
      results: [{ position: 1, name: "Target", placeId: "T" }],
    }));
    const score = scoreScan(points, "T");
    expect(score.shareOfLocalVoice).toBeCloseTo(1, 5);
    expect(score.pctTop3).toBe(1);
  });

  it("identifies dominant competitor and excludes the target", () => {
    const mk = (targetRank: number | null, rivalPos: number): ScoredPoint => ({
      distanceM: 100,
      bearingDeg: 90,
      observation: {
        rank: targetRank,
        checkedDepth: 20,
        inTop3: targetRank !== null && targetRank <= 3,
        inTop10: targetRank !== null && targetRank <= 10,
        bucket: bucketFor(targetRank),
        matchMethod: targetRank ? "place_id" : "none",
      },
      results: [
        { position: 1, name: "Rival Co", placeId: "R" },
        { position: 2, name: "Target", placeId: "T" },
      ].map((r) => (r.placeId === "R" ? { ...r, position: rivalPos } : r)),
    });
    const score = scoreScan([mk(2, 1), mk(3, 1), mk(2, 1)], "T");
    expect(score.dominantCompetitor?.placeId).toBe("R");
    expect(score.dominantCompetitor?.name).toBe("Rival Co");
    // target must never appear in competitor standings
    expect(score.competitors.find((c) => c.placeId === "T")).toBeUndefined();
  });
});
