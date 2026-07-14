/**
 * DataForSEO Google Maps SERP adapter.
 *
 * Implements the same `MapsSerpProvider` interface as the mock, so switching to
 * real collection is a one-line change in the scan config.
 *
 * Endpoint: POST https://api.dataforseo.com/v3/serp/google/maps/live/advanced
 * Auth:     HTTP Basic (login:password) — set DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.
 *
 * The key detail is `location_coordinate: "lat,lng,zoom"` — this is what makes
 * the search *originate* at the pin rather than just mentioning a town name.
 * DataForSEO documents building a grid by submitting one task per coordinate,
 * which is exactly what our scan loop does.
 *
 * NOTE: field names in the response occasionally shift; the parser below is
 * defensive and keeps the raw payload so you can re-parse historical data.
 * Verify against a live sample before trusting production numbers.
 */

import type { MapsSerpProvider, SerpBusiness, SerpRequest, SerpResponse } from "./provider.js";

export interface DataForSeoConfig {
  login: string;
  password: string;
  endpoint?: string;
  /** Optional override for fetch (tests). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";

export class DataForSeoProvider implements MapsSerpProvider {
  readonly name = "dataforseo";
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: DataForSeoConfig) {
    if (!config.login || !config.password) {
      throw new Error("DataForSEO credentials missing (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)");
    }
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async collect(req: SerpRequest): Promise<SerpResponse> {
    const auth = Buffer.from(`${this.config.login}:${this.config.password}`).toString("base64");
    const task = [
      {
        keyword: req.keyword,
        location_coordinate: `${req.lat},${req.lng},${req.zoom}z`,
        language_code: req.languageCode,
        device: req.device,
        os: req.device === "mobile" ? "android" : "windows",
        depth: req.depth,
      },
    ];

    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(task),
    });

    if (!res.ok) {
      throw new Error(`DataForSEO HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const payload = (await res.json()) as DfsPayload;
    return {
      request: req,
      results: parseResults(payload, req.depth),
      provider: this.name,
      collectedAt: new Date().toISOString(),
      raw: payload,
    };
  }
}

interface DfsPayload {
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: Array<{ items?: DfsItem[] }>;
  }>;
}

interface DfsItem {
  type?: string;
  rank_absolute?: number;
  rank_group?: number;
  title?: string;
  place_id?: string;
  cid?: string;
  domain?: string;
  url?: string;
  phone?: string;
  address?: string;
  rating?: { value?: number; votes_count?: number };
  latitude?: number;
  longitude?: number;
}

export function parseResults(payload: DfsPayload, depth: number): SerpBusiness[] {
  const task = payload.tasks?.[0];
  if (task && task.status_code && task.status_code >= 40000) {
    throw new Error(`DataForSEO task error ${task.status_code}: ${task.status_message ?? "unknown"}`);
  }
  const items = task?.result?.[0]?.items ?? [];
  const out: SerpBusiness[] = [];
  for (const item of items) {
    // Only ranked map listings carry a position; skip ads/related/questions.
    const position = item.rank_absolute ?? item.rank_group;
    if (!position || !item.title) continue;
    out.push({
      position,
      name: item.title,
      placeId: item.place_id,
      cid: item.cid,
      website: item.domain ?? item.url,
      phone: item.phone,
      address: item.address,
      rating: item.rating?.value,
      reviews: item.rating?.votes_count,
      lat: item.latitude,
      lng: item.longitude,
    });
    if (out.length >= depth) break;
  }
  return out.sort((a, b) => a.position - b.position);
}
