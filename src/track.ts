/**
 * Single-listing tracker — track ONE Google Business Profile for ONE keyword.
 *
 *   npm run track                 # uses ./track.config.json
 *   npm run track -- path/to.json # custom config
 *
 * Data source is chosen automatically:
 *   - DataForSEO (LIVE) if DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are set.
 *   - otherwise a PREVIEW using synthetic data, clearly badged, so you can see
 *     the exact output format with your real name/keyword before paying for calls.
 *
 * Output: web/index.html (deployable heatmap) + out/track-<slug>.json.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { generateGrid } from "./core/grid.js";
import { runScan } from "./core/scan.js";
import type { Business, Keyword } from "./core/types.js";
import type { MapsSerpProvider } from "./collect/provider.js";
import { MockProvider, type MockWorld } from "./collect/mockProvider.js";
import { DataForSeoProvider } from "./collect/dataForSeoProvider.js";
import { renderHeatmapHtml } from "./report/heatmap.js";

interface TrackConfig {
  businessName: string;
  placeId?: string;
  website?: string;
  phone?: string;
  keyword: string;
  center: { lat: number; lng: number };
  gridSize?: number;
  spacingM?: number;
  device?: "mobile" | "desktop";
  languageCode?: string;
  countryCode?: string;
  zoom?: number;
  depth?: number;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "listing";
}

/** Synthetic world for PREVIEW mode, centred on the real business. */
function previewWorld(target: Business, center: { lat: number; lng: number }): MockWorld {
  const off = (dLat: number, dLng: number) => ({ lat: center.lat + dLat, lng: center.lng + dLng });
  return {
    businesses: [
      { name: target.name, placeId: target.placeId ?? "TARGET", website: target.website, phone: target.phone, lat: center.lat, lng: center.lng, strength: 0.9, reachM: 2200, rating: 4.7, reviews: 120 },
      { name: "Competitor A", placeId: "PREVIEW_A", ...off(0.008, -0.012), strength: 1.0, reachM: 3000, rating: 4.6, reviews: 300 },
      { name: "Competitor B", placeId: "PREVIEW_B", ...off(-0.006, 0.010), strength: 0.85, reachM: 2400, rating: 4.4, reviews: 90 },
      { name: "Competitor C", placeId: "PREVIEW_C", ...off(0.004, 0.009), strength: 0.8, reachM: 2000, rating: 4.2, reviews: 60 },
    ],
  };
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? "track.config.json";
  const config = JSON.parse(await readFile(configPath, "utf8")) as TrackConfig;

  if (!config.businessName || !config.keyword || !config.center) {
    throw new Error("track.config.json needs at least businessName, keyword and center {lat,lng}");
  }

  const target: Business = {
    id: "biz_" + slug(config.businessName),
    name: config.businessName,
    placeId: config.placeId || undefined,
    website: config.website || undefined,
    phone: config.phone || undefined,
    location: config.center,
  };
  const keyword: Keyword = {
    id: "kw_" + slug(config.keyword),
    phrase: config.keyword,
    languageCode: config.languageCode ?? "en",
    countryCode: config.countryCode ?? "GB",
  };

  // Pick the data source.
  let provider: MapsSerpProvider;
  let dataSource: "live" | "preview";
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
    provider = new DataForSeoProvider({
      login: process.env.DATAFORSEO_LOGIN,
      password: process.env.DATAFORSEO_PASSWORD,
    });
    dataSource = "live";
    console.log("Data source: DataForSEO (LIVE)");
  } else {
    provider = new MockProvider(previewWorld(target, config.center));
    dataSource = "preview";
    console.log("Data source: PREVIEW (synthetic) — set DATAFORSEO_LOGIN/PASSWORD for live data");
  }

  const grid = generateGrid(
    {
      origin: config.center,
      mode: "square",
      gridSize: config.gridSize ?? 13,
      spacingM: config.spacingM ?? 500,
    },
    { businessId: target.id, device: config.device ?? "mobile", surface: "maps" },
  );

  console.log(`Tracking "${config.businessName}" for "${config.keyword}"`);
  console.log(`Grid: ${grid.points.length} points (${config.gridSize ?? 13}x${config.gridSize ?? 13} @ ${config.spacingM ?? 500} m)`);
  if (dataSource === "live") console.log(`This will make ${grid.points.length} SERP calls.`);

  const scan = await runScan(provider, grid, keyword, target, {
    zoom: config.zoom ?? 15,
    depth: config.depth ?? 20,
  });

  const s = scan.score;
  console.log("\nResult:");
  console.log(`  Share of Local Voice: ${(s.shareOfLocalVoice * 100).toFixed(0)}%`);
  console.log(`  In top 3: ${(s.pctTop3 * 100).toFixed(0)}%   In top 10: ${(s.pctTop10 * 100).toFixed(0)}%   Found: ${(s.pctFound * 100).toFixed(0)}%`);
  console.log(`  Median rank: ${s.medianRank ?? "not ranking"}`);
  console.log(`  Strongest: ${s.strongestDirection ?? "-"}   Weakest: ${s.weakestDirection ?? "-"}`);
  console.log(`  Top competitor: ${s.dominantCompetitor?.name ?? "-"}`);

  const html = renderHeatmapHtml({
    business: { name: target.name, placeId: target.placeId, location: target.location },
    scans: [scan],
    generatedLabel: `${dataSource === "live" ? "DataForSEO" : "preview"} · ${scan.completedAt.slice(0, 10)}`,
    dataSource,
  });
  await mkdir("web", { recursive: true });
  await writeFile("web/report.html", html, "utf8");
  await mkdir("out", { recursive: true });
  await writeFile(`out/track-${slug(config.businessName)}.json`, JSON.stringify(scan, null, 2), "utf8");
  console.log("\nWrote web/report.html — static heatmap for this scan.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
