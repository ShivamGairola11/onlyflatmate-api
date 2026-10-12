import type { Selectable } from 'kysely';
import type { Flatmate, Listing, ListingPhoto, ListingStatus, Room } from '@/features/listings/types';
import type { Listings } from '../db/schema.js';

/** Freshness rule (mirrors src/lib/config/app.ts `listingFreshness`). */
export const STALE_AFTER_HOURS = 72;
export const EXPIRE_AFTER_HOURS = 24 * 14;

export type ListingRow = Selectable<Listings> & { lat: number; lng: number };

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

/** STALE / EXPIRED are derived from the last check-in, never stored. */
export function deriveStatus(stored: string, lastConfirmedAt: Date | string): ListingStatus {
  if (stored === 'OCCUPIED') return 'OCCUPIED';
  const hours = (Date.now() - new Date(lastConfirmedAt).getTime()) / 3_600_000;
  // REMOVED (moderation) is only ever shown to its owner, as expired.
  if (stored === 'EXPIRED' || stored === 'REMOVED' || hours > EXPIRE_AFTER_HOURS) return 'EXPIRED';
  return hours > STALE_AFTER_HOURS ? 'STALE' : 'ACTIVE';
}

/** A database row (plus its photos) as the contract's public `Listing`. Never includes the exact location. */
export function toListing(r: ListingRow, photos: ListingPhoto[]): Listing {
  return {
    id: r.id,
    listerId: r.lister_id,
    type: r.type as Listing['type'],
    source: r.source as Listing['source'],
    status: deriveStatus(r.status, r.last_confirmed_at),
    title: r.title,
    description: r.description,
    location: { latitude: r.lat, longitude: r.lng, locality: r.locality ?? undefined, city: r.city ?? undefined },
    locationPrecisionMeters: r.location_precision_m,
    property: {
      bhk: r.bhk as Listing['property']['bhk'],
      buildingType: r.building_type as Listing['property']['buildingType'],
      buildingTypeOther: r.building_type_other ?? undefined,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      furnishing: r.furnishing as Listing['property']['furnishing'],
      floor: r.floor ?? undefined,
      totalFloors: r.total_floors ?? undefined,
      areaSqft: r.area_sqft ?? undefined,
      amenities: r.amenities as Listing['property']['amenities'],
    },
    room: (r.room as Room | null) ?? undefined,
    pricing: { rent: r.rent, maintenance: r.maintenance, deposit: r.deposit, brokerage: r.brokerage, electricityIncluded: r.electricity_included, extras: (Array.isArray(r.extras) ? r.extras : []) as unknown as Listing['pricing']['extras'] },
    flatmates: ((r.flatmates as Omit<Flatmate, 'id'>[] | null) ?? []).map((f, i) => ({ ...f, id: `${r.id}_fm${i}` })),
    preference: {
      gender: r.pref_gender as Listing['preference']['gender'],
      ageMin: r.pref_age_min ?? undefined,
      ageMax: r.pref_age_max ?? undefined,
      occupation: r.pref_occupation as Listing['preference']['occupation'],
      lifestyle: r.pref_lifestyle as Listing['preference']['lifestyle'],
      note: r.pref_note ?? undefined,
    },
    availableFrom: new Date(`${r.available_from}T00:00:00.000Z`).toISOString(),
    photos,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    lastConfirmedAt: iso(r.last_confirmed_at),
    viewCount: r.view_count,
  };
}
