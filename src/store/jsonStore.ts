/**
 * Minimal JSON store — persists a scan bundle to disk so the demo runs with no
 * database. It mirrors the shape of the canonical PostgreSQL schema (see
 * schema.sql): businesses, keywords, grids, grid_points, scans, point_results,
 * result_businesses. Swap this for a Postgres/PostGIS repository in production;
 * nothing upstream depends on the storage implementation.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScanResult } from "../core/scan.js";
import type { Business, Grid } from "../core/types.js";

export interface StoredBundle {
  business: Business;
  grid: Grid;
  scans: ScanResult[];
  savedAt: string;
}

export async function saveBundle(path: string, bundle: StoredBundle): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(bundle, null, 2), "utf8");
}
