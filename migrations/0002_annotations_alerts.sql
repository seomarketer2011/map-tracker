-- Timeline annotations + alert log.
-- Apply: wrangler d1 execute map-tracker-db --remote --file migrations/0002_annotations_alerts.sql

-- Notes pinned to a date so you can correlate actions ("added photos",
-- "changed category") with ranking movement on the trend chart.
CREATE TABLE IF NOT EXISTS annotations (
  id         TEXT PRIMARY KEY,
  target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,   -- ISO date the action happened
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_target ON annotations(target_id, at);

-- Fired when a scheduled scan detects a meaningful drop vs the previous scan.
CREATE TABLE IF NOT EXISTS alert_events (
  id         TEXT PRIMARY KEY,
  target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  scan_id    TEXT,
  type       TEXT NOT NULL,   -- solv_drop | fell_out_top3 | lost_ranking
  message    TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_events_target ON alert_events(target_id, created_at DESC);
