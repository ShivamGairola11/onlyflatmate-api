import { Injectable } from '@nestjs/common';
import { type ExpressionBuilder, sql, type SqlBool, type Expression } from 'kysely';
import type { ListingPinsResult, ListingSearchResult, PageParams, PublicUser, SearchFocus } from '@/lib/api/contract';
import type { Listing, ListingPhoto, ListingSearchParams } from '@/features/listings/types';
import { forbidden, notFound } from '../common/api-error.js';
import { CommuteService } from '../commute/commute.service.js';
import { type AppDB, type Database, InjectDb } from '../db/db.module.js';
import type { Listings } from '../db/schema.js';
import { deriveStatus, EXPIRE_AFTER_HOURS, STALE_AFTER_HOURS, type ListingRow, toListing } from './listing.mapper.js';

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
/** Past this many matches the map asks people to zoom in. */
const MAX_PINS = 500;
/** Matches considered when a workplace is set (each needs a commute, i.e. routing calls). */
const MAX_COMMUTE_CANDIDATES = 300;
/**
 * How deep a search can be paged. Signed out, browsing is generous but bulk-copying the catalogue isn't:
 * past this the list just ends (with sign-in, and rate limits per account, for more).
 */
const MAX_RESULTS_SIGNED_OUT = 120;
const MAX_RESULTS_SIGNED_IN = 1000;

type Eb = ExpressionBuilder<AppDB & { l: Listings }, 'l'>;

const lat = sql<number>`extensions.st_y(l.public_point::extensions.geometry)`.as('lat');
const lng = sql<number>`extensions.st_x(l.public_point::extensions.geometry)`.as('lng');

const DAY_MS = 86_400_000;
function moveInCutoff(p: ListingSearchParams): string | undefined {
  const days = { IMMEDIATE: 2, '15_DAYS': 15, '30_DAYS': 30 } as const;
  if (p.moveIn && p.moveIn in days) return new Date(Date.now() + days[p.moveIn as keyof typeof days] * DAY_MS).toISOString().slice(0, 10);
  if (p.moveIn === 'CUSTOM' && p.moveInDate) return new Date(new Date(p.moveInDate).getTime() + DAY_MS).toISOString().slice(0, 10);
  return undefined;
}

@Injectable()
export class ListingsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly commute: CommuteService,
  ) {}

  /** Area searches are a circle around the locality, a bit wider than the locality itself. */
  private async areaFocus(slug: string | undefined): Promise<SearchFocus | undefined> {
    if (!slug) return undefined;
    const a = await this.db
      .selectFrom('localities')
      .select(['name', 'radius_km', sql<number>`extensions.st_y(point::extensions.geometry)`.as('lat'), sql<number>`extensions.st_x(point::extensions.geometry)`.as('lng')])
      .where('slug', '=', slug)
      .executeTakeFirst();
    return a && { latitude: a.lat, longitude: a.lng, label: a.name, radiusKm: Math.max(Number(a.radius_km) * 1.8, 2.5) };
  }

  /** The WHERE clause shared by the list and the map, so they always agree. */
  private where(p: ListingSearchParams, focus: SearchFocus | undefined, viewerId: string | undefined) {
    const cutoff = moveInCutoff(p);
    return (eb: Eb): Expression<SqlBool> => {
      const and: Expression<SqlBool>[] = [];
      if (!p.includeInactive) {
        and.push(eb('l.status', '=', 'ACTIVE'));
        and.push(sql<SqlBool>`l.last_confirmed_at > now() - make_interval(hours => ${EXPIRE_AFTER_HOURS})`);
      }
      if (p.minRent !== undefined) and.push(eb('l.rent', '>=', p.minRent));
      if (p.maxRent !== undefined) and.push(eb('l.rent', '<=', p.maxRent));
      if (p.types?.length) and.push(eb('l.type', 'in', p.types));
      if (p.bhk?.length) and.push(eb('l.bhk', 'in', p.bhk));
      if (p.furnishing?.length) and.push(eb('l.furnishing', 'in', p.furnishing));
      if (p.buildingTypes?.length) and.push(eb('l.building_type', 'in', p.buildingTypes));
      if (p.amenities?.length) and.push(sql<SqlBool>`l.amenities @> ${sql.val(p.amenities)}::text[]`);
      if (p.gender && p.gender !== 'ANY') and.push(eb('l.pref_gender', 'in', ['ANY', p.gender]));
      if (cutoff) and.push(eb('l.available_from', '<=', cutoff as never));
      if (p.bounds) {
        const { west, south, east, north } = p.bounds;
        and.push(sql<SqlBool>`extensions.st_intersects(l.public_point, extensions.st_makeenvelope(${west}, ${south}, ${east}, ${north}, 4326)::extensions.geography)`);
      }
      if (focus) {
        and.push(sql<SqlBool>`extensions.st_dwithin(l.public_point, extensions.st_setsrid(extensions.st_makepoint(${focus.longitude}, ${focus.latitude}), 4326)::extensions.geography, ${focus.radiusKm * 1000})`);
      }
      if (viewerId) {
        // Blocks hide people both ways.
        and.push(eb('l.lister_id', 'not in', eb.selectFrom('blocks').select('blocked_user_id').where('blocker_id', '=', viewerId)));
        and.push(eb('l.lister_id', 'not in', eb.selectFrom('blocks').select('blocker_id').where('blocked_user_id', '=', viewerId)));
      }
      return eb.and(and);
    };
  }

  private async photosFor(ids: string[]): Promise<Map<string, ListingPhoto[]>> {
    const out = new Map<string, ListingPhoto[]>();
    if (!ids.length) return out;
    const rows = await this.db
      .selectFrom('listing_photos as lp')
      .innerJoin('photos as p', 'p.id', 'lp.photo_id')
      .select(['lp.listing_id', 'p.id', 'p.url'])
      .where('lp.listing_id', 'in', ids)
      .orderBy('lp.position')
      .execute();
    for (const r of rows) out.set(r.listing_id, [...(out.get(r.listing_id) ?? []), { id: r.id, url: r.url }]);
    return out;
  }

  private async hydrate(rows: ListingRow[]): Promise<Listing[]> {
    const photos = await this.photosFor(rows.map((r) => r.id));
    return rows.map((r) => toListing(r, photos.get(r.id) ?? []));
  }

  /** Recommended order: fresh check-ins first, then a shorter commute when there's a workplace. */
  private recommendedScore(lastConfirmedAt: Date | string, bestMinutes?: number) {
    const hours = (Date.now() - new Date(lastConfirmedAt).getTime()) / 3_600_000;
    const freshness = Math.max(0, 1 - hours / STALE_AFTER_HOURS);
    return freshness * 2 + (hours <= STALE_AFTER_HOURS ? 1 : 0) + (bestMinutes === undefined ? 0 : 1 - Math.min(bestMinutes, 90) / 90);
  }

  /**
   * With a workplace, every match needs a commute before it can be filtered by
   * `maxCommuteMinutes` or sorted by it, so matches are ranked in memory.
   * ponytail: fine for thousands of matches per search; precompute commutes per
   * (H3 cell, destination) in Postgres when it isn't.
   */
  private async rankedByCommute(p: ListingSearchParams, where: ReturnType<ListingsService['where']>) {
    const rows = await this.db
      .selectFrom('listings as l')
      .select(['l.id', 'l.rent', 'l.created_at', 'l.last_confirmed_at', lat, lng])
      .where(where)
      .limit(MAX_COMMUTE_CANDIDATES)
      .execute();
    const commutes = await this.commute.forOrigins(rows.map((r) => ({ id: r.id, location: { latitude: r.lat, longitude: r.lng } })), p.workplaceId!);
    const ranked = rows
      .map((r) => ({ ...r, commute: commutes.get(r.id) }))
      .filter((r) => !p.maxCommuteMinutes || (r.commute && r.commute.bestMinutes <= p.maxCommuteMinutes));
    const by: Record<string, (a: (typeof ranked)[number], b: (typeof ranked)[number]) => number> = {
      PRICE_ASC: (a, b) => a.rent - b.rent,
      PRICE_DESC: (a, b) => b.rent - a.rent,
      NEWEST: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
      COMMUTE: (a, b) => (a.commute?.bestMinutes ?? 999) - (b.commute?.bestMinutes ?? 999),
    };
    return ranked.sort(by[p.sort ?? ''] ?? ((a, b) => this.recommendedScore(b.last_confirmed_at, b.commute?.bestMinutes) - this.recommendedScore(a.last_confirmed_at, a.commute?.bestMinutes)));
  }

  async search(p: ListingSearchParams & PageParams, viewerId?: string): Promise<ListingSearchResult> {
    const focus = await this.areaFocus(p.area);
    const where = this.where(p, focus, viewerId);
    const cap = viewerId ? MAX_RESULTS_SIGNED_IN : MAX_RESULTS_SIGNED_OUT;
    // The cursor is client-supplied: only a whole number inside the cap is accepted.
    const decoded = p.cursor ? Math.trunc(Number(Buffer.from(p.cursor, 'base64url').toString())) : 0;
    const offset = Number.isFinite(decoded) ? Math.min(Math.max(decoded, 0), cap) : 0;
    const size = Math.max(0, Math.min(Math.max(p.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE, cap - offset));
    const page = (end: number, total: number) => (end < Math.min(total, cap) ? Buffer.from(String(end)).toString('base64url') : undefined);

    if (p.workplaceId) {
      const ranked = await this.rankedByCommute(p, where);
      const slice = ranked.slice(offset, offset + size);
      const rows = slice.length ? await this.db.selectFrom('listings as l').selectAll('l').select([lat, lng]).where('l.id', 'in', slice.map((r) => r.id)).execute() : [];
      const byId = new Map((await this.hydrate(rows)).map((l) => [l.id, l]));
      const items = slice.map((r) => ({ ...byId.get(r.id)!, commute: r.commute }));
      return { items, total: ranked.length, nextCursor: page(offset + slice.length, ranked.length), focus };
    }

    let q = this.db.selectFrom('listings as l').selectAll('l').select([lat, lng]).where(where);
    switch (p.sort) {
      case 'PRICE_ASC': q = q.orderBy('l.rent', 'asc'); break;
      case 'PRICE_DESC': q = q.orderBy('l.rent', 'desc'); break;
      case 'NEWEST': q = q.orderBy('l.created_at', 'desc'); break;
      default:
        q = q.orderBy(sql`greatest(0, 1 - extract(epoch from now() - l.last_confirmed_at) / 3600 / ${STALE_AFTER_HOURS}) * 2 + (case when l.last_confirmed_at > now() - make_interval(hours => ${STALE_AFTER_HOURS}) then 1 else 0 end)`, 'desc');
    }
    const [rows, count] = await Promise.all([
      q.orderBy('l.id').limit(size).offset(offset).execute(),
      this.db.selectFrom('listings as l').select((eb) => eb.fn.countAll<string>().as('n')).where(where).executeTakeFirstOrThrow(),
    ]);
    const total = Number(count.n);
    return { items: await this.hydrate(rows), total, nextCursor: page(offset + rows.length, total), focus };
  }

  async pins(p: ListingSearchParams, viewerId?: string): Promise<ListingPinsResult> {
    const focus = await this.areaFocus(p.area);
    const where = this.where(p, focus, viewerId);
    let rows = await this.db
      .selectFrom('listings as l')
      .select(['l.id', 'l.type', 'l.status', 'l.rent', 'l.locality', 'l.city', 'l.last_confirmed_at', lat, lng])
      .where(where)
      .orderBy('l.last_confirmed_at', 'desc')
      .limit(p.workplaceId ? MAX_COMMUTE_CANDIDATES : MAX_PINS + 1)
      .execute();

    const commutes = p.workplaceId ? await this.commute.forOrigins(rows.map((r) => ({ id: r.id, location: { latitude: r.lat, longitude: r.lng } })), p.workplaceId) : undefined;
    if (commutes && p.maxCommuteMinutes) rows = rows.filter((r) => (commutes.get(r.id)?.bestMinutes ?? Infinity) <= p.maxCommuteMinutes!);
    const total = p.workplaceId ? rows.length : Number((await this.db.selectFrom('listings as l').select((eb) => eb.fn.countAll<string>().as('n')).where(where).executeTakeFirstOrThrow()).n);

    return {
      pins: rows.slice(0, MAX_PINS).map((r) => {
        const c = commutes?.get(r.id);
        return {
          id: r.id,
          type: r.type as Listing['type'],
          status: deriveStatus(r.status, r.last_confirmed_at),
          location: { latitude: r.lat, longitude: r.lng, locality: r.locality ?? undefined, city: r.city ?? undefined },
          pricing: { rent: r.rent },
          commute: c && { destinationId: c.destinationId, bestMinutes: c.bestMinutes, quality: c.quality },
        };
      }),
      total,
      truncated: total > MAX_PINS,
      focus,
    };
  }

  async get(id: string, viewerId?: string): Promise<{ listing: Listing; lister: PublicUser; isOwner: boolean }> {
    const row = await this.db.selectFrom('listings as l').selectAll('l').select([lat, lng]).where('l.id', '=', id).executeTakeFirst();
    // Taken down by moderators: gone for everyone but the lister.
    if (!row || (row.status === 'REMOVED' && viewerId !== row.lister_id)) throw notFound('This listing doesn’t exist or has been removed.');
    if (viewerId && viewerId !== row.lister_id) {
      const blocked = await this.db
        .selectFrom('blocks')
        .select('id')
        .where((eb) => eb.or([eb.and([eb('blocker_id', '=', viewerId), eb('blocked_user_id', '=', row.lister_id)]), eb.and([eb('blocker_id', '=', row.lister_id), eb('blocked_user_id', '=', viewerId)])]))
        .executeTakeFirst();
      if (blocked) throw forbidden('You’ve blocked this lister.');
      await this.db.updateTable('listings').set((eb) => ({ view_count: eb('view_count', '+', 1) })).where('id', '=', id).execute();
    }
    const [listing] = await this.hydrate([row]);
    return { listing, lister: await this.publicUser(row.lister_id), isOwner: viewerId === row.lister_id };
  }

  /** Public batch read. `includeRemoved` only for the owner's own just-edited listing. */
  async getMany(ids: string[], includeRemoved = false): Promise<Listing[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .selectFrom('listings as l')
      .selectAll('l')
      .select([lat, lng])
      .where('l.id', 'in', ids)
      .$if(!includeRemoved, (q) => q.where('l.status', '!=', 'REMOVED'))
      .execute();
    const byId = new Map((await this.hydrate(rows)).map((l) => [l.id, l]));
    return ids.map((id) => byId.get(id)).filter((l): l is Listing => !!l);
  }

  async mine(userId: string): Promise<Listing[]> {
    const rows = await this.db.selectFrom('listings as l').selectAll('l').select([lat, lng]).where('l.lister_id', '=', userId).orderBy('l.created_at', 'desc').execute();
    return this.hydrate(rows);
  }

  /** What other people may see about a user. */
  async publicUser(userId: string): Promise<PublicUser> {
    const p = await this.db.selectFrom('profiles').select(['user_id', 'display_name', 'age', 'profession', 'created_at']).where('user_id', '=', userId).executeTakeFirst();
    if (!p) throw notFound('User not found');
    const verified = await this.db.selectFrom('verifications').select('type').where('user_id', '=', userId).where('status', '=', 'VERIFIED').execute();
    const has = (t: string) => verified.some((v) => v.type === t);
    return {
      id: p.user_id,
      firstName: p.display_name.split(' ')[0] || 'Member',
      age: p.age ?? undefined,
      profession: p.profession || undefined,
      memberSince: new Date(p.created_at).toISOString(),
      verified: { phone: has('PHONE'), identity: has('IDENTITY') },
      // ponytail: static label; compute from real reply times once messaging has history.
      responseTimeLabel: 'Usually replies within a few hours',
    };
  }
}
