import type { LocationSuggestion } from '@/lib/api/contract';
import { type CityId, getCity } from '@/lib/constants/places';
import type { GeoLocation } from '@/types/common';
import { config } from '../config.js';

const BASE_URL = 'https://api.geoapify.com/v1/geocode';
const TIMEOUT_MS = 5000;

interface GeoapifyResult {
  lat: number;
  lon: number;
  place_id?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  suburb?: string;
  district?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country_code?: string;
}

const unique = (parts: (string | undefined)[]) => parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i);

function toSuggestion(r: GeoapifyResult): LocationSuggestion | null {
  if (r.country_code && r.country_code !== 'in') return null;
  const street = r.street ? unique([r.housenumber, r.street]).join(' ') : undefined;
  const locality = r.suburb ?? r.district;
  const name = r.name ?? street ?? locality ?? r.city;
  if (!name) return null;
  return {
    kind: 'ADDRESS',
    id: `geoapify:${r.place_id ?? `${r.lat},${r.lon}`}`,
    name,
    secondary: unique([name === street ? undefined : street, r.suburb, r.district, r.city ?? r.county]).filter((s) => s !== name).slice(0, 3).join(', ') || 'India',
    location: { latitude: r.lat, longitude: r.lon, locality, city: r.city ?? r.county, postalCode: r.postcode },
  };
}

/**
 * Same question, same answer: cache geocoder results (bounded, a day) so repeated searches — and anyone
 * hammering the endpoint — don't each spend a Geoapify credit.
 */
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 3_600_000;
const cache = new Map<string, { at: number; value: LocationSuggestion[] }>();

async function request(path: string, params: Record<string, string>) {
  const key = `${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fetchSuggestions(path, params);
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return value;
}

async function fetchSuggestions(path: string, params: Record<string, string>) {
  if (!config.GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not set');
  const qs = new URLSearchParams({ ...params, lang: 'en', format: 'json', apiKey: config.GEOAPIFY_API_KEY });
  const res = await fetch(`${BASE_URL}${path}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  const body = (await res.json()) as { results?: GeoapifyResult[] };
  return (body.results ?? []).map(toSuggestion).filter((s): s is LocationSuggestion => !!s);
}

/** Free-text address search anywhere in India, ranked towards the given metro. */
export async function geocode(query: string, cityId?: CityId): Promise<LocationSuggestion[]> {
  // Lower-cased and space-collapsed, so trivial variants share a cache entry.
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 3) return [];
  const city = getCity(cityId);
  const bias: Record<string, string> = city ? { bias: `proximity:${city.center.longitude},${city.center.latitude}` } : {};
  const results = await request('/autocomplete', { text: q, limit: '8', filter: 'countrycode:in', ...bias });
  // The same place can come back from several sources; keep the first of each name + area.
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(`${r.name}|${r.secondary}`) && seen.add(`${r.name}|${r.secondary}`));
}

/** Best address for a point (a dropped pin), keeping the exact point the user chose. */
export async function reverseGeocode(point: GeoLocation): Promise<LocationSuggestion | null> {
  // ~11 m precision is plenty for an address, and lets nearby pins share a cache entry.
  const [first] = await request('/reverse', { lat: point.latitude.toFixed(4), lon: point.longitude.toFixed(4), limit: '1' });
  return first ? { ...first, location: { ...first.location, latitude: point.latitude, longitude: point.longitude } } : null;
}
