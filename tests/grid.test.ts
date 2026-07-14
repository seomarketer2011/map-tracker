import { describe, expect, it } from "vitest";
import { generateGrid } from "../src/core/grid.js";
import { haversineMetres } from "../src/core/geo.js";

const ORIGIN = { lat: 51.507421, lng: -0.127684 };
const opts = { businessId: "b1", device: "mobile", surface: "maps" } as const;

describe("grid", () => {
  it("13x13 square grid has 169 points with a true centre", () => {
    const g = generateGrid({ origin: ORIGIN, mode: "square", gridSize: 13, spacingM: 500 }, opts);
    expect(g.points).toHaveLength(169);
    const centre = g.points.find((p) => p.row === 6 && p.col === 6)!;
    expect(centre.distanceM).toBe(0);
  });

  it("rejects even grid sizes (no true centre)", () => {
    expect(() => generateGrid({ origin: ORIGIN, mode: "square", gridSize: 12, spacingM: 500 }, opts)).toThrow();
  });

  it("is deterministic: same config -> identical ids and coordinates", () => {
    const a = generateGrid({ origin: ORIGIN, mode: "square", gridSize: 9, spacingM: 400 }, opts);
    const b = generateGrid({ origin: ORIGIN, mode: "square", gridSize: 9, spacingM: 400 }, opts);
    expect(a.id).toBe(b.id);
    expect(a.points.map((p) => p.id)).toEqual(b.points.map((p) => p.id));
    expect(a.points.map((p) => [p.lat, p.lng])).toEqual(b.points.map((p) => [p.lat, p.lng]));
  });

  it("adjacent columns are ~spacing apart on the ground", () => {
    const g = generateGrid({ origin: ORIGIN, mode: "square", gridSize: 9, spacingM: 500 }, opts);
    const a = g.points.find((p) => p.row === 4 && p.col === 4)!;
    const b = g.points.find((p) => p.row === 4 && p.col === 5)!;
    expect(Math.abs(haversineMetres(a, b) - 500)).toBeLessThan(2);
  });

  it("radial grid is dense near centre and sparse far out", () => {
    const g = generateGrid(
      {
        origin: ORIGIN,
        mode: "radial",
        rings: [
          { maxRadiusM: 1000, spacingM: 400 },
          { maxRadiusM: 3000, spacingM: 800 },
        ],
      },
      opts,
    );
    expect(g.points.length).toBeGreaterThan(20);
    expect(g.points[0]!.distanceM).toBe(0); // centre point present
  });
});
