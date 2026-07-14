/**
 * Mock SERP provider — lets the whole pipeline run offline, with zero API keys.
 *
 * It is NOT random noise. It models a believable local world: each business has
 * a true location and a base strength, and its rank at a given search origin
 * falls off with distance from that business (plus a little deterministic
 * keyword-specific jitter). The result is a heatmap that behaves the way a real
 * one does — the tracked GBP dominates near its premises and fades at the edges,
 * and different competitors win in different corners of the map.
 *
 * Use it for development, tests, demos, and as a golden fixture when validating
 * a real provider adapter.
 */

import { haversineMetres } from "../core/geo.js";
import { hash01 } from "../core/ids.js";
import type { MapsSerpProvider, SerpBusiness, SerpRequest, SerpResponse } from "./provider.js";

export interface MockBusiness {
  name: string;
  placeId: string;
  cid?: string;
  website?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  lat: number;
  lng: number;
  /** Baseline prominence, ~0..1. Bigger brands rank wider. */
  strength: number;
  /** How fast rank decays with distance. Smaller = more local. Metres. */
  reachM: number;
}

export interface MockWorld {
  businesses: MockBusiness[];
}

export class MockProvider implements MapsSerpProvider {
  readonly name = "mock";
  constructor(private readonly world: MockWorld) {}

  async collect(req: SerpRequest): Promise<SerpResponse> {
    const origin = { lat: req.lat, lng: req.lng };
    const scored = this.world.businesses.map((b) => {
      const dist = haversineMetres(origin, { lat: b.lat, lng: b.lng });
      // Exponential distance decay, scaled by each business's reach.
      const proximity = Math.exp(-dist / b.reachM);
      // Deterministic per (business, keyword, coarse-location) jitter — models
      // the small real-world fluctuation between neighbouring points/keywords.
      const jitter = (hash01(`${b.placeId}|${req.keyword}|${req.lat.toFixed(3)},${req.lng.toFixed(3)}`) - 0.5) * 0.15;
      const score = b.strength * proximity + jitter;
      return { b, score };
    });

    scored.sort((x, y) => y.score - x.score);

    const results: SerpBusiness[] = scored.slice(0, req.depth).map(({ b }, i) => ({
      position: i + 1,
      name: b.name,
      placeId: b.placeId,
      cid: b.cid,
      website: b.website,
      phone: b.phone,
      address: b.address,
      rating: b.rating,
      reviews: b.reviews,
      lat: b.lat,
      lng: b.lng,
    }));

    return {
      request: req,
      results,
      provider: this.name,
      // Deterministic timestamp seed avoids Date.now() (keeps demo output stable
      // for snapshot-style comparisons). Real providers stamp real time.
      collectedAt: "1970-01-01T00:00:00.000Z",
      raw: { note: "mock world", businessCount: this.world.businesses.length },
    };
  }
}
