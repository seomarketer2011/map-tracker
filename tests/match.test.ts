import { describe, expect, it } from "vitest";
import { matchTarget, normalizePhone, extractDomain, normalizeName } from "../src/core/match.js";
import type { SerpBusiness } from "../src/collect/provider.js";
import type { Business } from "../src/core/types.js";

const results: SerpBusiness[] = [
  { position: 1, name: "ABC Plumbing", placeId: "PLACE_ABC", website: "abcplumbing.co.uk" },
  { position: 2, name: "Stone Emergency Plumbers Ltd", placeId: "PLACE_TARGET", website: "stoneplumbers.co.uk", phone: "+44 20 7946 0000" },
  { position: 3, name: "XYZ Heating", placeId: "PLACE_XYZ" },
];

describe("match", () => {
  it("prefers Place ID over everything", () => {
    const target: Business = { id: "t", name: "Totally Different Name", placeId: "PLACE_TARGET" };
    const m = matchTarget(target, results);
    expect(m.method).toBe("place_id");
    expect(m.business?.position).toBe(2);
  });

  it("falls back to domain when no place id matches", () => {
    const target: Business = { id: "t", name: "Stone", website: "https://www.stoneplumbers.co.uk/contact" };
    const m = matchTarget(target, results);
    expect(m.method).toBe("domain");
    expect(m.business?.position).toBe(2);
  });

  it("falls back to normalised phone", () => {
    const target: Business = { id: "t", name: "Stone", phone: "020 7946 0000" };
    const m = matchTarget(target, results);
    expect(m.method).toBe("phone");
    expect(m.business?.position).toBe(2);
  });

  it("returns none when the business is absent", () => {
    const target: Business = { id: "t", name: "Nonexistent Trades", placeId: "PLACE_NOPE" };
    const m = matchTarget(target, results);
    expect(m.method).toBe("none");
    expect(m.business).toBeNull();
  });

  it("normalisers", () => {
    expect(normalizePhone("+44 (0)20 7946 0000")).toBe("2079460000");
    expect(normalizePhone("020 7946 0000")).toBe("2079460000");
    expect(extractDomain("https://www.Example.com/path")).toBe("example.com");
    expect(normalizeName("Stone Emergency Plumbers Ltd.")).toBe("stone emergency plumbers");
  });
});
