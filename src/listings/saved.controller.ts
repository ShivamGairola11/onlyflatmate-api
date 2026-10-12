import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import type { SavedListing } from '@/features/listings/types';
import { invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { ListingsService } from './listings.service.js';

const toSaved = (r: { id: string; user_id: string; listing_id: string; saved_at: Date }): SavedListing => ({
  id: r.id,
  userId: r.user_id,
  listingId: r.listing_id,
  savedAt: new Date(r.saved_at).toISOString(),
});

/** A shortlist, not a copy of the catalogue. */
const MAX_SAVED = 200;

@Controller('saved')
export class SavedController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
  ) {}

  /** Ids only — cheap, for the heart icons everywhere. */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return (await this.db.selectFrom('saved_listings').selectAll().where('user_id', '=', user.id).orderBy('saved_at', 'desc').limit(MAX_SAVED).execute()).map(toSaved);
  }

  /** The shortlist page: the saved listings themselves, newest save first. */
  @Get('listings')
  async details(@CurrentUser() user: AuthUser) {
    const ids = await this.db.selectFrom('saved_listings').select('listing_id').where('user_id', '=', user.id).orderBy('saved_at', 'desc').limit(MAX_SAVED).execute();
    return this.listings.getMany(ids.map((r) => r.listing_id));
  }

  @Post()
  async save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { listingId } = z.object({ listingId: z.uuid() }).parse(body);
    const exists = await this.db.selectFrom('listings').select('id').where('id', '=', listingId).where('status', '!=', 'REMOVED').executeTakeFirst();
    if (!exists) throw notFound('Listing not found');
    const { n } = await this.db.selectFrom('saved_listings').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', user.id).executeTakeFirstOrThrow();
    if (Number(n) >= MAX_SAVED) throw invalid(`You can save up to ${MAX_SAVED} places. Remove a few to save more.`);
    // Saving twice is fine: return the existing row.
    await this.db.insertInto('saved_listings').values({ user_id: user.id, listing_id: listingId }).onConflict((oc) => oc.columns(['user_id', 'listing_id']).doNothing()).execute();
    return toSaved(await this.db.selectFrom('saved_listings').selectAll().where('user_id', '=', user.id).where('listing_id', '=', listingId).executeTakeFirstOrThrow());
  }

  @Delete(':listingId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('listingId', new ParseUUIDPipe()) listingId: string) {
    await this.db.deleteFrom('saved_listings').where('user_id', '=', user.id).where('listing_id', '=', listingId).execute();
  }
}
