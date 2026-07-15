/**
 * /api/alerts
 *   GET ?targetId=  -> alert events (all, or for one target)
 *   POST {id}       -> acknowledge an alert
 */

import { json } from "../_http";
import type { DBEnv } from "../_db";

export const onRequestGet: PagesFunction<DBEnv> = async ({ request, env }) => {
  const targetId = new URL(request.url).searchParams.get("targetId");
  const q = targetId
    ? env.DB.prepare("SELECT a.*, t.name FROM alert_events a JOIN targets t ON t.id=a.target_id WHERE a.target_id=? ORDER BY a.created_at DESC LIMIT 100").bind(targetId)
    : env.DB.prepare("SELECT a.*, t.name FROM alert_events a JOIN targets t ON t.id=a.target_id ORDER BY a.created_at DESC LIMIT 100");
  const { results } = await q.all();
  return json({ alerts: results ?? [] });
};

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!b.id) return json({ error: "id required" }, 400);
  await env.DB.prepare("UPDATE alert_events SET acknowledged=1 WHERE id=?").bind(b.id).run();
  return json({ acknowledged: b.id });
};
