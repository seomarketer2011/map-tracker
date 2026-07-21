/**
 * Land/water mask for grid pins.
 *
 * Every grid pin costs real money to search, and a pin in the sea, a river or
 * a lake can never rank a customer — so we classify each pin against OSM
 * raster tiles *before* any paid SERP collection and drop the water ones.
 *
 * How it works:
 *   1. Pick the highest zoom (≤15) whose unique tile set for the whole point
 *      set fits the tile budget, so tight grids get ~5 m/px precision and
 *      40 km grids degrade gracefully instead of exploding the subrequest
 *      count.
 *   2. Fetch each unique tile once and decode the PNG (tiny built-in decoder —
 *      the Workers runtime has no canvas).
 *   3. Sample a 5×5 pixel block around the pin; if ≥60% of the pixels are the
 *      OSM water fill colour, the pin is water.
 *
 * Fail-open by design: any fetch/decode problem classifies the pin as land, so
 * a tile outage can only cost a normal search — it can never silently punch
 * holes in a scan.
 */

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface WaterOptions {
  /** Cap on unique tile fetches; the zoom adapts to stay under it. */
  maxTiles?: number;
  concurrency?: number;
  /** Injectable for tests; must resolve to raw PNG bytes or null. */
  fetchTile?: (zoom: number, x: number, y: number) => Promise<Uint8Array | null>;
}

const TILE_SIZE = 256;
const MAX_ZOOM = 15;
const MIN_ZOOM = 6;

/** openstreetmap-carto renders all water (sea, rivers, lakes) as #aad3df. */
export function isWaterColor(r: number, g: number, b: number): boolean {
  return Math.abs(r - 170) <= 14 && Math.abs(g - 211) <= 14 && Math.abs(b - 223) <= 14;
}

/** Slippy-map tile containing a coordinate, plus the pixel within that tile. */
export function tileForPoint(lat: number, lng: number, zoom: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const xf = ((lng + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(xf)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(yf)));
  return {
    x,
    y,
    px: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xf - x) * TILE_SIZE))),
    py: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yf - y) * TILE_SIZE))),
  };
}

async function defaultFetchTile(zoom: number, x: number, y: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
      headers: { "User-Agent": "map-tracker/0.1 (grid water mask)", Accept: "image/png" },
      // Water doesn't move: let Cloudflare cache tiles hard so repeat scans of
      // the same area cost zero upstream fetches.
      cf: { cacheEverything: true, cacheTtl: 30 * 86400 },
    } as RequestInit);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** True at index i ⇢ points[i] sits on water. Unknown/unfetchable ⇒ land. */
export async function classifyWater(points: LatLngPoint[], opts: WaterOptions = {}): Promise<boolean[]> {
  if (!points.length) return [];
  const maxTiles = opts.maxTiles ?? 36;
  const fetchTile = opts.fetchTile ?? defaultFetchTile;

  let zoom = MIN_ZOOM;
  let keys: string[] = [];
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const set = new Set(points.map((p) => {
      const t = tileForPoint(p.lat, p.lng, z);
      return `${t.x}/${t.y}`;
    }));
    if (set.size <= maxTiles || z === MIN_ZOOM) {
      zoom = z;
      keys = [...set];
      break;
    }
  }

  const tiles = new Map<string, DecodedPng | null>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor++]!;
      const [x, y] = key.split("/").map(Number);
      let png: DecodedPng | null = null;
      try {
        const bytes = await fetchTile(zoom, x!, y!);
        if (bytes) png = await decodePng(bytes);
      } catch {
        png = null;
      }
      tiles.set(key, png);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, keys.length) }, worker));

  return points.map((p) => {
    const t = tileForPoint(p.lat, p.lng, zoom);
    const png = tiles.get(`${t.x}/${t.y}`);
    if (!png) return false;
    let water = 0;
    let total = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const sx = Math.min(png.width - 1, Math.max(0, t.px + dx));
        const sy = Math.min(png.height - 1, Math.max(0, t.py + dy));
        const rgb = png.pixel(sx, sy);
        if (!rgb) continue;
        total++;
        if (isWaterColor(rgb[0], rgb[1], rgb[2])) water++;
      }
    }
    return total > 0 && water / total >= 0.6;
  });
}

/** Partition points into searchable land pins and skipped water pins. */
export async function splitByWater<T extends LatLngPoint>(
  points: T[],
  opts?: WaterOptions,
): Promise<{ land: T[]; water: T[] }> {
  const flags = await classifyWater(points, opts);
  const land: T[] = [];
  const water: T[] = [];
  points.forEach((p, i) => (flags[i] ? water : land).push(p));
  return { land, water };
}

// --- minimal PNG decoder (enough for OSM raster tiles) ---

export interface DecodedPng {
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number] | null;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("not a PNG");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0, height = 0, bitDepth = 8, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const dataStart = pos + 8;
    if (type === "IHDR") {
      width = dv.getUint32(dataStart);
      height = dv.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      interlace = bytes[dataStart + 12]!;
    } else if (type === "PLTE") {
      palette = bytes.slice(dataStart, dataStart + len);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4; // skip CRC — we never re-encode, so don't verify
  }

  const channels = CHANNELS[colorType];
  if (!width || !height || !channels) throw new Error("unsupported PNG");
  if (interlace !== 0) throw new Error("interlaced PNG not supported");
  if (colorType === 3 ? ![1, 2, 4, 8].includes(bitDepth) : bitDepth !== 8) throw new Error("unsupported bit depth");
  if (colorType === 3 && !palette) throw new Error("palette PNG without PLTE");

  const compressed = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
  let off = 0;
  for (const c of idat) { compressed.set(c, off); off += c.length; }
  const raw = await inflate(compressed);

  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < height * (rowBytes + 1)) throw new Error("truncated PNG data");

  const px = new Uint8Array(height * rowBytes);
  let ip = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++]!;
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[ip++]!;
      const left = x >= bpp ? px[rowStart + x - bpp]! : 0;
      const up = y > 0 ? px[rowStart - rowBytes + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? px[rowStart - rowBytes + x - bpp]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + left; break;
        case 2: v = cur + up; break;
        case 3: v = cur + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          v = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      px[rowStart + x] = v & 0xff;
    }
  }

  const pixel = (x: number, y: number): [number, number, number] | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const rowStart = y * rowBytes;
    if (colorType === 3) {
      let idx: number;
      if (bitDepth === 8) {
        idx = px[rowStart + x]!;
      } else {
        const bitPos = x * bitDepth;
        const byte = px[rowStart + (bitPos >> 3)]!;
        idx = (byte >> (8 - bitDepth - (bitPos & 7))) & ((1 << bitDepth) - 1);
      }
      const o = idx * 3;
      if (!palette || o + 2 >= palette.length) return null;
      return [palette[o]!, palette[o + 1]!, palette[o + 2]!];
    }
    if (colorType === 2 || colorType === 6) {
      const o = rowStart + x * channels;
      return [px[o]!, px[o + 1]!, px[o + 2]!];
    }
    // greyscale (0) / grey+alpha (4)
    const g = px[rowStart + x * channels]!;
    return [g, g, g];
  };

  return { width, height, pixel };
}
