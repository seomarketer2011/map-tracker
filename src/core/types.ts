/**
 * Shared domain types.
 *
 * These mirror the persistent schema in `schema.sql`. The TypeScript layer is
 * the source of truth for shape; PostgreSQL/PostGIS is the source of truth for
 * durability. Keep the two in sync when you change a field.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type Device = "mobile" | "desktop";

/** Which Google surface a scan measures. Never mix these in one ranking. */
export type SearchSurface =
  | "maps"
  | "search_local_pack";

/**
 * A business we care about — either the tracked GBP or a competitor.
 * Stable identifiers (placeId, cid) are what make matching reliable; the
 * softer fields (domain, phone, address) are fallbacks only.
 */
export interface Business {
  id: string;
  name: string;
  placeId?: string;
  cid?: string;
  website?: string;
  phone?: string;
  address?: string;
  location?: LatLng;
  primaryCategory?: string;
}

export interface Keyword {
  id: string;
  phrase: string;
  languageCode: string; // e.g. "en"
  countryCode: string; // ISO-3166-1 alpha-2, e.g. "GB"
}

export type GridMode = "square" | "radial";

export interface GridConfig {
  origin: LatLng;
  mode: GridMode;
  /** Square mode: number of points per side (must be odd so there is a true centre). */
  gridSize?: number;
  /** Square mode: metres between adjacent points. */
  spacingM?: number;
  /** Radial mode: concentric bands, each with its own spacing (progressive density). */
  rings?: Array<{ maxRadiusM: number; spacingM: number }>;
}

/**
 * A permanent measurement location. Once generated, a point's coordinates must
 * never drift — historical comparisons depend on scanning the *same* origins.
 */
export interface GridPoint {
  id: string;
  gridId: string;
  lat: number;
  lng: number;
  distanceM: number;
  bearingDeg: number;
  row: number | null;
  col: number | null;
}

export interface Grid {
  id: string;
  businessId: string;
  config: GridConfig;
  device: Device;
  surface: SearchSurface;
  points: GridPoint[];
}
