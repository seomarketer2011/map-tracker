import { describe, expect, it } from "vitest";
import { parseResults } from "../src/collect/dataForSeoProvider.js";

// Trimmed shape of a DataForSEO google/maps/live/advanced response.
const payload = {
  tasks: [
    {
      status_code: 20000,
      result: [
        {
          items: [
            { type: "maps_search", rank_absolute: 1, title: "ABC Plumbing", place_id: "PLACE_ABC", rating: { value: 4.6, votes_count: 480 }, latitude: 51.51, longitude: -0.14 },
            { type: "maps_search", rank_absolute: 2, title: "Stone Emergency Plumbers", place_id: "PLACE_TARGET", cid: "123", domain: "stoneplumbers.co.uk", phone: "+442079460000" },
            { type: "ad", title: "Sponsored" }, // should be skipped (no rank)
            { type: "maps_search", rank_absolute: 3, title: "XYZ Heating", place_id: "PLACE_XYZ" },
          ],
        },
      ],
    },
  ],
};

describe("dataforseo parser", () => {
  it("extracts ranked map listings in order and skips non-ranked items", () => {
    const out = parseResults(payload, 20);
    expect(out.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(out[1]!.name).toBe("Stone Emergency Plumbers");
    expect(out[1]!.placeId).toBe("PLACE_TARGET");
    expect(out[0]!.rating).toBe(4.6);
    expect(out[0]!.reviews).toBe(480);
  });

  it("respects the requested depth", () => {
    expect(parseResults(payload, 2)).toHaveLength(2);
  });

  it("throws on a task-level error", () => {
    const bad = { tasks: [{ status_code: 40501, status_message: "Invalid Field" }] };
    expect(() => parseResults(bad, 20)).toThrow(/40501/);
  });
});
