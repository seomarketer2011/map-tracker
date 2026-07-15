/**
 * GET /api/suggest?q=<name>&near=<lat,lng>
 *
 * Typeahead for Google Business Profiles. Backed by DataForSEO's
 * business_listings database (fast, ~$0.01/query) — not a live Maps search per
 * keystroke. Debounce on the client.
 */

const b64 = (s: string): string => (typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s).toString("base64"));

interface Env {
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
}

const ENDPOINT = "https://api.dataforseo.com/v3/business_data/business_listings/search/live";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const near = url.searchParams.get("near"); // "lat,lng"
  if (q.length < 3) return json({ suggestions: [] });
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    return json({ error: "Collection credentials not configured on the server." }, 500);
  }

  const body: Record<string, unknown> = {
    filters: [["title", "like", `%${q}%`]],
    order_by: ["rating.votes_count,desc"],
    limit: 8,
  };
  if (near && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) {
    body.location_coordinate = `${near},50000`; // 50 km radius bias
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${b64(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([body]),
  });
  if (!res.ok) return json({ error: `Upstream ${res.status}` }, 502);

  const payload = (await res.json()) as any;
  const task = payload?.tasks?.[0];
  if (task?.status_code >= 40000) return json({ error: task.status_message }, 502);
  const items = task?.result?.[0]?.items ?? [];

  const suggestions = items.map((it: any) => ({
    name: it.title,
    address: it.address,
    placeId: it.place_id,
    cid: it.cid,
    domain: it.domain,
    phone: it.phone,
    category: it.category,
    rating: it.rating?.value,
    reviews: it.rating?.votes_count,
    lat: it.latitude,
    lng: it.longitude,
  })).filter((s: any) => s.name && s.lat && s.lng);

  return json({ suggestions });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
