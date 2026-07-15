-- Group tracked keywords under a single business so one GBP with several
-- keyword variations shows up once, not once per keyword.
-- Apply: wrangler d1 execute map-tracker-db --remote --file migrations/0003_business_group.sql

ALTER TABLE targets ADD COLUMN business_key TEXT;

-- Backfill: a business is identified by Place ID, else website, else name.
UPDATE targets SET business_key = COALESCE(NULLIF(place_id,''), NULLIF(website,''), name)
WHERE business_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_targets_business ON targets(business_key);
