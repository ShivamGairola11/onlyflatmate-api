// Synced from the web app (src/lib/utils/geo.ts) by scripts/sync-contract.mjs — do not edit here.
import type { GeoBounds, GeoLocation } from "@/types/common";

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance. Server-side equivalent: `ST_DistanceSphere`. */
export function distanceKm(a: GeoLocation, b: GeoLocation): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isWithinBounds(point: GeoLocation, bounds: GeoBounds): boolean {
  return (
    point.latitude <= bounds.north &&
    point.latitude >= bounds.south &&
    point.longitude <= bounds.east &&
    point.longitude >= bounds.west
  );
}

/** Deterministic PRNG so fuzzed coordinates are stable between renders/reloads. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Offset a point by a random bearing/distance within `radiusMeters`.
 * Used to derive the PUBLIC location from the exact one. The exact point
 * is never sent to clients in production.
 */
export function approximateLocation(
  exact: GeoLocation,
  radiusMeters: number,
  seed: string,
): GeoLocation {
  const rand = seededRandom(seed);
  const bearing = rand() * 2 * Math.PI;
  // Keep a minimum offset so the approximate point is never the house itself.
  const dist = (0.35 + rand() * 0.65) * radiusMeters;
  const dLat = (dist * Math.cos(bearing)) / 111_320;
  const dLng = (dist * Math.sin(bearing)) / (111_320 * Math.cos(toRad(exact.latitude)));
  return {
    ...exact,
    latitude: round(exact.latitude + dLat, 5),
    longitude: round(exact.longitude + dLng, 5),
  };
}

export function offsetLocation(origin: GeoLocation, northKm: number, eastKm: number): GeoLocation {
  return {
    ...origin,
    latitude: origin.latitude + northKm / 111.32,
    longitude: origin.longitude + eastKm / (111.32 * Math.cos(toRad(origin.latitude))),
  };
}

/** GeoJSON ring approximating a circle — for drawing commute / privacy radii. */
export function circlePolygon(center: GeoLocation, radiusKm: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const p = offsetLocation(center, radiusKm * Math.cos(angle), radiusKm * Math.sin(angle));
    ring.push([p.longitude, p.latitude]);
  }
  return ring;
}

export function boundsAround(points: GeoLocation[], paddingKm = 0.5): GeoBounds | undefined {
  if (points.length === 0) return undefined;
  let north = -90, south = 90, east = -180, west = 180;
  for (const p of points) {
    north = Math.max(north, p.latitude);
    south = Math.min(south, p.latitude);
    east = Math.max(east, p.longitude);
    west = Math.min(west, p.longitude);
  }
  const padLat = paddingKm / 111.32;
  const padLng = paddingKm / 111.32;
  return { north: north + padLat, south: south - padLat, east: east + padLng, west: west - padLng };
}

function round(n: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
