/**
 * Self-contained Worker port of the pure logic in src/core.
 *
 * Cloudflare Pages Functions are bundled with esbuild, which does not resolve
 * the project's ".js"-suffixed TypeScript imports. Rather than fight the
 * bundler, this file mirrors the tested logic in src/core (geodesy, grid,
 * matching, rank, scoring) with no external imports. Keep the formulas and
 * weights in sync with src/core — they are covered by the unit tests there.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface LatLng { lat: number; lng: number }

export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destinationPoint(origin: LatLng, distanceM: number, bearingDeg: number): LatLng {
  if (distanceM === 0) return { ...origin };
  const delta = distanceM / EARTH_RADIUS_M, theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat), lambda1 = toRad(origin.lng);
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * sinPhi2,
  );
  return { lat: toDeg(phi2), lng: (((toDeg(lambda2) + 540) % 360) - 180) };
}

function offsetPoint(origin: LatLng, eastM: number, northM: number): LatLng {
  const distanceM = Math.hypot(eastM, northM);
  if (distanceM === 0) return { ...origin };
  return destinationPoint(origin, distanceM, (toDeg(Math.atan2(eastM, northM)) + 360) % 360);
}

export function compassSector(bearingDeg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((bearingDeg % 360) / 45) % 8]!;
}

export interface GridPoint { lat: number; lng: number; distanceM: number; bearingDeg: number; row: number; col: number }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Square N×N grid placed by true ground distance. `size` must be odd. */
export function generateSquareGrid(origin: LatLng, size: number, spacingM: number): GridPoint[] {
  if (size % 2 === 0) throw new Error("gridSize must be odd");
  const half = (size - 1) / 2;
  const pts: GridPoint[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const coord = offsetPoint(origin, (col - half) * spacingM, (half - row) * spacingM);
      pts.push({
        lat: round6(coord.lat), lng: round6(coord.lng),
        distanceM: Math.round(haversineMetres(origin, coord)),
        bearingDeg: Math.round(bearingDegrees(origin, coord) * 10) / 10,
        row, col,
      });
    }
  }
  return pts;
}

// --- matching ---

export interface SerpBusiness {
  position: number; name: string; placeId?: string; cid?: string;
  website?: string; phone?: string; address?: string; rating?: number; reviews?: number;
  lat?: number; lng?: number;
}
export interface Target { name: string; placeId?: string; cid?: string; website?: string; phone?: string }

export function extractDomain(u?: string): string {
  if (!u) return "";
  return u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
}
export function normalizePhone(p?: string): string {
  let d = (p ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (d.startsWith("44") && d.length > 10) d = d.slice(2);
  return d.replace(/^0+/, "");
}
function normalizeName(n?: string): string {
  return (n ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\b(ltd|limited|llc|inc|the|co)\b/g, "").replace(/\s+/g, " ").trim();
}
function overlap(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean)), sb = new Set(b.split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let i = 0; for (const t of sa) if (sb.has(t)) i++;
  return i / (sa.size + sb.size - i);
}

export type MatchMethod = "place_id" | "cid" | "domain" | "phone" | "name_address" | "none";

export function matchTarget(t: Target, results: SerpBusiness[]): { business: SerpBusiness | null; method: MatchMethod } {
  if (t.placeId) { const h = results.find((r) => r.placeId && r.placeId === t.placeId); if (h) return { business: h, method: "place_id" }; }
  if (t.cid) { const h = results.find((r) => r.cid && r.cid === t.cid); if (h) return { business: h, method: "cid" }; }
  const dom = extractDomain(t.website);
  if (dom) { const h = results.find((r) => extractDomain(r.website) === dom); if (h) return { business: h, method: "domain" }; }
  const ph = normalizePhone(t.phone);
  if (ph.length >= 7) { const h = results.find((r) => normalizePhone(r.phone) === ph); if (h) return { business: h, method: "phone" }; }
  const tn = normalizeName(t.name);
  if (tn) {
    let best: SerpBusiness | null = null, score = 0;
    for (const r of results) { const s = overlap(tn, normalizeName(r.name)); if (s > score) { score = s; best = r; } }
    if (best && score >= 0.6) return { business: best, method: "name_address" };
  }
  return { business: null, method: "none" };
}

export type RankBucket = "1-3" | "4-10" | "11-20" | "20+";
export function bucketFor(rank: number | null): RankBucket {
  if (rank === null) return "20+";
  if (rank <= 3) return "1-3";
  if (rank <= 10) return "4-10";
  if (rank <= 20) return "11-20";
  return "20+";
}

export interface Observation { rank: number | null; checkedDepth: number; inTop3: boolean; inTop10: boolean; bucket: RankBucket; matchMethod: MatchMethod }
export function observeRank(t: Target, results: SerpBusiness[]): Observation {
  const { business, method } = matchTarget(t, results);
  const rank = business ? business.position : null;
  return { rank, checkedDepth: results.length, inTop3: rank !== null && rank <= 3, inTop10: rank !== null && rank <= 10, bucket: bucketFor(rank), matchMethod: method };
}

// --- scoring ---

export function visibilityWeight(rank: number | null): number {
  if (rank === null) return 0;
  if (rank === 1) return 1; if (rank === 2) return 0.85; if (rank === 3) return 0.7;
  if (rank <= 5) return 0.5; if (rank <= 10) return 0.25; if (rank <= 20) return 0.08;
  return 0;
}

export interface ScoredPoint { distanceM: number; bearingDeg: number; observation: Observation; results: SerpBusiness[] }
export interface Competitor { placeId?: string; name: string; appearances: number; wins: number; avgPosition: number }

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface TargetIdentity { placeId?: string | null; cid?: string | null; website?: string | null; name?: string | null }

/** True if a result row is the tracked business itself (any stable signal). */
export function isTarget(t: TargetIdentity, r: SerpBusiness): boolean {
  if (t.placeId && r.placeId && r.placeId === t.placeId) return true;
  if (t.cid && r.cid && r.cid === t.cid) return true;
  const td = extractDomain(t.website ?? undefined);
  if (td && extractDomain(r.website) === td) return true;
  const tn = normalizeName(t.name ?? undefined);
  if (tn && tn === normalizeName(r.name)) return true;
  return false;
}

export function scoreScan(points: ScoredPoint[], target?: TargetIdentity | string) {
  const tgt: TargetIdentity | undefined = typeof target === "string" ? { placeId: target } : target;
  const valid = points.filter((p) => p.observation.checkedDepth > 0);
  const n = valid.length || 1;
  const solv = valid.reduce((a, p) => a + visibilityWeight(p.observation.rank), 0) / n;
  const found = valid.map((p) => p.observation.rank).filter((r): r is number => r !== null);
  const maxRadius = valid.filter((p) => p.observation.inTop10).reduce((m, p) => Math.max(m, p.distanceM), 0);

  const bySector = new Map<string, number[]>();
  for (const p of valid) {
    const s = compassSector(p.bearingDeg);
    if (!bySector.has(s)) bySector.set(s, []);
    bySector.get(s)!.push(visibilityWeight(p.observation.rank));
  }
  let strong: string | null = null, weak: string | null = null, best = -1, worst = Infinity;
  for (const [s, vals] of bySector) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg > best) { best = avg; strong = s; }
    if (avg < worst) { worst = avg; weak = s; }
  }

  const agg = new Map<string, { name: string; placeId?: string; positions: number[]; wins: number }>();
  for (const p of points) for (const r of p.results) {
    if (tgt && isTarget(tgt, r)) continue;
    const key = r.placeId ?? r.cid ?? r.name.toLowerCase();
    const e = agg.get(key) ?? { name: r.name, placeId: r.placeId, positions: [], wins: 0 };
    e.positions.push(r.position); if (r.position === 1) e.wins++; agg.set(key, e);
  }
  const competitors: Competitor[] = [...agg.values()].map((e) => ({
    placeId: e.placeId, name: e.name, appearances: e.positions.length, wins: e.wins,
    avgPosition: e.positions.reduce((a, b) => a + b, 0) / e.positions.length,
  })).sort((a, b) => b.wins - a.wins || b.appearances - a.appearances || a.avgPosition - b.avgPosition);

  return {
    validPoints: valid.length,
    shareOfLocalVoice: solv,
    pctTop3: valid.filter((p) => p.observation.inTop3).length / n,
    pctTop10: valid.filter((p) => p.observation.inTop10).length / n,
    pctFound: found.length / n,
    medianRank: median(found),
    maxRankingRadiusM: maxRadius,
    strongestDirection: strong,
    weakestDirection: weak,
    dominantCompetitor: competitors[0] ?? null,
    competitors: competitors.slice(0, 8),
  };
}

// --- DataForSEO parsing (mirror of src/collect/dataForSeoProvider parseResults) ---

export function parseMapsItems(payload: any, depth: number): SerpBusiness[] {
  const task = payload?.tasks?.[0];
  if (task?.status_code && task.status_code >= 40000) throw new Error(`DataForSEO ${task.status_code}: ${task.status_message}`);
  const items = task?.result?.[0]?.items ?? [];
  const collected: SerpBusiness[] = [];
  for (const it of items) {
    if (it.is_paid) continue; // exclude local-pack ads — not organic rank
    const position = it.rank_absolute ?? it.rank_group;
    if (!position || !it.title) continue;
    collected.push({
      position, name: it.title, placeId: it.place_id ?? undefined, cid: it.cid,
      website: it.domain ?? it.url, phone: it.phone, address: it.address,
      rating: it.rating?.value, reviews: it.rating?.votes_count, lat: it.latitude, lng: it.longitude,
    });
  }
  // Renumber to clean, contiguous organic positions after removing ads.
  return collected
    .sort((a, b) => a.position - b.position)
    .slice(0, depth)
    .map((b, i) => ({ ...b, position: i + 1 }));
}

export function b64(s: string): string {
  // Worker-safe base64 (no Node Buffer).
  return typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s).toString("base64");
}
