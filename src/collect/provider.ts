/**
 * Collection provider abstraction.
 *
 * The rest of the system never talks to Google directly. It asks a provider for
 * "the ordered Maps results a signed-out searcher at this exact coordinate would
 * see". That keeps the valuable, defensible part — the tracker, the grid, the
 * scoring, the history — independent of *how* the SERP is collected. You can
 * start with a hosted SERP API and later swap in your own browser fleet without
 * changing anything upstream.
 */

import type { Device } from "../core/types.js";

export interface SerpRequest {
  keyword: string;
  lat: number;
  lng: number;
  /** Maps zoom level baked into the coordinate parameter (e.g. 15). */
  zoom: number;
  languageCode: string; // "en"
  countryCode: string; // "GB"
  device: Device;
  /** How deep to read the result list before declaring "not found". */
  depth: number;
}

export interface SerpBusiness {
  /** 1-based position in the ordered Maps result list. */
  position: number;
  name: string;
  placeId?: string;
  cid?: string;
  website?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews?: number;
  lat?: number;
  lng?: number;
}

export interface SerpResponse {
  request: SerpRequest;
  results: SerpBusiness[];
  provider: string;
  collectedAt: string; // ISO-8601
  /** Raw provider payload, retained for auditing. Keep this — you will need it. */
  raw?: unknown;
}

export interface MapsSerpProvider {
  readonly name: string;
  collect(req: SerpRequest): Promise<SerpResponse>;
}
