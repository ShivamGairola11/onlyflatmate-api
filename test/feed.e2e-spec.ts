import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { sql } from 'kysely';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';

/**
 * The feed: newest listings per metro as posts, with likes and comments (business-logic skill → "Feed").
 * Runs against the local Supabase database (`npm run db:start` + `npm run db:reset`) and cleans up after itself.
 */
describe('Feed (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let listingId: string;
  let listerId: string;
  let viewer: string;
  let viewerToken: string;
  let listerToken: string;
  const http = () => request(app.getHttpServer());
  const tokenFor = (sub: string) =>
    new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(config.SUPABASE_JWT_SECRET!));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
    // The newest live Delhi NCR listing is the first post in that feed.
    const { body } = await http().get('/feed?city=delhi-ncr&limit=1').expect(200);
    listingId = body.items[0].listing.id;
    listerId = body.items[0].listing.listerId;
    viewer = (await sql<{ id: string }>`select u.id from auth.users u join profiles p on p.user_id = u.id where u.id <> ${listerId} limit 1`.execute(db)).rows[0]!.id;
    viewerToken = await tokenFor(viewer);
    listerToken = await tokenFor(listerId);
  });

  afterAll(async () => {
    await db.deleteFrom('listing_likes').where('listing_id', '=', listingId).where('user_id', '=', viewer).execute();
    await db.deleteFrom('listing_comments').where('listing_id', '=', listingId).where('author_id', '=', viewer).execute();
    await app.close();
  });

  it('serves posts with their poster, newest first, to anyone', async () => {
    const { body } = await http().get('/feed?city=delhi-ncr&limit=5').expect(200);
    const dates = body.items.map((p: { postedAt: string }) => +new Date(p.postedAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(body.items[0].poster.name).toBeTruthy();
    expect(body.items[0]).toMatchObject({ likedByMe: false });
    await http().get('/feed?city=atlantis').expect(400);
  });

  it('likes once per person, and unlikes', async () => {
    const auth = { Authorization: `Bearer ${viewerToken}` };
    await http().post(`/listings/${listingId}/like`).expect(401);
    const first = (await http().post(`/listings/${listingId}/like`).set(auth).expect(201)).body;
    const again = (await http().post(`/listings/${listingId}/like`).set(auth).expect(201)).body;
    expect(again).toEqual(first);
    expect(first.likedByMe).toBe(true);
    const after = (await http().delete(`/listings/${listingId}/like`).set(auth).expect(200)).body;
    expect(after).toEqual({ likes: first.likes - 1, likedByMe: false });
  });

  it('takes comments without contact details; the author or the lister can delete them', async () => {
    const auth = { Authorization: `Bearer ${viewerToken}` };
    await http().post(`/listings/${listingId}/comments`).set(auth).send({ body: 'Call me on 98765 43210' }).expect(400);
    const mine = (await http().post(`/listings/${listingId}/comments`).set(auth).send({ body: 'Is it still available?' }).expect(201)).body;
    expect(mine).toMatchObject({ body: 'Is it still available?', canDelete: true });

    const thread = (await http().get(`/listings/${listingId}/comments`).expect(200)).body;
    expect(thread.at(-1)).toMatchObject({ id: mine.id, canDelete: false });

    const second = (await http().post(`/listings/${listingId}/comments`).set(auth).send({ body: 'And the deposit?' }).expect(201)).body;
    await http().delete(`/comments/${second.id}`).set({ Authorization: `Bearer ${listerToken}` }).expect(204);
    await http().delete(`/comments/${mine.id}`).set(auth).expect(204);
  });
});
