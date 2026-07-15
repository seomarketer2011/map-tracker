/**
 * D1 helpers for async scan jobs. Completion is derived by counting collected
 * points (job_points has PK (job_id, idx)), so Queue message retries can't
 * double-count and exactly one message finalizes the job.
 */

import { randomId, type DBEnv } from "./_db";

export interface JobRow {
  id: string; name: string; place_id: string | null; cid: string | null;
  website: string | null; phone: string | null; lat: number; lng: number;
  keyword: string; device: string; grid_size: number; spacing_m: number;
  language_code: string; total_points: number; status: string; scan_id: string | null;
  error: string | null; created_at: string; updated_at: string;
}

export interface QueueEnv extends DBEnv {
  SCAN_QUEUE: Queue;
}

export async function createJob(env: DBEnv, j: {
  name: string; placeId?: string | null; cid?: string | null; website?: string | null; phone?: string | null;
  lat: number; lng: number; keyword: string; device: string; gridSize: number; spacingM: number;
  languageCode: string; totalPoints: number;
}, nowIso: string): Promise<string> {
  const id = randomId("job");
  await env.DB.prepare(
    `INSERT INTO scan_jobs (id,name,place_id,cid,website,phone,lat,lng,keyword,device,grid_size,spacing_m,language_code,total_points,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'running',?,?)`,
  ).bind(id, j.name, j.placeId ?? null, j.cid ?? null, j.website ?? null, j.phone ?? null, j.lat, j.lng,
    j.keyword, j.device, j.gridSize, j.spacingM, j.languageCode, j.totalPoints, nowIso, nowIso).run();
  return id;
}

export async function getJob(env: DBEnv, id: string): Promise<JobRow | null> {
  return (await env.DB.prepare("SELECT * FROM scan_jobs WHERE id=?").bind(id).first()) as JobRow | null;
}

export async function writeJobPoints(env: DBEnv, jobId: string, points: { idx: number; data: any }[]): Promise<void> {
  const stmt = env.DB.prepare("INSERT OR REPLACE INTO job_points (job_id,idx,data) VALUES (?,?,?)");
  await env.DB.batch(points.map((p) => stmt.bind(jobId, p.idx, JSON.stringify(p.data))));
}

export async function countJobPoints(env: DBEnv, jobId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_points WHERE job_id=?").bind(jobId).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function readJobPoints(env: DBEnv, jobId: string): Promise<any[]> {
  const { results } = await env.DB.prepare("SELECT data FROM job_points WHERE job_id=? ORDER BY idx").bind(jobId).all<{ data: string }>();
  return (results ?? []).map((r) => JSON.parse(r.data));
}

/** Guarded finalize: returns true only for the single caller that flips status. */
export async function claimFinalize(env: DBEnv, jobId: string): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE scan_jobs SET status='finalizing', updated_at=? WHERE id=? AND status='running'")
    .bind(new Date().toISOString(), jobId).run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function completeJob(env: DBEnv, jobId: string, scanId: string): Promise<void> {
  await env.DB.prepare("UPDATE scan_jobs SET status='complete', scan_id=?, updated_at=? WHERE id=?")
    .bind(scanId, new Date().toISOString(), jobId).run();
  await env.DB.prepare("DELETE FROM job_points WHERE job_id=?").bind(jobId).run(); // free space
}

export async function failJob(env: DBEnv, jobId: string, err: string): Promise<void> {
  await env.DB.prepare("UPDATE scan_jobs SET status='failed', error=?, updated_at=? WHERE id=?")
    .bind(err.slice(0, 500), new Date().toISOString(), jobId).run();
}
