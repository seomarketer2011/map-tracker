/**
 * D1 helpers shared by the API Functions. Thin wrappers over prepared
 * statements — no ORM. Import extensionless (esbuild resolves the .ts).
 */

export interface DBEnv {
  DB: D1Database;
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL_TO?: string;
  /** Set to "off" to disable the water-pin filter (e.g. if OSM tiles are unreachable). */
  WATER_FILTER?: string;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable id for a tracked target: same business+keyword+device -> same id. */
export function targetId(key: string, keyword: string, device: string): string {
  return "t_" + fnv1a(`${key}|${keyword.toLowerCase().trim()}|${device}`);
}

function domainOf(u?: string | null): string {
  return (u ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
}

/** Identifies the *business* (across keywords): Place ID, else website, else name. */
export function businessKey(t: { place_id?: string | null; website?: string | null; name: string }): string {
  return (t.place_id && t.place_id.trim()) || domainOf(t.website) || t.name.toLowerCase().trim();
}

export function randomId(prefix: string): string {
  // crypto.randomUUID is available in the Workers runtime.
  return prefix + "_" + (globalThis.crypto?.randomUUID?.() ?? fnv1a(String(Math.random())));
}

export interface TargetRow {
  id: string; name: string; place_id: string | null; cid: string | null;
  website: string | null; phone: string | null; lat: number; lng: number;
  keyword: string; device: string; grid_size: number; spacing_m: number;
  language_code: string; auto_weekly: number; created_at: string;
}

export async function upsertTarget(env: DBEnv, t: Omit<TargetRow, "created_at">, nowIso: string): Promise<void> {
  const bkey = businessKey(t);
  await env.DB.prepare(
    `INSERT INTO targets (id,name,place_id,cid,website,phone,lat,lng,keyword,device,grid_size,spacing_m,language_code,auto_weekly,business_key,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, place_id=excluded.place_id, cid=excluded.cid,
       website=excluded.website, phone=excluded.phone, lat=excluded.lat, lng=excluded.lng,
       grid_size=excluded.grid_size, spacing_m=excluded.spacing_m, language_code=excluded.language_code,
       business_key=excluded.business_key`,
  ).bind(
    t.id, t.name, t.place_id, t.cid, t.website, t.phone, t.lat, t.lng, t.keyword, t.device,
    t.grid_size, t.spacing_m, t.language_code, t.auto_weekly, bkey, nowIso,
  ).run();
}

export interface ScanRow {
  id: string; target_id: string; ran_at: string; data_source: string;
  solv: number; pct_top3: number; pct_top10: number; pct_found: number;
  median_rank: number | null; max_radius_m: number; strongest: string | null;
  weakest: string | null; dominant_json: string | null; est_cost: number; points_json: string;
}

export async function insertScan(env: DBEnv, s: ScanRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scans (id,target_id,ran_at,data_source,solv,pct_top3,pct_top10,pct_found,median_rank,max_radius_m,strongest,weakest,dominant_json,est_cost,points_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    s.id, s.target_id, s.ran_at, s.data_source, s.solv, s.pct_top3, s.pct_top10, s.pct_found,
    s.median_rank, s.max_radius_m, s.strongest, s.weakest, s.dominant_json, s.est_cost, s.points_json,
  ).run();
}

export async function listTargets(env: DBEnv): Promise<any[]> {
  const { results } = await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM scans s WHERE s.target_id=t.id) AS scan_count,
            (SELECT MAX(ran_at) FROM scans s WHERE s.target_id=t.id) AS last_scan,
            (SELECT solv FROM scans s WHERE s.target_id=t.id ORDER BY ran_at DESC LIMIT 1) AS last_solv
     FROM targets t ORDER BY t.name`,
  ).all();
  return results ?? [];
}

export async function listScans(env: DBEnv, targetId: string): Promise<any[]> {
  const { results } = await env.DB.prepare(
    `SELECT id,ran_at,solv,pct_top3,pct_top10,pct_found,median_rank,strongest,weakest,dominant_json,est_cost
     FROM scans WHERE target_id=? ORDER BY ran_at DESC`,
  ).bind(targetId).all();
  return results ?? [];
}

export async function getScan(env: DBEnv, id: string): Promise<any | null> {
  return await env.DB.prepare(`SELECT * FROM scans WHERE id=?`).bind(id).first();
}

export async function getTarget(env: DBEnv, id: string): Promise<TargetRow | null> {
  return (await env.DB.prepare(`SELECT * FROM targets WHERE id=?`).bind(id).first()) as TargetRow | null;
}
