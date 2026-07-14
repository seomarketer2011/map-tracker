/**
 * Business matching — find the tracked GBP inside a SERP result list.
 *
 * Matching on the display name alone produces false "not ranking" results the
 * moment Google abbreviates or restyles a name. We match on the most stable
 * signal available, in strict priority order, and record *how* we matched so a
 * human can audit any surprising result.
 */

import type { SerpBusiness } from "../collect/provider.js";
import type { Business } from "./types.js";

export type MatchMethod =
  | "place_id"
  | "cid"
  | "domain"
  | "phone"
  | "name_address"
  | "none";

export interface MatchResult {
  business: SerpBusiness | null;
  method: MatchMethod;
}

/**
 * Reduce a phone number to a canonical national significant number so that
 * international and local forms of the same number compare equal, e.g.
 * "+44 (0)20 7946 0000", "020 7946 0000" and "+44 20 7946 0000" all → "2079460000".
 *
 * UK-centric (strips a leading 44 country code) — appropriate for this tool's
 * scope. For a multi-country product, swap in libphonenumber.
 */
export function normalizePhone(phone?: string): string {
  let d = (phone ?? "").replace(/\D/g, "");
  d = d.replace(/^00/, ""); // international access prefix
  if (d.startsWith("44") && d.length > 10) d = d.slice(2); // UK country code
  return d.replace(/^0+/, ""); // trunk zero(s), incl. the "(0)" form
}

export function normalizeName(name?: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\b(ltd|limited|llc|inc|the|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDomain(urlOrDomain?: string): string {
  if (!urlOrDomain) return "";
  let s = urlOrDomain.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0] ?? "";
  return s;
}

/** Loose token overlap for the name+address fallback (Jaccard). */
function tokenOverlap(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Locate `target` within `results`. Returns the first (best-ranked) matching
 * listing and the method used. Higher-priority methods win outright.
 */
export function matchTarget(target: Business, results: SerpBusiness[]): MatchResult {
  // 1. Place ID — the gold standard.
  if (target.placeId) {
    const hit = results.find((r) => r.placeId && r.placeId === target.placeId);
    if (hit) return { business: hit, method: "place_id" };
  }
  // 2. CID — stable listing identifier.
  if (target.cid) {
    const hit = results.find((r) => r.cid && r.cid === target.cid);
    if (hit) return { business: hit, method: "cid" };
  }
  // 3. Domain + close name (a domain match with an unrelated name is suspect).
  const targetDomain = extractDomain(target.website);
  if (targetDomain) {
    const hit = results.find((r) => extractDomain(r.website) === targetDomain);
    if (hit) return { business: hit, method: "domain" };
  }
  // 4. Normalised phone.
  const targetPhone = normalizePhone(target.phone);
  if (targetPhone.length >= 7) {
    const hit = results.find((r) => normalizePhone(r.phone) === targetPhone);
    if (hit) return { business: hit, method: "phone" };
  }
  // 5. Name + address token overlap — last resort, deliberately conservative.
  const tName = normalizeName(target.name);
  const tAddr = normalizeName(target.address);
  if (tName) {
    let best: SerpBusiness | null = null;
    let bestScore = 0;
    for (const r of results) {
      const nameSim = tokenOverlap(tName, normalizeName(r.name));
      const addrSim = tAddr ? tokenOverlap(tAddr, normalizeName(r.address)) : 0;
      const score = nameSim * 0.7 + addrSim * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best && bestScore >= 0.6) return { business: best, method: "name_address" };
  }
  return { business: null, method: "none" };
}
