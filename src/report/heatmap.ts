/**
 * Standalone heatmap report generator.
 *
 * Produces a single self-contained HTML file: the scan data is embedded inline,
 * Leaflet is loaded from CDN for the base map. It renders the coloured grid, a
 * per-keyword selector, a metrics panel, and a per-point popup showing the top
 * results and how the target was matched.
 *
 * This is deliberately framework-free so it drops straight onto Cloudflare Pages
 * (or any static host) with no build step.
 */

import type { ScanResult } from "../core/scan.js";

export interface ReportBundle {
  business: { name: string; placeId?: string; location?: { lat: number; lng: number } };
  scans: ScanResult[];
  generatedLabel: string;
}

export function renderHeatmapHtml(bundle: ReportBundle): string {
  const data = JSON.stringify(bundle).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(bundle.business.name)} — Local Grid Rank Tracker</title>
<link rel="stylesheet" href="./vendor/leaflet.css" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  #app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
  #panel { padding: 18px; overflow-y: auto; border-right: 1px solid #8883; }
  #map { height: 100vh; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .muted { color: #7a7a7a; font-size: 12px; }
  select { width: 100%; padding: 8px; margin: 12px 0; border-radius: 8px; border: 1px solid #8886; background: transparent; color: inherit; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
  .metric { background: #8881; border-radius: 10px; padding: 10px; }
  .metric .v { font-size: 20px; font-weight: 650; }
  .metric .k { font-size: 11px; color: #7a7a7a; text-transform: uppercase; letter-spacing: .03em; }
  .legend { margin: 14px 0; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; margin-right: 12px; font-size: 12px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; border: 1px solid #0004; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th, td { text-align: left; padding: 3px 4px; border-bottom: 1px solid #8882; }
  .leaflet-tooltip.pin-label { background: transparent; border: none; box-shadow: none; padding: 0; }
  .leaflet-tooltip.pin-label::before { display: none; }
  .pin-label { font-weight: 700; color: #1a1a1a; font-size: 11px; }
  footer { margin-top: 18px; font-size: 11px; color: #7a7a7a; }
</style>
</head>
<body>
<div id="app">
  <div id="panel">
    <h1>${escapeHtml(bundle.business.name)}</h1>
    <div class="muted">Google Maps grid rank tracker · ${escapeHtml(bundle.generatedLabel)}</div>
    <select id="keyword"></select>
    <div class="metrics" id="metrics"></div>
    <div class="legend">
      <span><i class="dot" style="background:#1a9850"></i>Rank 1–3</span>
      <span><i class="dot" style="background:#fee08b"></i>4–10</span>
      <span><i class="dot" style="background:#f46d43"></i>11–20</span>
      <span><i class="dot" style="background:#9e9e9e"></i>20+ / none</span>
    </div>
    <div id="competitors"></div>
    <footer>
      Standardised, signed-out, non-personalised measurement. Colour reflects rank at each
      search origin. This is a repeatable relative measure, not a guarantee of any single
      user's live result.
    </footer>
  </div>
  <div id="map"></div>
</div>
<script src="./vendor/leaflet.js"></script>
<script>
const BUNDLE = ${data};
const hasLeaflet = typeof L !== 'undefined';
const origin = BUNDLE.business.location || (BUNDLE.scans[0] && avgCenter(BUNDLE.scans[0]));

let map = null, layer = null;
if (hasLeaflet) {
  map = L.map('map').setView([origin.lat, origin.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
} else {
  document.getElementById('map').innerHTML =
    '<div style="padding:24px;color:#888">Map library unavailable — metrics still shown on the left.</div>';
}

const sel = document.getElementById('keyword');
BUNDLE.scans.forEach((s, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = s.keyword.phrase + '  ·  ' + s.device + '  ·  ' + s.surface;
  sel.appendChild(o);
});
sel.addEventListener('change', () => render(Number(sel.value)));

function avgCenter(scan) {
  const n = scan.points.length || 1;
  return {
    lat: scan.points.reduce((a,p)=>a+p.lat,0)/n,
    lng: scan.points.reduce((a,p)=>a+p.lng,0)/n,
  };
}
function colorFor(rank) {
  if (rank === null || rank === undefined) return '#9e9e9e';
  if (rank <= 3) return '#1a9850';
  if (rank <= 10) return '#fee08b';
  if (rank <= 20) return '#f46d43';
  return '#9e9e9e';
}
function pct(x) { return (x * 100).toFixed(0) + '%'; }

function render(i) {
  const scan = BUNDLE.scans[i];
  if (hasLeaflet && layer) {
    layer.clearLayers();
    scan.points.forEach(p => {
      const label = p.observation.rank === null ? '×' : String(p.observation.rank);
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 15, color: '#0006', weight: 1,
        fillColor: colorFor(p.observation.rank), fillOpacity: 0.85,
      });
      marker.bindTooltip(label, { permanent: true, direction: 'center', className: 'pin-label' });
      const top = p.results.slice(0, 3).map((r, idx) =>
        '<tr><td>' + (idx+1) + '</td><td>' + escapeH(r.name) + '</td></tr>').join('');
      marker.bindPopup(
        '<b>Rank: ' + label + '</b> (' + p.observation.bucket + ')<br>' +
        'matched by: ' + p.observation.matchMethod + ' · confidence: ' + p.confidence + '<br>' +
        'distance: ' + p.distanceM + ' m<br>' +
        '<table>' + top + '</table>'
      );
      marker.addTo(layer);
    });
  }

  const s = scan.score;
  document.getElementById('metrics').innerHTML = [
    metric('Share of Local Voice', pct(s.shareOfLocalVoice)),
    metric('In top 3', pct(s.pctTop3)),
    metric('In top 10', pct(s.pctTop10)),
    metric('Median rank', s.medianRank === null ? '—' : s.medianRank),
    metric('Strongest', s.strongestDirection || '—'),
    metric('Weakest', s.weakestDirection || '—'),
  ].join('');

  const comp = s.dominantCompetitor;
  document.getElementById('competitors').innerHTML = comp
    ? '<h1 style="font-size:14px;margin-top:16px">Dominant competitor</h1>' +
      '<div class="muted">' + escapeH(comp.name) + ' — wins ' + comp.wins +
      ' pins, avg pos ' + comp.avgPosition.toFixed(1) + '</div>'
    : '';
}
function metric(k, v) {
  return '<div class="metric"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
}
function escapeH(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
render(0);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
