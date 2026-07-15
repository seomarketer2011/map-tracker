/**
 * GET /api/history?targetId=  -> scan history (metrics only, newest first)
 *                                + annotations for the timeline.
 */

import { json } from "../_http";
import { listScans, getTarget, type DBEnv } from "../_db";

export const onRequestGet: PagesFunction<DBEnv> = async ({ request, env }) => {
  const targetId = new URL(request.url).searchParams.get("targetId");
  if (!targetId) return json({ error: "targetId required" }, 400);
  const target = await getTarget(env, targetId);
  if (!target) return json({ error: "target not found" }, 404);
  const scans = await listScans(env, targetId);
  const { results: annotations } = await env.DB
    .prepare("SELECT id,at,text FROM annotations WHERE target_id=? ORDER BY at").bind(targetId).all();
  return json({ target, scans, annotations: annotations ?? [] });
};
