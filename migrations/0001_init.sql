-- D1 (SQLite) schema for scan history & comparison.
-- Apply: wrangler d1 execute map-tracker-db --remote --file migrations/0001_init.sql

-- A tracked target = one business + keyword + device. Grid config is fixed here
-- so every scan reuses identical coordinates (valid comparisons).
CREATE TABLE IF NOT EXISTS targets (
  id            TEXT PRIMARY KEY,          -- stable hash of place_id|keyword|device
  name          TEXT NOT NULL,
  place_id      TEXT,
  cid           TEXT,
  website       TEXT,
  phone         TEXT,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  keyword       TEXT NOT NULL,
  device        TEXT NOT NULL DEFAULT 'mobile',
  grid_size     INTEGER NOT NULL DEFAULT 7,
  spacing_m     INTEGER NOT NULL DEFAULT 500,
  language_code TEXT NOT NULL DEFAULT 'en',
  auto_weekly   INTEGER NOT NULL DEFAULT 1, -- 1 = include in scheduled weekly scan
  created_at    TEXT NOT NULL
);

-- One saved scan. Headline metrics are denormalised for fast history/trend
-- queries; the full per-pin detail is kept as JSON in points_json.
CREATE TABLE IF NOT EXISTS scans (
  id             TEXT PRIMARY KEY,
  target_id      TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  ran_at         TEXT NOT NULL,
  data_source    TEXT NOT NULL DEFAULT 'live',
  solv           REAL,
  pct_top3       REAL,
  pct_top10      REAL,
  pct_found      REAL,
  median_rank    REAL,
  max_radius_m   INTEGER,
  strongest      TEXT,
  weakest        TEXT,
  dominant_json  TEXT,   -- dominant competitor {name,wins,avgPosition}
  est_cost       REAL,
  points_json    TEXT NOT NULL   -- [{row,col,lat,lng,distanceM,bearingDeg,rank,bucket,...,top:[...]}]
);

CREATE INDEX IF NOT EXISTS idx_scans_target_time ON scans(target_id, ran_at DESC);
