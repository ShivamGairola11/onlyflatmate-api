import { Injectable, Logger } from '@nestjs/common';
import type { Commute, CommuteLeg, CommuteRoute } from '@/features/commute/types';
import type { GeoLocation } from '@/types/common';
import { ApiError, invalid } from '../common/api-error.js';
import { distanceKm, seededRandom } from '../common/geo.js';
import { type Destination, PlacesService } from '../places/places.service.js';
import { osrmRoute, osrmTable } from './osrm.js';

/** Peak-hour multiplier on the router's free-flow driving time (NCR). */
const PEAK_TRAFFIC_FACTOR = 1.6;
const ROAD_FACTOR = 1.35;
/** OSRM's default max-table-size is 100 coordinates, destination included. */
const TABLE_CHUNK = 99;

const FAR_PAIRS: [string, string][] = [
  ['GURUGRAM', 'NOIDA'],
  ['GURUGRAM', 'GHAZIABAD'],
  ['GURUGRAM', 'DELHI_EAST'],
  ['DELHI_WEST', 'NOIDA'],
  ['DELHI_WEST', 'GHAZIABAD'],
];
const interchanges = (a: string, b: string) => (a === b ? 0 : FAR_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? 2 : 1);

export interface Origin {
  id: string;
  location: GeoLocation;
}

/**
 * Door-to-door commute estimates (same model as the web prototype, so numbers
 * match): CAR/BIKE from the real road route with a peak factor, METRO modelled
 * from distance and region changes, distance-only fallback when routers are down.
 */
@Injectable()
export class CommuteService {
  private readonly log = new Logger('Commute');
  // ponytail: per-process cache keyed by destination + listing point. Move to a
  // commute_cache table (H3 cell × destination) once there's more than one API instance.
  private readonly cache = new Map<string, Map<string, Commute | null>>();

  constructor(private readonly places: PlacesService) {}

  private async metroMinutes(origin: GeoLocation, dest: Destination, roadKm: number) {
    const hops = interchanges((await this.places.nearestLocality(origin)).region, dest.region);
    return Math.max(8, Math.round(10 + roadKm * 1.75 + hops * 7));
  }

  private async legsFromRoad(origin: GeoLocation, dest: Destination, road: { distanceKm: number; minutes: number }): Promise<CommuteLeg[]> {
    const car = Math.round(road.minutes * PEAK_TRAFFIC_FACTOR) + 4;
    return [
      { mode: 'METRO', minutes: await this.metroMinutes(origin, dest, road.distanceKm) },
      { mode: 'CAR', minutes: car },
      ...(road.distanceKm < 35 ? [{ mode: 'BIKE' as const, minutes: Math.round(car * 0.8) }] : []),
    ];
  }

  private async routed(origin: GeoLocation, dest: Destination, road: { distanceKm: number; minutes: number }): Promise<Commute> {
    const legs = await this.legsFromRoad(origin, dest, road);
    return { destinationId: dest.id, destinationName: dest.shortName, distanceKm: road.distanceKm, legs, bestMinutes: Math.min(...legs.map((l) => l.minutes)), quality: 'ROUTED' };
  }

  private async estimated(origin: Origin, dest: Destination): Promise<Commute> {
    const straight = distanceKm(origin.location, dest);
    const road = straight * ROAD_FACTOR;
    const rand = seededRandom(`${origin.id}:${dest.id}`);
    const jitter = () => Math.round((rand() - 0.5) * 4);
    const legs: CommuteLeg[] = [
      { mode: 'METRO', minutes: Math.max(8, (await this.metroMinutes(origin.location, dest, road)) + jitter()) },
      { mode: 'CAR', minutes: Math.max(5, Math.round(6 + road * (straight > 15 ? 1.9 : 2.3)) + jitter()) },
      ...(straight < 25 ? [{ mode: 'BIKE' as const, minutes: Math.max(4, Math.round(4 + road * 1.7) + jitter()) }] : []),
    ];
    return { destinationId: dest.id, destinationName: dest.shortName, distanceKm: Math.round(straight * 10) / 10, legs, bestMinutes: Math.min(...legs.map((l) => l.minutes)), quality: 'ESTIMATED' };
  }

  async destination(destinationId: string) {
    const dest = await this.places.resolveDestination(destinationId);
    if (!dest) throw invalid('Unknown commute destination.');
    return dest;
  }

  /** Commute from each origin to the destination: routed where possible, estimated otherwise. */
  async forOrigins(origins: Origin[], destinationId: string): Promise<Map<string, Commute>> {
    const dest = await this.destination(destinationId);
    let known = this.cache.get(dest.id);
    if (!known) this.cache.set(dest.id, (known = new Map()));
    const key = (o: Origin) => `${o.id}@${o.location.latitude},${o.location.longitude}`;

    const missing = origins.filter((o) => !known.has(key(o)));
    for (let i = 0; i < missing.length; i += TABLE_CHUNK) {
      const batch = missing.slice(i, i + TABLE_CHUNK);
      try {
        const roads = await osrmTable(batch.map((o) => o.location), dest);
        await Promise.all(batch.map(async (o, k) => known.set(key(o), roads[k] ? await this.routed(o.location, dest, roads[k]) : null)));
      } catch (e) {
        // Routers down: don't cache, so the next search tries them again.
        this.log.warn(`Router unavailable, estimating ${batch.length} commutes: ${(e as Error).message}`);
        break;
      }
    }

    const out = new Map<string, Commute>();
    for (const o of origins) out.set(o.id, known.get(key(o)) ?? (await this.estimated(o, dest)));
    return out;
  }

  /** The road route drawn on the map, with peak-hour times per mode. */
  async route(origin: Origin, destinationId: string): Promise<CommuteRoute> {
    const dest = await this.destination(destinationId);
    let road;
    try {
      road = await osrmRoute(origin.location, dest);
    } catch {
      throw new ApiError('UNKNOWN', 'Couldn’t get a road route right now.', 503);
    }
    const legs = await this.legsFromRoad(origin.location, dest, road);
    return { listingId: origin.id, destinationId, distanceKm: road.distanceKm, geometry: road.geometry, offPeakMinutes: road.minutes, legs, bestMinutes: Math.min(...legs.map((l) => l.minutes)) };
  }
}
