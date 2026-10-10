import type { LocationSuggestion } from '@/lib/api/contract';
import { type CityId, getCity, INDIA_BOUNDS } from '@/lib/constants/places';
import type { GeoLocation } from '@/types/common';
import { config } from '../config.js';

/** India, in Photon's bbox order (west, south, east, north). */
const INDIA_BBOX = [INDIA_BOUNDS.west, INDIA_BOUNDS.south, INDIA_BOUNDS.east, INDIA_BOUNDS.north].join(',');
const TIMEOUT_MS = 5000;

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: { osm_type?: string; osm_id?: number; name?: string; housenumber?: string; street?: string; locality?: string; district?: string; city?: string; postcode?: string; countrycode?: string };
}

const unique = (parts: (string | undefined)[]) => parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i);

function toSuggestion(f: PhotonFeature): LocationSuggestion | null {
  const p = f.properties;
  if (p.countrycode && p.countrycode !== 'IN') return null;
  const street = p.street ? unique([p.housenumber, p.street]).join(' ') : undefined;
  const name = p.name ?? street ?? p.locality ?? p.district;
  if (!name) return null;
  const [longitude, latitude] = f.geometry.coordinates;
  return {
    kind: 'ADDRESS',
    id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${latitude},${longitude}`}`,
    name,
    secondary: unique([name === street ? undefined : street, p.locality, p.district, p.city]).filter((s) => s !== name).slice(0, 3).join(', ') || 'India',
    location: { latitude, longitude, locality: p.locality ?? p.district, city: p.city, postalCode: p.postcode },
  };
}

async function request(path: string, params: Record<string, string>) {
  const res = await fetch(`${config.GEOCODER_URL}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  const body = (await res.json()) as { features?: PhotonFeature[] };
  return (body.features ?? []).map(toSuggestion).filter((s): s is LocationSuggestion => !!s);
}

/** Free-text address search anywhere in India, ranked towards the given metro. */
export async function geocode(query: string, cityId?: CityId): Promise<LocationSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const city = getCity(cityId);
  const bias: Record<string, string> = city ? { lat: String(city.center.latitude), lon: String(city.center.longitude) } : {};
  const results = await request('/api/', { q, limit: '8', lang: 'en', bbox: INDIA_BBOX, ...bias });
  // The same place often comes back as several OSM objects; keep the first of each name + area.
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(`${r.name}|${r.secondary}`) && seen.add(`${r.name}|${r.secondary}`));
}

/** Best address for a point (a dropped pin), keeping the exact point the user chose. */
export async function reverseGeocode(point: GeoLocation): Promise<LocationSuggestion | null> {
  const [first] = await request('/reverse', { lat: String(point.latitude), lon: String(point.longitude), limit: '1', lang: 'en' });
  return first ? { ...first, location: { ...first.location, latitude: point.latitude, longitude: point.longitude } } : null;
}
