-- Canonical persistent schema (PostgreSQL + PostGIS).
--
-- The runnable demo uses a JSON store (src/store/jsonStore.ts) so you can try the
-- pipeline with no database. This file is the production target: swap the JSON
-- store for a repository backed by these tables. Nothing in src/core depends on
-- the storage implementation.
--
--   CREATE EXTENSION IF NOT EXISTS postgis;

CREATE EXTENSION IF NOT EXISTS postgis;

-- Tracked businesses and competitors. Stable identifiers (place_id, cid) are
-- what make matching reliable; the soft fields are fallbacks only.
CREATE TABLE businesses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  place_id      text UNIQUE,
  cid           text,
  website       text,
  phone         text,
  address       text,
  location      geography(Point, 4326),
  primary_category text,
  is_competitor boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE keywords (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase        text NOT NULL,
  language_code text NOT NULL,     -- "en"
  country_code  text NOT NULL,     -- "GB"
  UNIQUE (phrase, language_code, country_code)
);

-- A grid is a permanent set of measurement origins for one business + device +
-- surface. Config is stored so the exact same points are reproducible.
CREATE TABLE grids (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  mode           text NOT NULL CHECK (mode IN ('square','radial')),
  radius_m       integer,
  spacing_m      integer,
  grid_size      integer,
  device         text NOT NULL CHECK (device IN ('mobile','desktop')),
  surface        text NOT NULL CHECK (surface IN ('maps','search_local_pack')),
  config_json    jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Permanent points. NEVER regenerate with drifted coordinates — historical
-- comparisons depend on scanning identical origins.
CREATE TABLE grid_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id       uuid NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  stable_key    text NOT NULL,            -- deterministic id (e.g. grid_x:r4c5)
  location      geography(Point, 4326) NOT NULL,
  distance_m    integer NOT NULL,
  bearing_deg   numeric(5,1) NOT NULL,
  row_number    integer,
  column_number integer,
  UNIQUE (grid_id, stable_key)
);

CREATE TABLE scans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id      uuid NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  keyword_id   uuid NOT NULL REFERENCES keywords(id),
  provider     text NOT NULL,
  zoom         integer NOT NULL DEFAULT 15,
  depth        integer NOT NULL DEFAULT 20,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','running','completed','failed')),
  started_at   timestamptz,
  completed_at timestamptz,
  -- Denormalised scoring snapshot for fast history/report queries.
  score_json   jsonb
);

CREATE TABLE point_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id        uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  grid_point_id  uuid NOT NULL REFERENCES grid_points(id),
  target_rank    integer,                 -- NULL = not found within checked_depth
  checked_depth  integer NOT NULL,
  in_top_3       boolean NOT NULL,
  in_top_10      boolean NOT NULL,
  rank_bucket    text,                    -- '1-3','4-10','11-20','20+'
  match_method   text,                    -- place_id | cid | domain | phone | name_address | none
  confidence     text NOT NULL DEFAULT 'high',
  retried        boolean NOT NULL DEFAULT false,
  raw_result_id  uuid,
  collected_at   timestamptz NOT NULL,
  UNIQUE (scan_id, grid_point_id)
);

-- The full ordered result list captured at each point, for competitor analysis
-- and auditing "why did our rank change".
CREATE TABLE result_businesses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_result_id uuid NOT NULL REFERENCES point_results(id) ON DELETE CASCADE,
  position        integer NOT NULL,
  place_id        text,
  cid             text,
  name            text NOT NULL,
  address         text,
  website         text,
  rating          numeric(2,1),
  review_count    integer,
  location        geography(Point, 4326)
);

-- Raw provider payloads / screenshots retained for re-parsing and audit.
CREATE TABLE raw_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  response_json jsonb,
  screenshot_url text,
  collected_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_grid_points_grid ON grid_points(grid_id);
CREATE INDEX idx_grid_points_geo ON grid_points USING gist(location);
CREATE INDEX idx_scans_grid_keyword ON scans(grid_id, keyword_id, completed_at DESC);
CREATE INDEX idx_point_results_scan ON point_results(scan_id);
CREATE INDEX idx_result_businesses_point ON result_businesses(point_result_id);
CREATE INDEX idx_result_businesses_place ON result_businesses(place_id);
