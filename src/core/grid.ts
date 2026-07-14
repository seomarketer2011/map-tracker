/**
 * Grid generation.
 *
 * Two shapes are supported:
 *
 *  - `square`  — the classic N×N scan (9×9, 13×13). Even coverage, easy to read
 *                as a heatmap, and cheap. Recommended for v1.
 *  - `radial`  — concentric rings with per-band spacing, so you can be dense
 *                near the business and sparse far out (progressive density).
 *                Gives most of the insight of a full fine grid at a fraction of
 *                the query cost.
 *
 * Every point stores its distance and bearing from the origin so the scoring
 * layer can reason about geography (strongest/weakest direction, max radius)
 * without recomputing.
 */

import { bearingDegrees, destinationPoint, haversineMetres, offsetPoint } from "./geo.js";
import { fnv1a } from "./ids.js";
import type { Grid, GridConfig, GridPoint } from "./types.js";

function gridIdFor(config: GridConfig, businessId: string, device: string, surface: string): string {
  const key = JSON.stringify({
    b: businessId,
    d: device,
    s: surface,
    o: [round6(config.origin.lat), round6(config.origin.lng)],
    m: config.mode,
    g: config.gridSize,
    sp: config.spacingM,
    r: config.rings,
  });
  return "grid_" + fnv1a(key);
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function makePoint(
  gridId: string,
  origin: { lat: number; lng: number },
  coord: { lat: number; lng: number },
  localId: string,
  row: number | null,
  col: number | null,
): GridPoint {
  return {
    id: `${gridId}:${localId}`,
    gridId,
    lat: round6(coord.lat),
    lng: round6(coord.lng),
    distanceM: Math.round(haversineMetres(origin, coord)),
    bearingDeg: Math.round(bearingDegrees(origin, coord) * 10) / 10,
    row,
    col,
  };
}

function generateSquare(gridId: string, config: GridConfig): GridPoint[] {
  const size = config.gridSize ?? 13;
  const spacing = config.spacingM ?? 500;
  if (size % 2 === 0) throw new Error(`Square grid size must be odd (got ${size}) so there is a true centre`);
  const half = (size - 1) / 2;
  const points: GridPoint[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // row 0 is the northernmost, so north offset decreases as row increases.
      const northM = (half - row) * spacing;
      const eastM = (col - half) * spacing;
      const coord = offsetPoint(config.origin, eastM, northM);
      points.push(makePoint(gridId, config.origin, coord, `r${row}c${col}`, row, col));
    }
  }
  return points;
}

function generateRadial(gridId: string, config: GridConfig): GridPoint[] {
  const rings = config.rings ?? [{ maxRadiusM: 1600, spacingM: 400 }];
  const points: GridPoint[] = [makePoint(gridId, config.origin, config.origin, "c", null, null)];
  const seen = new Set<string>(); // dedupe overlapping band coordinates
  let bandInner = 0;
  let index = 0;
  for (const ring of rings) {
    for (let radius = bandInner + ring.spacingM; radius <= ring.maxRadiusM; radius += ring.spacingM) {
      // Number of points on this circle scales with circumference / spacing.
      const count = Math.max(6, Math.round((2 * Math.PI * radius) / ring.spacingM));
      for (let k = 0; k < count; k++) {
        const bearing = (360 / count) * k;
        const coord = destinationPoint(config.origin, radius, bearing);
        const dedupeKey = `${round6(coord.lat)},${round6(coord.lng)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        points.push(makePoint(gridId, config.origin, coord, `p${index++}`, null, null));
      }
    }
    bandInner = ring.maxRadiusM;
  }
  return points;
}

/**
 * Build a permanent grid for a business. Deterministic: same config in →
 * identical grid id and point ids out.
 */
export function generateGrid(
  config: GridConfig,
  opts: { businessId: string; device: "mobile" | "desktop"; surface: "maps" | "search_local_pack" },
): Grid {
  const gridId = gridIdFor(config, opts.businessId, opts.device, opts.surface);
  const points = config.mode === "radial" ? generateRadial(gridId, config) : generateSquare(gridId, config);
  return {
    id: gridId,
    businessId: opts.businessId,
    config,
    device: opts.device,
    surface: opts.surface,
    points,
  };
}
