import type { GeoLocation } from '@/types/common';
import { config } from '../config.js';

export interface RoadRoute {
  distanceKm: number;
  /** Free-flow driving time. */
  minutes: number;
  /** [longitude, latitude] pairs. */
  geometry: [number, number][];
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

/** The router that last answered goes first next time, so pin colours and drawn routes agree. */
let preferred = 0;

async function request(path: string): Promise<OsrmResponse> {
  const urls = config.ROUTER_URLS;
  let lastError: unknown;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const i = (preferred + attempt) % urls.length;
    try {
      const res = await fetch(`${urls[i]}${path}`, { signal: AbortSignal.timeout(config.ROUTER_TIMEOUT_MS) });
      const body = (await res.json().catch(() => ({ code: 'Error' }))) as OsrmResponse;
      // NoRoute etc. is a real answer about the input; another server won't do better.
      if (res.ok || body.code !== 'Error') {
        preferred = i;
        if (body.code !== 'Ok') throw Object.assign(new Error(body.message ?? body.code), { final: true });
        return body;
      }
      lastError = new Error(`Router responded ${res.status}`);
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('No router configured');
}

const pair = (p: GeoLocation) => `${p.longitude},${p.latitude}`;

export async function osrmRoute(from: GeoLocation, to: GeoLocation): Promise<RoadRoute> {
  const body = await request(`/route/v1/driving/${pair(from)};${pair(to)}?overview=full&geometries=geojson&alternatives=false&steps=false`);
  const route = body.routes?.[0];
  if (!route) throw new Error('No route found');
  return { distanceKm: Math.round(route.distance / 100) / 10, minutes: Math.max(1, Math.round(route.duration / 60)), geometry: route.geometry.coordinates };
}

/** One-to-many free-flow time/distance from each origin to `to`; null where unroutable. */
export async function osrmTable(origins: GeoLocation[], to: GeoLocation): Promise<(Omit<RoadRoute, 'geometry'> | null)[]> {
  if (!origins.length) return [];
  const body = await request(`/table/v1/driving/${[...origins, to].map(pair).join(';')}?destinations=${origins.length}&annotations=duration,distance`);
  if (!body.durations || !body.distances) throw new Error('Router returned no table');
  return origins.map((_, i) => {
    const duration = body.durations![i]?.[0];
    const distance = body.distances![i]?.[0];
    return duration == null || distance == null ? null : { distanceKm: Math.round(distance / 100) / 10, minutes: Math.max(1, Math.round(duration / 60)) };
  });
}
