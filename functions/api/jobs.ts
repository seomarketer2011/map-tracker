/**
 * GET /api/jobs?ids=job_a,job_b   -> status + progress for each job.
 * Progress is derived from collected points so it reflects real work done.
 */

import { json } from "../_http";
import { getJob, countJobPoints, type DBEnv } from "../_jobs";

export const onRequestGet: PagesFunction<DBEnv> = async ({ request, env }) => {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return json({ error: "ids required" }, 400);
  const jobs = [];
  for (const id of ids.slice(0, 50)) {
    const j = await getJob(env, id);
    if (!j) { jobs.push({ id, status: "unknown" }); continue; }
    const done = j.status === "complete" ? j.total_points : await countJobPoints(env, id);
    jobs.push({
      id: j.id, keyword: j.keyword, status: j.status, scanId: j.scan_id, error: j.error,
      done, total: j.total_points,
    });
  }
  return json({ jobs });
};
