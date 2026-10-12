import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import type { GeoLocation } from '@/types/common';

/** Cryptographically random number in [0, 1). */
const randomFraction = () => randomInt(2 ** 47) / 2 ** 47;

/** Deterministic PRNG for stable, non-secret jitter (commute estimates). Never for anything that must stay private. */
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

/** SQL for a geography point from a lat/lng (typed as the column's `string` so it drops into inserts/updates). */
export const pointSql = (p: { latitude: number; longitude: number }) =>
  sql<string>`extensions.st_setsrid(extensions.st_makepoint(${p.longitude}, ${p.latitude}), 4326)::extensions.geography`;

/**
 * The PUBLIC point for a listing: `ST_Project` a random offset within `radiusMeters`, never the building itself.
 * The offset must be unpredictable — seeding it from anything public (like the listing id) would let anyone
 * undo it and recover the exact address. It stays stable because callers only re-fuzz when the pin moves.
 */
export function fuzzedPointSql(exact: GeoLocation, radiusMeters: number) {
  const bearing = randomFraction() * 2 * Math.PI;
  const dist = (0.35 + randomFraction() * 0.65) * radiusMeters;
  return sql<string>`extensions.st_project(${pointSql(exact)}, ${dist}::float8, ${bearing}::float8)`;
}

/** Select a geography column's latitude / longitude. */
export const latOf = (column: string) => sql<number>`extensions.st_y(${sql.ref(column)}::extensions.geometry)`;
export const lngOf = (column: string) => sql<number>`extensions.st_x(${sql.ref(column)}::extensions.geometry)`;
