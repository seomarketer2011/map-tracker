/**
 * End-to-end demo — runs the whole pipeline offline with the mock provider and
 * writes a deployable heatmap site to ./web (and raw data to ./out).
 *
 *   npm run demo
 *
 * The scenario: an emergency plumber in central London, three competitors, two
 * keywords, mobile Maps, a 13×13 grid at 500 m spacing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { generateGrid } from "./core/grid.js";
import { runScan, type ScanResult } from "./core/scan.js";
import type { Business, Keyword } from "./core/types.js";
import { MockProvider, type MockWorld } from "./collect/mockProvider.js";
import { renderHeatmapHtml } from "./report/heatmap.js";
import { saveBundle } from "./store/jsonStore.js";

const ORIGIN = { lat: 51.507421, lng: -0.127684 }; // central London

const target: Business = {
  id: "biz_target",
  name: "Stone Emergency Plumbers",
  placeId: "PLACE_TARGET",
  cid: "1000000000000000001",
  website: "https://stoneplumbers.co.uk",
  phone: "020 7946 0000",
  address: "10 Strand, London",
  location: ORIGIN,
  primaryCategory: "Plumber",
};

const world: MockWorld = {
  businesses: [
    { name: target.name, placeId: "PLACE_TARGET", cid: target.cid, website: target.website, phone: target.phone, address: target.address, rating: 4.8, reviews: 210, lat: ORIGIN.lat, lng: ORIGIN.lng, strength: 0.95, reachM: 2200 },
    { name: "ABC Plumbing", placeId: "PLACE_ABC", website: "https://abcplumbing.co.uk", rating: 4.6, reviews: 480, lat: 51.5155, lng: -0.1410, strength: 1.0, reachM: 3200 },
    { name: "London Emergency Plumbers", placeId: "PLACE_LEP", website: "https://londonemergencyplumbers.co.uk", rating: 4.4, reviews: 150, lat: 51.5010, lng: -0.1150, strength: 0.9, reachM: 2600 },
    { name: "XYZ Heating", placeId: "PLACE_XYZ", website: "https://xyzheating.co.uk", rating: 4.2, reviews: 90, lat: 51.4990, lng: -0.1400, strength: 0.8, reachM: 2000 },
    { name: "Capital Drains & Plumbing", placeId: "PLACE_CAP", rating: 4.7, reviews: 320, lat: 51.5120, lng: -0.1180, strength: 0.85, reachM: 2400 },
  ],
};

const keywords: Keyword[] = [
  { id: "kw_emergency", phrase: "emergency plumber", languageCode: "en", countryCode: "GB" },
  { id: "kw_boiler", phrase: "boiler repair", languageCode: "en", countryCode: "GB" },
];

async function main(): Promise<void> {
  const provider = new MockProvider(world);
  const grid = generateGrid(
    { origin: ORIGIN, mode: "square", gridSize: 13, spacingM: 500 },
    { businessId: target.id, device: "mobile", surface: "maps" },
  );

  console.log(`Grid: ${grid.points.length} permanent points (13×13 @ 500 m), id=${grid.id}`);

  const scans: ScanResult[] = [];
  // Deterministic clock so demo output is reproducible.
  const clock = () => "2026-07-14T09:00:00.000Z";
  for (const kw of keywords) {
    const scan = await runScan(provider, grid, kw, target, { zoom: 15, depth: 20 }, clock);
    const s = scan.score;
    console.log(
      `  "${kw.phrase}": SoLV=${(s.shareOfLocalVoice * 100).toFixed(0)}% ` +
        `top3=${(s.pctTop3 * 100).toFixed(0)}% top10=${(s.pctTop10 * 100).toFixed(0)}% ` +
        `median=${s.medianRank ?? "—"} strong=${s.strongestDirection} weak=${s.weakestDirection} ` +
        `topRival=${s.dominantCompetitor?.name ?? "—"}`,
    );
    scans.push(scan);
  }

  const html = renderHeatmapHtml({
    business: { name: target.name, placeId: target.placeId, location: target.location },
    scans,
    generatedLabel: "demo · mock provider · 2026-07-14",
    dataSource: "preview",
  });

  await mkdir("web", { recursive: true });
  await writeFile("web/index.html", html, "utf8");
  await saveBundle("out/scan-bundle.json", { business: target, grid, scans, savedAt: clock() });

  console.log("\nWrote web/index.html (deployable heatmap) and out/scan-bundle.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
