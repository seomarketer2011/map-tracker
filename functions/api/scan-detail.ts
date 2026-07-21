/**
 * GET    /api/scan-detail?id=  -> one saved scan with full per-pin points.
 *                                 Used by the comparison view (fetch two, diff by row/col).
 * DELETE /api/scan-detail?id=  -> remove a single scan from history.
 */

import { json } from "../_http";
import { getScan, getTarget, type DBEnv } from "../_db";

export const onRequestGet: PagesFunction<DBEnv> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  const row = await getScan(env, id);
  if (!row) return json({ error: "scan not found" }, 404);
  const t = await getTarget(env, row.target_id);
  return json({
    id: row.id, targetId: row.target_id, ranAt: row.ran_at,
    // Per-scan grid config; older scans predate the columns, so fall back to
    // the target's current settings.
    gridSize: row.grid_size ?? t?.grid_size ?? null,
    spacingM: row.spacing_m ?? t?.spacing_m ?? null,
    target: t ? { name: t.name, keyword: t.keyword, device: t.device } : null,
    score: {
      shareOfLocalVoice: row.solv, pctTop3: row.pct_top3, pctTop10: row.pct_top10,
      pctFound: row.pct_found, medianRank: row.median_rank, maxRankingRadiusM: row.max_radius_m,
      strongestDirection: row.strongest, weakestDirection: row.weakest,
      dominantCompetitor: row.dominant_json ? JSON.parse(row.dominant_json) : null,
    },
    points: JSON.parse(row.points_json),
  });
};

export const onRequestDelete: PagesFunction<DBEnv> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  const r = await env.DB.prepare("DELETE FROM scans WHERE id=?").bind(id).run();
  return json({ deleted: id, found: (r.meta?.changes ?? 0) > 0 });
};
