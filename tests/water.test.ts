import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { classifyWater, decodePng, isWaterColor, splitByWater, tileForPoint } from "../functions/_water";

// --- tiny PNG builders (CRCs left zeroed — the decoder ignores them) ---

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

const SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function ihdr(width: number, height: number, bitDepth: number, colorType: number): Uint8Array {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  d[8] = bitDepth; d[9] = colorType;
  return d;
}

/** 8-bit truecolor PNG, filter 0 on every row. */
function pngRGB(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  return concat(SIG, chunk("IHDR", ihdr(width, height, 8, 2)), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0)));
}

/** Palette PNG from explicit (already filtered=0) index rows. */
function pngPalette(width: number, height: number, bitDepth: number, palette: number[][], rows: number[][]): Uint8Array {
  const rowBytes = Math.ceil((width * bitDepth) / 8);
  const raw = new Uint8Array(height * (1 + rowBytes));
  let p = 0;
  for (const row of rows) {
    raw[p++] = 0;
    for (const byte of row) raw[p++] = byte;
  }
  const plte = new Uint8Array(palette.flat());
  return concat(SIG, chunk("IHDR", ihdr(width, height, bitDepth, 3)), chunk("PLTE", plte), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0)));
}

const WATER: [number, number, number] = [170, 211, 223];
const LAND: [number, number, number] = [242, 239, 233];

describe("tileForPoint", () => {
  it("maps the origin to the centre tile boundary", () => {
    const t = tileForPoint(0, 0, 1);
    expect(t).toMatchObject({ x: 1, y: 1, px: 0, py: 0 });
  });

  it("stays inside tile bounds at the map edges", () => {
    for (const [lat, lng] of [[85.06, 179.999], [-85.06, -180], [89, 200 - 360]]) {
      const t = tileForPoint(lat!, lng!, 15);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(2 ** 15);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(2 ** 15);
      expect(t.px).toBeGreaterThanOrEqual(0);
      expect(t.px).toBeLessThan(256);
      expect(t.py).toBeGreaterThanOrEqual(0);
      expect(t.py).toBeLessThan(256);
    }
  });
});

describe("isWaterColor", () => {
  it("matches the OSM water fill and rejects land colours", () => {
    expect(isWaterColor(...WATER)).toBe(true);
    expect(isWaterColor(175, 205, 218)).toBe(true); // slight anti-aliasing drift
    expect(isWaterColor(...LAND)).toBe(false); // land background
    expect(isWaterColor(200, 223, 194)).toBe(false); // park green
    expect(isWaterColor(255, 255, 255)).toBe(false);
  });
});

describe("decodePng", () => {
  it("decodes truecolor pixels", async () => {
    const png = await decodePng(pngRGB(2, 2, (x, y) => (x === 0 && y === 0 ? WATER : LAND)));
    expect(png.width).toBe(2);
    expect(png.height).toBe(2);
    expect(png.pixel(0, 0)).toEqual(WATER);
    expect(png.pixel(1, 1)).toEqual(LAND);
    expect(png.pixel(2, 0)).toBeNull();
  });

  it("decodes 8-bit and 4-bit palette images", async () => {
    const pal = [WATER, LAND];
    const p8 = await decodePng(pngPalette(2, 1, 8, pal, [[0, 1]]));
    expect(p8.pixel(0, 0)).toEqual(WATER);
    expect(p8.pixel(1, 0)).toEqual(LAND);
    // 4-bit: two indices packed into one byte, high nibble first
    const p4 = await decodePng(pngPalette(2, 1, 4, pal, [[0x01]]));
    expect(p4.pixel(0, 0)).toEqual(WATER);
    expect(p4.pixel(1, 0)).toEqual(LAND);
  });

  it("reverses Sub, Up and Paeth row filters", async () => {
    // Row 0: filter 1 (Sub) — second pixel stored as delta from the first.
    // Row 1: filter 2 (Up) — stored as delta from row 0.
    // Row 2: filter 4 (Paeth) — with left/up/upleft all known.
    const raw = Uint8Array.from([
      1, 10, 20, 30, 5, 5, 5, //  -> (10,20,30) (15,25,35)
      2, 1, 1, 1, 2, 2, 2, //     -> (11,21,31) (17,27,37)
      4, 1, 1, 1, 1, 1, 1, //     Paeth: pred = clamp of (left,up,upleft)
    ]);
    const bytes = concat(SIG, chunk("IHDR", ihdr(2, 3, 8, 2)), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0)));
    const png = await decodePng(bytes);
    expect(png.pixel(0, 0)).toEqual([10, 20, 30]);
    expect(png.pixel(1, 0)).toEqual([15, 25, 35]);
    expect(png.pixel(0, 1)).toEqual([11, 21, 31]);
    expect(png.pixel(1, 1)).toEqual([17, 27, 37]);
    // Paeth for (0,2): left=0, up=(11,21,31), upleft=0 -> predictor = up.
    expect(png.pixel(0, 2)).toEqual([12, 22, 32]);
    // Paeth for (1,2): p = left+up-upleft is closest to up -> up + 1.
    expect(png.pixel(1, 2)).toEqual([18, 28, 38]);
  });

  it("rejects non-PNG bytes", async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow();
  });
});

describe("classifyWater", () => {
  const point = { lat: 53.4, lng: -2.98 }; // Liverpool-ish; any coordinate works

  it("flags points on an all-water tile", async () => {
    const tile = pngRGB(256, 256, () => WATER);
    const fetched: number[] = [];
    const flags = await classifyWater([point], {
      fetchTile: async (z) => { fetched.push(z); return tile; },
    });
    expect(flags).toEqual([true]);
    expect(fetched).toEqual([15]); // one point -> one tile at max zoom
  });

  it("keeps points on an all-land tile", async () => {
    const tile = pngRGB(256, 256, () => LAND);
    expect(await classifyWater([point], { fetchTile: async () => tile })).toEqual([false]);
  });

  it("fails open to land when tiles cannot be fetched or decoded", async () => {
    expect(await classifyWater([point], { fetchTile: async () => null })).toEqual([false]);
    expect(await classifyWater([point], { fetchTile: async () => Uint8Array.from([9, 9, 9]) })).toEqual([false]);
    expect(await classifyWater([point], { fetchTile: async () => { throw new Error("boom"); } })).toEqual([false]);
  });

  it("splits a mixed tile by the sampled neighbourhood", async () => {
    const t = tileForPoint(point.lat, point.lng, 15);
    // Paint water only in the 5x5 block around this point's pixel.
    const tile = pngRGB(256, 256, (x, y) => (Math.abs(x - t.px) <= 2 && Math.abs(y - t.py) <= 2 ? WATER : LAND));
    const flags = await classifyWater([point], { fetchTile: async () => tile });
    expect(flags).toEqual([true]);
    // A point one tile-pixel-block away must read land.
    const shifted = { lat: point.lat + 0.01, lng: point.lng };
    expect(await classifyWater([shifted], { fetchTile: async () => tile })).toEqual([false]);
  });

  it("lowers the zoom until the tile budget fits", async () => {
    // Two points ~45 km apart would need distant tiles at z15.
    const points = [{ lat: 53.4, lng: -2.98 }, { lat: 53.4, lng: -2.3 }];
    const calls: { z: number; key: string }[] = [];
    const tile = pngRGB(256, 256, () => WATER);
    await classifyWater(points, {
      maxTiles: 1,
      fetchTile: async (z, x, y) => { calls.push({ z, key: `${x}/${y}` }); return tile; },
    });
    expect(calls.length).toBe(1);
    expect(new Set(calls.map((c) => c.z)).size).toBe(1); // one consistent zoom
    expect(calls[0]!.z).toBeLessThan(15);
  });

  it("returns an empty list for no points", async () => {
    expect(await classifyWater([])).toEqual([]);
  });
});

describe("splitByWater", () => {
  it("partitions points and preserves their payloads", async () => {
    const a = { lat: 53.4, lng: -2.98, row: 0, col: 0 };
    const t = tileForPoint(a.lat, a.lng, 15);
    const tile = pngRGB(256, 256, (x, y) => (Math.abs(x - t.px) <= 2 && Math.abs(y - t.py) <= 2 ? WATER : LAND));
    const b = { lat: a.lat + 0.01, lng: a.lng, row: 0, col: 1 };
    const { land, water } = await splitByWater([a, b], { fetchTile: async () => tile });
    expect(water).toEqual([a]);
    expect(land).toEqual([b]);
  });
});
