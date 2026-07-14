import { describe, expect, it } from "vitest";
import { bearingDegrees, destinationPoint, haversineMetres, offsetPoint, compassSector } from "../src/core/geo.js";

const LONDON = { lat: 51.507421, lng: -0.127684 };

describe("geo", () => {
  it("destinationPoint lands the requested distance away", () => {
    const p = destinationPoint(LONDON, 500, 90); // 500 m due east
    const d = haversineMetres(LONDON, p);
    expect(Math.abs(d - 500)).toBeLessThan(0.5);
  });

  it("offsetPoint east/north is geodesically consistent", () => {
    const p = offsetPoint(LONDON, 500, 0); // 500 m east
    expect(haversineMetres(LONDON, p)).toBeCloseTo(500, 0);
    expect(bearingDegrees(LONDON, p)).toBeCloseTo(90, 0);
    const q = offsetPoint(LONDON, 0, 500); // 500 m north
    const northBearing = bearingDegrees(LONDON, q);
    // Due north is 0°, but float error can wrap it to ~359.99°; compare mod 360.
    expect(Math.min(northBearing, 360 - northBearing)).toBeLessThan(0.5);
  });

  it("longitude spacing differs from latitude spacing at London's latitude", () => {
    // A naive +0.0045 deg lat/lng would NOT both be 500 m. Prove geodesy matters.
    const east = offsetPoint(LONDON, 500, 0);
    const north = offsetPoint(LONDON, 0, 500);
    const dLng = Math.abs(east.lng - LONDON.lng);
    const dLat = Math.abs(north.lat - LONDON.lat);
    // At ~51.5°N, a degree of longitude is far shorter than a degree of latitude,
    // so 500 m east needs a bigger longitude delta than 500 m north needs in lat.
    expect(dLng).toBeGreaterThan(dLat);
  });

  it("compass sectors", () => {
    expect(compassSector(0)).toBe("N");
    expect(compassSector(90)).toBe("E");
    expect(compassSector(180)).toBe("S");
    expect(compassSector(270)).toBe("W");
    expect(compassSector(45)).toBe("NE");
  });
});
