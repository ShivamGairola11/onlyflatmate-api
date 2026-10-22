import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { sql } from 'kysely';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';

/**
 * Who sees what (business-logic skill → "Who sees what"). Runs against the local Supabase database
 * (`npm run db:start` + `npm run db:reset`). Creates its own fresh listings and removes them afterwards.
 */
const TAG = 'e2e-access-clone';
const CLONES = 130; // past the old 120-result signed-out cap

describe('Access policy (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let listingId: string;
  let listerId: string;
  let viewer: string;
  let viewerToken: string;
  const http = () => request(app.getHttpServer());

  const tokenFor = (sub: string) =>
    new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(config.SUPABASE_JWT_SECRET!));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);

    // A listing with residents whose lister has a profession, cloned into fresh, ACTIVE copies.
    const template = await sql<{ id: string; lister_id: string }>`
      select l.id, l.lister_id from listings l join profiles p on p.user_id = l.lister_id
      where jsonb_array_length(coalesce(l.flatmates, '[]'::jsonb)) > 0 and coalesce(p.profession, '') <> '' limit 1`.execute(db);
    const t = template.rows[0]!;
    listerId = t.lister_id;
    const cols = (await sql<{ c: string }>`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name not in ('id', 'title', 'status', 'last_confirmed_at', 'created_at', 'updated_at', 'view_count')`.execute(db)).rows.map((r) => sql.ref(r.c));
    await sql`insert into listings (${sql.join(cols)}, title, status, last_confirmed_at)
      select ${sql.join(cols)}, ${TAG}, 'ACTIVE', now() from listings, generate_series(1, ${CLONES}) where id = ${t.id}`.execute(db);
    listingId = (await db.selectFrom('listings').select('id').where('title', '=', TAG).executeTakeFirstOrThrow()).id;

    // A signed-in viewer who isn't the lister and holds no pass.
    viewer = (await sql<{ id: string }>`select u.id from auth.users u join profiles p on p.user_id = u.id where u.id <> ${listerId}
      and not exists (select 1 from contact_passes c where c.user_id = u.id and c.expires_at > now()) limit 1`.execute(db)).rows[0]!.id;
    viewerToken = await tokenFor(viewer);
  });

  afterAll(async () => {
    await db.deleteFrom('blocks').where('blocker_id', 'in', [viewer, listerId]).where('blocked_user_id', 'in', [viewer, listerId]).execute();
    await db.deleteFrom('listings').where('title', '=', TAG).execute();
    await app.close();
  });

  describe('listings are public', () => {
    it('serves the full property to a signed-out visitor, minus people details', async () => {
      const { body } = await http().get(`/listings/${listingId}`).expect(200);
      expect(body.listing.photos.length).toBeGreaterThanOrEqual(0);
      expect(body.listing.pricing.rent).toBeGreaterThan(0);
      expect(body.listing.property.amenities).toBeDefined();
      expect(body.listing).not.toHaveProperty('exactLocation');
      // Residents: age, gender, profession — no name, lifestyle or account id.
      for (const f of body.listing.flatmates) {
        expect(f.name).toBe('');
        expect(f.lifestyle).toEqual([]);
        expect(f).not.toHaveProperty('userId');
        expect(f.age).toBeGreaterThan(0);
      }
      // The lister: first name and badges only. Never a phone or email.
      expect(Object.keys(body.lister).sort()).toEqual(['firstName', 'id', 'memberSince', 'responseTimeLabel', 'verified']);
      expect(JSON.stringify(body)).not.toMatch(/"(phone|email)"\s*:\s*"/);
    });

    it('gives a signed-in viewer the residents and the lister’s profession', async () => {
      const { body } = await http().get(`/listings/${listingId}`).set('Authorization', `Bearer ${viewerToken}`).expect(200);
      expect(body.listing.flatmates[0].name).not.toBe('');
      expect(body.lister.profession).toBeTruthy();
    });

    it('pages a signed-out search past the old 120-result cap', async () => {
      const cursor = Buffer.from('120').toString('base64url');
      const { body } = await http().get(`/listings?limit=5&cursor=${cursor}`).expect(200);
      expect(body.total).toBeGreaterThanOrEqual(CLONES);
      expect(body.items).toHaveLength(5);
      expect(body.items[0].flatmates.every((f: { name: string }) => f.name === '')).toBe(true);
    });

    it('trims residents in the public batch read too', async () => {
      const { body } = await http().get(`/listings/batch?ids=${listingId}`).expect(200);
      expect(body[0].flatmates.every((f: { name: string }) => f.name === '')).toBe(true);
    });
  });

  describe('blocks', () => {
    it('hides a blocked lister’s listing from detail and batch, without saying who blocked whom', async () => {
      for (const [blocker, blocked] of [[viewer, listerId], [listerId, viewer]]) {
        await db.insertInto('blocks').values({ blocker_id: blocker, blocked_user_id: blocked }).execute();
        const res = await http().get(`/listings/${listingId}`).set('Authorization', `Bearer ${viewerToken}`).expect(404);
        expect(res.body.message).toBe('This listing doesn’t exist or has been removed.');
        const batch = await http().get(`/listings/batch?ids=${listingId}`).set('Authorization', `Bearer ${viewerToken}`).expect(200);
        expect(batch.body).toEqual([]);
        await db.deleteFrom('blocks').where('blocker_id', '=', blocker).where('blocked_user_id', '=', blocked).execute();
      }
    });
  });

  describe('people data needs sign-in, enforced here', () => {
    it('withholds flatmate bios, lifestyle, languages and work area from signed-out callers', async () => {
      const list = await http().get('/flatmates').expect(200);
      expect(list.body.length).toBeGreaterThan(0);
      for (const p of list.body) expect(p).toMatchObject({ userId: '', bio: '', workArea: '', languages: [], lifestyle: [] });
      const one = await http().get(`/flatmates/${list.body[0].id}`).expect(200);
      expect(one.body.bio).toBe('');
      const signedIn = await http().get(`/flatmates/${list.body[0].id}`).set('Authorization', `Bearer ${viewerToken}`).expect(200);
      expect(signedIn.body.bio).not.toBe('');
    });

    it('turns group members into anonymous seats for signed-out callers', async () => {
      const groups = await http().get('/groups').expect(200);
      const g = groups.body[0];
      const { body } = await http().get(`/groups/${g.id}`).expect(200);
      expect(body).toMatchObject({ ownerId: '', inviteCode: '' });
      expect(body.note).toBeUndefined();
      for (const m of body.members) expect(m).toMatchObject({ name: '', profession: '', budget: 0 });
      expect(body.members.length).toBe(g.members.length);
    });

    it('requires sign-in for group matches', async () => {
      const groups = await http().get('/groups').expect(200);
      await http().get(`/groups/${groups.body[0].id}/matches`).expect(401);
      await http().get(`/groups/${groups.body[0].id}/matches`).set('Authorization', `Bearer ${viewerToken}`).expect(200);
    });
  });

  describe('actions keep their gates', () => {
    it('needs sign-in to save or contact', async () => {
      await http().post('/saved').send({ listingId }).expect(401);
      await http().post('/conversations').send({ contextType: 'LISTING', contextId: listingId }).expect(401);
    });

    it('still needs a Contact Pass to start a conversation', async () => {
      const res = await http().post('/conversations').set('Authorization', `Bearer ${viewerToken}`).send({ contextType: 'LISTING', contextId: listingId }).expect(402);
      expect(res.body.code).toBe('CONTACT_PASS_REQUIRED');
    });
  });
});
