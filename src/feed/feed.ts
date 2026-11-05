import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { FeedComment, FeedLikeState, FeedPage, FeedPerson } from '@/features/feed/types';
import { MAX_COMMENT_LENGTH } from '@/features/feed/types';
import { getCity } from '@/lib/constants/places';
import { forbidden, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser, OptionalUser, Public } from '../common/auth.js';
import { assertNoContactInfo } from '../common/contact-info.js';
import { RateLimit } from '../common/rate-limit.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { ListingsService } from '../listings/listings.service.js';

/** Enough to read the thread; a busy listing's older comments drop off the end. */
const MAX_COMMENTS = 100;

const feedQuery = z.object({
  city: z.string().refine((c) => !!getCity(c), 'Pick a city.'),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});
const commentBody = z.object({ body: z.string().trim().min(1, 'Write something first.').max(MAX_COMMENT_LENGTH, `Keep it under ${MAX_COMMENT_LENGTH} characters.`) });

/**
 * The feed: the newest live listings in a metro, shown as posts people can like and comment on.
 * Listing search does the picking (live only, blocks both ways, the public trim when signed out);
 * this adds who posted, and the likes and comments.
 */
@Injectable()
export class FeedService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
  ) {}

  private async people(ids: string[]): Promise<Map<string, FeedPerson>> {
    if (!ids.length) return new Map();
    const rows = await this.db.selectFrom('profiles').select(['user_id', 'display_name', 'avatar_url']).where('user_id', 'in', [...new Set(ids)]).execute();
    return new Map(rows.map((r) => [r.user_id, { id: r.user_id, name: r.display_name.split(' ')[0] || 'Member', avatarUrl: r.avatar_url ?? undefined }]));
  }

  /** Comments and likes only on listings people can see: not removed. */
  private async visibleListing(id: string) {
    const row = await this.db.selectFrom('listings').select(['id', 'lister_id']).where('id', '=', id).where('status', '!=', 'REMOVED').executeTakeFirst();
    if (!row) throw notFound('This listing doesn’t exist or has been removed.');
    return row;
  }

  private async likeState(listingId: string, viewerId?: string): Promise<FeedLikeState> {
    const [count, mine] = await Promise.all([
      this.db.selectFrom('listing_likes').select((eb) => eb.fn.countAll<string>().as('n')).where('listing_id', '=', listingId).executeTakeFirstOrThrow(),
      viewerId ? this.db.selectFrom('listing_likes').select('user_id').where('listing_id', '=', listingId).where('user_id', '=', viewerId).executeTakeFirst() : undefined,
    ]);
    return { likes: Number(count.n), likedByMe: !!mine };
  }

  async list(q: z.infer<typeof feedQuery>, viewerId?: string): Promise<FeedPage> {
    const city = getCity(q.city)!;
    const page = await this.listings.search({ bounds: city.bounds, sort: 'NEWEST', cursor: q.cursor, limit: q.limit ?? 10 }, viewerId);
    const ids = page.items.map((l) => l.id);
    if (!ids.length) return { items: [], nextCursor: page.nextCursor };
    const [posters, likes, comments, mine] = await Promise.all([
      this.people(page.items.map((l) => l.listerId)),
      this.db.selectFrom('listing_likes').select(['listing_id', (eb) => eb.fn.countAll<string>().as('n')]).where('listing_id', 'in', ids).groupBy('listing_id').execute(),
      this.db.selectFrom('listing_comments').select(['listing_id', (eb) => eb.fn.countAll<string>().as('n')]).where('listing_id', 'in', ids).groupBy('listing_id').execute(),
      viewerId ? this.db.selectFrom('listing_likes').select('listing_id').where('listing_id', 'in', ids).where('user_id', '=', viewerId).execute() : [],
    ]);
    const likeCount = new Map(likes.map((r) => [r.listing_id, Number(r.n)]));
    const commentCount = new Map(comments.map((r) => [r.listing_id, Number(r.n)]));
    const liked = new Set(mine.map((r) => r.listing_id));
    return {
      items: page.items.map((listing) => ({
        listing,
        poster: posters.get(listing.listerId) ?? { id: listing.listerId, name: 'Member' },
        postedAt: listing.createdAt,
        likes: likeCount.get(listing.id) ?? 0,
        comments: commentCount.get(listing.id) ?? 0,
        likedByMe: liked.has(listing.id),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async like(listingId: string, userId: string) {
    await this.visibleListing(listingId);
    await this.db.insertInto('listing_likes').values({ listing_id: listingId, user_id: userId }).onConflict((oc) => oc.columns(['listing_id', 'user_id']).doNothing()).execute();
    return this.likeState(listingId, userId);
  }

  async unlike(listingId: string, userId: string) {
    await this.db.deleteFrom('listing_likes').where('listing_id', '=', listingId).where('user_id', '=', userId).execute();
    return this.likeState(listingId, userId);
  }

  /** The newest comments, shown oldest first. Comments by people the viewer blocked (or who blocked them) are left out. */
  async comments(listingId: string, viewerId?: string): Promise<FeedComment[]> {
    const listing = await this.visibleListing(listingId);
    const rows = await this.db
      .selectFrom('listing_comments')
      .selectAll()
      .where('listing_id', '=', listingId)
      .$if(!!viewerId, (q) =>
        q.where('author_id', 'not in', (eb) =>
          eb.selectFrom('blocks').select('blocked_user_id as id').where('blocker_id', '=', viewerId!).union(eb.selectFrom('blocks').select('blocker_id as id').where('blocked_user_id', '=', viewerId!)),
        ),
      )
      .orderBy('created_at', 'desc')
      .limit(MAX_COMMENTS)
      .execute();
    const authors = await this.people(rows.map((r) => r.author_id));
    return rows.reverse().map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      author: authors.get(r.author_id) ?? { id: r.author_id, name: 'Member' },
      body: r.body,
      createdAt: new Date(r.created_at).toISOString(),
      canDelete: !!viewerId && (r.author_id === viewerId || listing.lister_id === viewerId),
    }));
  }

  async addComment(listingId: string, userId: string, body: string): Promise<FeedComment> {
    await this.visibleListing(listingId);
    assertNoContactInfo(body);
    const row = await this.db.insertInto('listing_comments').values({ listing_id: listingId, author_id: userId, body }).returningAll().executeTakeFirstOrThrow();
    const author = (await this.people([userId])).get(userId) ?? { id: userId, name: 'Member' };
    return { id: row.id, listingId, author, body: row.body, createdAt: new Date(row.created_at).toISOString(), canDelete: true };
  }

  /** Its author, or the lister tidying their own listing. */
  async removeComment(commentId: string, userId: string) {
    const row = await this.db
      .selectFrom('listing_comments as c')
      .innerJoin('listings as l', 'l.id', 'c.listing_id')
      .select(['c.author_id', 'l.lister_id'])
      .where('c.id', '=', commentId)
      .executeTakeFirst();
    if (!row) throw notFound('That comment was already deleted.');
    if (row.author_id !== userId && row.lister_id !== userId) throw forbidden('You can only delete your own comments.');
    await this.db.deleteFrom('listing_comments').where('id', '=', commentId).execute();
  }
}

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Public()
  @RateLimit(60, 60)
  @Get('feed')
  list(@Query() query: unknown, @OptionalUser() user?: AuthUser) {
    return this.feed.list(feedQuery.parse(query), user?.id);
  }

  @RateLimit(120, 60)
  @Post('listings/:id/like')
  like(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.feed.like(id, user.id);
  }

  @RateLimit(120, 60)
  @Delete('listings/:id/like')
  unlike(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.feed.unlike(id, user.id);
  }

  @Public()
  @RateLimit(60, 60)
  @Get('listings/:id/comments')
  comments(@Param('id', new ParseUUIDPipe()) id: string, @OptionalUser() user?: AuthUser) {
    return this.feed.comments(id, user?.id);
  }

  /** 30 an hour: plenty for a conversation, too few to spam every listing. */
  @RateLimit(30, 3600)
  @Post('listings/:id/comments')
  addComment(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = commentBody.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Write a comment.');
    return this.feed.addComment(id, user.id, parsed.data.body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  removeComment(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.feed.removeComment(id, user.id);
  }
}
