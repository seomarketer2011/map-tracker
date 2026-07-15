-- Async scan jobs. A scan is planned into points, enqueued as batches, and
-- processed by a Queue consumer Worker so the browser can close mid-scan.
-- Apply: wrangler d1 execute map-tracker-db --remote --file migrations/0004_jobs.sql

CREATE TABLE IF NOT EXISTS scan_jobs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  place_id      TEXT, cid TEXT, website TEXT, phone TEXT,
  lat REAL NOT NULL, lng REAL NOT NULL,
  keyword       TEXT NOT NULL,
  device        TEXT NOT NULL DEFAULT 'mobile',
  grid_size     INTEGER, spacing_m INTEGER, language_code TEXT DEFAULT 'en',
  total_points  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|complete|failed
  scan_id       TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Collected points, keyed by (job, index) so message retries are idempotent.
CREATE TABLE IF NOT EXISTS job_points (
  job_id  TEXT NOT NULL,
  idx     INTEGER NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (job_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status, created_at);
