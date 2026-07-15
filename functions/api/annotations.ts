/**
 * /api/annotations
 *   GET ?targetId=            -> list notes
 *   POST {targetId, at, text} -> add a note
 *   DELETE ?id=               -> remove a note
 */

import { json } from "../_http";
import { randomId, type DBEnv } from "../_db";

export const onRequestGet: PagesFunction<DBEnv> = async ({ request, env }) => {
  const targetId = new URL(request.url).searchParams.get("targetId");
  if (!targetId) return json({ error: "targetId required" }, 400);
  const { results } = await env.DB
    .prepare("SELECT id,at,text FROM annotations WHERE target_id=? ORDER BY at DESC").bind(targetId).all();
  return json({ annotations: results ?? [] });
};

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const targetId = String(b.targetId ?? ""), text = String(b.text ?? "").trim();
  const at = String(b.at ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!targetId || !text) return json({ error: "targetId and text required" }, 400);
  const id = randomId("note");
  await env.DB.prepare("INSERT INTO annotations (id,target_id,at,text,created_at) VALUES (?,?,?,?,?)")
    .bind(id, targetId, at, text, new Date().toISOString()).run();
  return json({ id, at, text });
};

export const onRequestDelete: PagesFunction<DBEnv> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  await env.DB.prepare("DELETE FROM annotations WHERE id=?").bind(id).run();
  return json({ deleted: id });
};
