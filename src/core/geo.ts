/**
 * Geodesy — the single most important calculation in the system.
 *
 * A 500 m grid means 500 m of *ground distance* between points. You cannot add
 * a fixed number to latitude/longitude, because a degree of longitude shrinks
 * as you move away from the equator. We therefore place every point by
 * projecting a ground distance + bearing from the origin.
 *
 * These use a spherical-earth model (mean radius 6 371 008.8 m). At grid
 * distances (metres to ~10 km) the error versus a full ellipsoidal solution is
 * well under a metre — negligible for placing search origins. If you later need
 * survey-grade accuracy, swap `destinationPoint`/`haversineMetres` for
 * GeographicLib or PROJ without touching the rest of the system.
 *
 * Formulas: Ed Williams' "Aviation Formulary" / Chris Veness' movable-type
 * reference (destination point given distance & bearing; haversine; initial
 * bearing).
 */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance between two coordinates, in metres. */
export function haversineMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from true north [0, 360). */
export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Project a new coordinate a given ground distance and bearing from an origin.
 * `bearingDeg` is clockwise from true north.
 */
export function destinationPoint(
  origin: { lat: number; lng: number },
  distanceM: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  if (distanceM === 0) return { lat: origin.lat, lng: origin.lng };
  const delta = distanceM / EARTH_RADIUS_M; // angular distance
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );

  // Normalise longitude to [-180, 180].
  const lng = (((toDeg(lambda2) + 540) % 360) - 180);
  return { lat: toDeg(phi2), lng };
}

/**
 * Place a coordinate at a local east/north offset (metres) from an origin.
 * Positive `eastM` = toward increasing longitude; positive `northM` = toward
 * increasing latitude. Handy for building a square lattice.
 */
export function offsetPoint(
  origin: { lat: number; lng: number },
  eastM: number,
  northM: number,
): { lat: number; lng: number } {
  const distanceM = Math.hypot(eastM, northM);
  if (distanceM === 0) return { lat: origin.lat, lng: origin.lng };
  // Bearing clockwise from north: atan2(east, north).
  const bearingDeg = (toDeg(Math.atan2(eastM, northM)) + 360) % 360;
  return destinationPoint(origin, distanceM, bearingDeg);
}

/** Compass label for a bearing, into 8 sectors (N, NE, E, …). */
export function compassSector(bearingDeg: number): string {
  const sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((bearingDeg % 360) / 45)) % 8;
  return sectors[idx]!;
}
