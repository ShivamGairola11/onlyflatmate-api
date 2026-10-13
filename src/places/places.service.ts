import { Injectable, Logger } from '@nestjs/common';
import type { LocationSuggestion } from '@/lib/api/contract';
import { type CityId, cityAt, cityOfRegion, localitiesIn, type Region } from '@/lib/constants/places';
import { distanceKm } from '@/lib/utils/geo';
import type { GeoLocation } from '@/types/common';
import { sql } from 'kysely';
import { latOf, lngOf, pointSql } from '../common/geo.js';
import { type Database, InjectDb } from '../db/db.module.js';

export interface Locality extends GeoLocation {
  slug: string;
  name: string;
  city: string;
  region: string;
  radiusKm: number;
}

/** Where someone commutes to: a known landmark, or any address / pin (`geo:lat,lng:name`). */
export interface Destination extends GeoLocation {
  id: string;
  name: string;
  shortName: string;
  kind: 'WORKPLACE' | 'COLLEGE' | 'CUSTOM';
  city: string;
  region: string;
}

const CUSTOM_ID = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?::(.*))?$/;

const ALIASES: Record<string, string[]> = {
  'cyber-city': ['cyber hub', 'dlf cyber'],
  'du-north-campus': ['delhi university', 'north campus', 'du'],
  'connaught-place': ['cp', 'rajiv chowk'],
  'iit-delhi': ['iitd'],
  'greater-kailash': ['gk', 'gk 1', 'gk1'],
};

/** Old and new city names match each other (Bombay ↔ Mumbai …). */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bsec(tor)?\.?\s*/g, 'sector ')
    .replace(/gurugram/g, 'gurgaon')
    .replace(/bombay/g, 'mumbai')
    .replace(/bangalore/g, 'bengaluru')
    .replace(/calcutta/g, 'kolkata')
    .replace(/madras/g, 'chennai')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The gazetteer (localities and landmarks). It's small and changes only by
 * migration, so it's read once and kept in memory.
 */
@Injectable()
export class PlacesService {
  private readonly log = new Logger('Places');
  private loaded?: Promise<{ localities: Locality[]; landmarks: Destination[] }>;

  constructor(@InjectDb() private readonly db: Database) {}

  private load() {
    this.loaded ??= (async () => {
      const [localities, landmarks] = await Promise.all([
        this.db.selectFrom('localities').select(['slug', 'name', 'city', 'region', 'radius_km', latOf('point').as('lat'), lngOf('point').as('lng')]).execute(),
        this.db.selectFrom('landmarks').select(['id', 'name', 'short_name', 'kind', 'city', 'region', latOf('point').as('lat'), lngOf('point').as('lng')]).execute(),
      ]);
      return {
        localities: localities.map((l) => ({ slug: l.slug, name: l.name, city: l.city, region: l.region, radiusKm: Number(l.radius_km), latitude: l.lat, longitude: l.lng })),
        landmarks: landmarks.map((l) => ({ id: l.id, name: l.name, shortName: l.short_name, kind: l.kind as Destination['kind'], city: l.city, region: l.region, latitude: l.lat, longitude: l.lng })),
      };
    })();
    return this.loaded;
  }

  async localities() {
    return (await this.load()).localities;
  }

  /** Each point's nearest locality (KNN on the GiST index) and its straight-line km to `to`, in one query. */
  async nearest(points: { id: string; location: GeoLocation }[], to: GeoLocation): Promise<Map<string, { locality: Locality; km: number }>> {
    if (!points.length) return new Map();
    const values = sql.join(points.map((p) => sql`(${p.id}::text, ${p.location.longitude}::float8, ${p.location.latitude}::float8)`));
    const { rows } = await sql<{ id: string; slug: string; km: number }>`
      select o.id, n.slug, extensions.st_distance(o.pt, ${pointSql(to)}) / 1000 as km
      from (select v.id, extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography as pt from (values ${values}) as v(id, lng, lat)) o
      cross join lateral (select l.slug from public.localities l order by l.point operator(extensions.<->) o.pt limit 1) n
    `.execute(this.db);
    const { localities } = await this.load();
    const bySlug = new Map(localities.map((l) => [l.slug, l]));
    return new Map(rows.map((r) => [r.id, { locality: bySlug.get(r.slug)!, km: Number(r.km) }]));
  }

  /**
   * Never a locality from another metro: if the table is missing the point's city (its migration not
   * applied yet), a Dwarka pin would otherwise be labelled Ahmedabad. Falls back to the contract's list.
   */
  async nearestLocality(point: GeoLocation): Promise<Locality> {
    const near = (await this.nearest([{ id: '', location: point }], point)).get('')!.locality;
    const city = cityAt(point);
    if (!city || cityOfRegion(near.region as Region) === city.id) return near;
    this.log.warn(`No ${city.id} localities in the database; labelling the point from the contract list`);
    return localitiesIn(city.id).reduce((best, l) => (distanceKm(point, l) < distanceKm(point, best) ? l : best));
  }

  async resolveDestination(id: string | undefined): Promise<Destination | undefined> {
    if (!id) return undefined;
    const { landmarks } = await this.load();
    const landmark = landmarks.find((l) => l.id === id);
    if (landmark) return landmark;
    const m = CUSTOM_ID.exec(id);
    if (!m) return undefined;
    const point = { latitude: Number(m[1]), longitude: Number(m[2]) };
    // Only places we serve: anything else is a typo or someone probing the router through us.
    if (!cityAt(point)) return undefined;
    const near = await this.nearestLocality(point);
    const name = m[3]?.trim() || `Pin near ${near.name}`;
    return { id, name, shortName: name.length > 22 ? `${name.slice(0, 21)}…` : name, kind: 'CUSTOM', city: near.city, region: near.region, ...point };
  }

  /** Known places matching a query: the given metro's first, then by relevance. */
  async search(query: string, city?: CityId): Promise<LocationSuggestion[]> {
    const q = normalise(query);
    if (!q) return [];
    const { localities, landmarks } = await this.load();
    const score = (name: string, aliases: string[] = []) => {
      const n = normalise(name);
      if (n.startsWith(q) || aliases.some((a) => a.startsWith(q))) return 2;
      if (n.includes(q) || aliases.some((a) => a.includes(q))) return 1;
      return 0;
    };
    const inCity = (region: string) => (city && cityOfRegion(region as Region) === city ? 1 : 0);
    return [
      ...localities.map((l) => ({
        c: inCity(l.region),
        s: score(`${l.name} ${l.city}`, ALIASES[l.slug]),
        v: { kind: 'LOCALITY' as const, id: l.slug, name: l.name, secondary: l.city, location: { latitude: l.latitude, longitude: l.longitude, locality: l.name, city: l.city } },
      })),
      ...landmarks.map((l) => ({
        c: inCity(l.region),
        s: score(`${l.name} ${l.shortName}`, ALIASES[l.id]),
        v: { kind: l.kind as 'WORKPLACE' | 'COLLEGE', id: l.id, name: l.name, secondary: l.kind === 'COLLEGE' ? 'College' : 'Workplace', location: { latitude: l.latitude, longitude: l.longitude, city: l.city } },
      })),
    ]
      .filter((x) => x.s > 0)
      .sort((a, b) => b.c - a.c || b.s - a.s)
      .slice(0, 8)
      .map((x) => x.v);
  }
}
