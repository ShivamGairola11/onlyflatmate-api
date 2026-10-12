import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { EditableListing, Listing, ListingDraftRecord } from '@/features/listings/types';
import type { ImportedListing } from '@/lib/api/contract';
import type { ListingDraft } from '@/lib/validation/listing';
import { forbidden, invalid, notFound } from '../common/api-error.js';
import { fuzzedPointSql, latOf, lngOf, pointSql } from '../common/geo.js';
import { type AppDB, type Database, InjectDb } from '../db/db.module.js';
import { PlacesService } from '../places/places.service.js';
import { parseListingText } from './listing-import.js';
import type { ListingInput } from './listing-input.js';
import { ListingsService } from './listings.service.js';

/** Radius (m) of the public, fuzzed point around the exact one. */
const PRIVACY_RADIUS_M = 350;
const BHK_TEXT = { '1RK': '1 RK', '1BHK': '1 BHK', '2BHK': '2 BHK', '3BHK': '3 BHK', '4BHK_PLUS': '4+ BHK' } as const;
const TYPE_TEXT = { PRIVATE_ROOM: 'Private room', SHARED_ROOM: 'Shared room', ENTIRE_FLAT: 'Entire flat', FLATMATE_VACANCY: 'Flatmate vacancy', PG: 'PG' } as const;

const autoTitle = (i: Pick<ListingInput, 'type' | 'property'>) =>
  i.type === 'ENTIRE_FLAT' ? `${BHK_TEXT[i.property.bhk]} flat` : `${TYPE_TEXT[i.type]} in a ${BHK_TEXT[i.property.bhk]}`;

/** Creating and changing listings. Every write checks ownership here — the browser is never trusted. */
@Injectable()
export class ListingEditorService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
    private readonly places: PlacesService,
  ) {}

  /** Loads a listing the user owns, or throws. */
  private async own(id: string, userId: string) {
    const row = await this.db.selectFrom('listings').select(['id', 'lister_id']).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Listing not found');
    if (row.lister_id !== userId) throw forbidden('Only the lister can change this listing.');
    return row;
  }

  /** Photos may only be ones this user uploaded (or already on the listing being edited). */
  private async photoIds(trx: Transaction<AppDB>, userId: string, urls: string[]) {
    if (!urls.length) return [];
    const rows = await trx.selectFrom('photos').select(['id', 'url']).where('owner_id', '=', userId).where('status', '=', 'READY').where('url', 'in', urls).execute();
    const byUrl = new Map(rows.map((r) => [r.url, r.id]));
    const missing = urls.filter((u) => !byUrl.has(u));
    if (missing.length) throw invalid('One of the photos wasn’t uploaded from your account. Please upload it again.');
    return urls.map((u) => byUrl.get(u)!);
  }

  /** Columns shared by create and update. */
  private async columns(input: ListingInput) {
    const near = await this.places.nearestLocality(input.exactLocation);
    return {
      type: input.type,
      title: input.title || autoTitle(input),
      description: input.description ?? '',
      locality: input.exactLocation.locality ?? near.name,
      city: near.city,
      bhk: input.property.bhk,
      building_type: input.property.buildingType,
      building_type_other: input.property.buildingType === 'OTHER' ? input.property.buildingTypeOther : null,
      bedrooms: input.property.bedrooms,
      bathrooms: input.property.bathrooms,
      furnishing: input.property.furnishing,
      floor: input.property.floor ?? null,
      total_floors: input.property.totalFloors ?? null,
      area_sqft: input.property.areaSqft ?? null,
      amenities: input.property.amenities,
      room: input.room ? JSON.stringify(input.room) : null,
      rent: input.pricing.rent,
      maintenance: input.pricing.maintenance,
      deposit: input.pricing.deposit,
      brokerage: input.pricing.brokerage,
      electricity_included: input.pricing.electricityIncluded,
      extras: JSON.stringify(input.pricing.extras ?? []),
      flatmates: JSON.stringify(input.flatmates),
      pref_gender: input.preference.gender,
      pref_age_min: input.preference.ageMin ?? null,
      pref_age_max: input.preference.ageMax ?? null,
      pref_occupation: input.preference.occupation,
      pref_lifestyle: input.preference.lifestyle,
      available_from: input.availableFrom.slice(0, 10),
    };
  }

  private async setPhotos(trx: Transaction<AppDB>, listingId: string, userId: string, urls: string[]) {
    const ids = await this.photoIds(trx, userId, urls);
    await trx.deleteFrom('listing_photos').where('listing_id', '=', listingId).execute();
    if (ids.length) await trx.insertInto('listing_photos').values(ids.map((photo_id, position) => ({ listing_id: listingId, photo_id, position }))).execute();
  }

  async create(userId: string, input: ListingInput): Promise<Listing> {
    const id = randomUUID();
    const cols = await this.columns(input);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('listings')
        .values({ id, lister_id: userId, source: input.source ?? 'PLATFORM', public_point: fuzzedPointSql(input.exactLocation, PRIVACY_RADIUS_M, id), location_precision_m: PRIVACY_RADIUS_M, ...cols })
        .execute();
      await trx.insertInto('listing_private_locations').values({ listing_id: id, exact_point: pointSql(input.exactLocation), address_line: input.addressLine }).execute();
      await this.setPhotos(trx, id, userId, input.photos);
      await trx.updateTable('profiles').set({ mode: 'OFFERING' }).where('user_id', '=', userId).execute();
    });
    return (await this.listings.getMany([id]))[0];
  }

  async editable(id: string, userId: string): Promise<EditableListing> {
    await this.own(id, userId);
    const priv = await this.db
      .selectFrom('listing_private_locations')
      .select([latOf('exact_point').as('lat'), lngOf('exact_point').as('lng'), 'address_line'])
      .where('listing_id', '=', id)
      .executeTakeFirst();
    if (!priv) throw notFound('Listing location not found');
    const [listing] = await this.listings.getMany([id]);
    return { listing, exactLocation: { latitude: priv.lat, longitude: priv.lng, locality: listing.location.locality, city: listing.location.city }, addressLine: priv.address_line ?? undefined };
  }

  async update(id: string, userId: string, input: ListingInput): Promise<Listing> {
    await this.own(id, userId);
    const prev = await this.db.selectFrom('listing_private_locations').select([latOf('exact_point').as('lat'), lngOf('exact_point').as('lng')]).where('listing_id', '=', id).executeTakeFirst();
    // Re-fuzz only if the pin moved, so the public point doesn't jump on every edit.
    const moved = !prev || prev.lat !== input.exactLocation.latitude || prev.lng !== input.exactLocation.longitude;
    const cols = await this.columns(input);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('listings')
        .set({ ...cols, ...(moved && { public_point: fuzzedPointSql(input.exactLocation, PRIVACY_RADIUS_M, id) }), updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('listing_private_locations')
        .values({ listing_id: id, exact_point: pointSql(input.exactLocation), address_line: input.addressLine })
        .onConflict((oc) => oc.column('listing_id').doUpdateSet({ exact_point: pointSql(input.exactLocation), address_line: input.addressLine ?? null }))
        .execute();
      await this.setPhotos(trx, id, userId, input.photos);
    });
    return (await this.listings.getMany([id]))[0];
  }

  async remove(id: string, userId: string) {
    await this.own(id, userId);
    // Saved entries, photos links and the private location go with it (ON DELETE CASCADE).
    await this.db.deleteFrom('listings').where('id', '=', id).execute();
  }

  async confirmAvailability(id: string, userId: string): Promise<Listing> {
    await this.own(id, userId);
    await this.db.updateTable('listings').set({ status: 'ACTIVE', last_confirmed_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    return (await this.listings.getMany([id]))[0];
  }

  async markOccupied(id: string, userId: string): Promise<Listing> {
    await this.own(id, userId);
    await this.db.updateTable('listings').set({ status: 'OCCUPIED', updated_at: new Date() }).where('id', '=', id).execute();
    return (await this.listings.getMany([id]))[0];
  }

  async importFromText(text: string): Promise<ImportedListing> {
    return parseListingText(text, await this.places.localities());
  }

  // ---- The one in-progress "Have a Place" draft per user ----

  async draft(userId: string): Promise<ListingDraftRecord | null> {
    const row = await this.db.selectFrom('listing_drafts').selectAll().where('user_id', '=', userId).executeTakeFirst();
    return row ? { userId: row.user_id, values: row.values as Partial<ListingDraft>, updatedAt: new Date(row.updated_at).toISOString() } : null;
  }

  async saveDraft(userId: string, values: Partial<ListingDraft>): Promise<ListingDraftRecord> {
    const now = new Date();
    await this.db
      .insertInto('listing_drafts')
      .values({ user_id: userId, values: JSON.stringify(values), updated_at: now })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ values: JSON.stringify(values), updated_at: now }))
      .execute();
    return { userId, values, updatedAt: now.toISOString() };
  }

  async discardDraft(userId: string) {
    await this.db.deleteFrom('listing_drafts').where('user_id', '=', userId).execute();
  }
}
