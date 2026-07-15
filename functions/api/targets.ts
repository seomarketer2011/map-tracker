/**
 * /api/targets
 *   GET                      -> list all tracked businesses (with scan counts)
 *   POST {target|targets[]}  -> upsert one or many (bulk CSV import), no scan
 *   DELETE ?id=              -> remove a target and its history
 */

import { json } from "../_http";
import { targetId, upsertTarget, listTargets, type DBEnv } from "../_db";

export const onRequestGet: PagesFunction<DBEnv> = async ({ env }) => {
  const rows = await listTargets(env);
  // Group tracked keywords under their business so a GBP appears once.
  const byBusiness = new Map<string, any>();
  for (const t of rows) {
    const bk = t.business_key || t.place_id || t.website || t.name;
    if (!byBusiness.has(bk)) {
      byBusiness.set(bk, {
        businessKey: bk, name: t.name, placeId: t.place_id, cid: t.cid, website: t.website,
        lat: t.lat, lng: t.lng, keywords: [],
      });
    }
    byBusiness.get(bk).keywords.push({
      id: t.id, keyword: t.keyword, device: t.device, gridSize: t.grid_size, spacingM: t.spacing_m,
      scanCount: t.scan_count, lastScan: t.last_scan, lastSolv: t.last_solv, autoWeekly: t.auto_weekly,
    });
  }
  const businesses = [...byBusiness.values()].map((b) => {
    b.keywords.sort((a: any, c: any) => a.keyword.localeCompare(c.keyword));
    return b;
  }).sort((a, b) => a.name.localeCompare(b.name));
  return json({ businesses, targets: rows });
};

export const onRequestPost: PagesFunction<DBEnv> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const rows: any[] = Array.isArray(body?.targets) ? body.targets : [body];
  const now = new Date().toISOString();
  const created: string[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    const lat = Number(r.lat), lng = Number(r.lng);
    const keyword = String(r.keyword ?? "").trim();
    const name = String(r.name ?? "").trim();
    if (!name || !keyword || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push(`Skipped "${name || "?"}": need name, keyword, lat, lng`);
      continue;
    }
    const id = targetId(r.placeId || name, keyword, r.device === "desktop" ? "desktop" : "mobile");
    try {
      await upsertTarget(env, {
        id, name, place_id: r.placeId ?? null, cid: r.cid ?? null, website: r.website ?? null,
        phone: r.phone ?? null, lat, lng, keyword, device: r.device === "desktop" ? "desktop" : "mobile",
        grid_size: Number(r.gridSize) || 7, spacing_m: Number(r.spacingM) || 500,
        language_code: r.languageCode ?? "en", auto_weekly: r.autoWeekly === false ? 0 : 1,
      }, now);
      created.push(id);
    } catch (e: any) { errors.push(`${name}: ${e?.message ?? "db error"}`); }
  }
  return json({ created, count: created.length, errors });
};

export const onRequestDelete: PagesFunction<DBEnv> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  await env.DB.prepare("DELETE FROM scans WHERE target_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM annotations WHERE target_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM alert_events WHERE target_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM targets WHERE id=?").bind(id).run();
  return json({ deleted: id });
};
