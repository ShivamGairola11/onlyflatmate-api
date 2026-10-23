import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';

/** First-party events → the admin funnel. Local Supabase; removes everything it creates. */
describe('Analytics events (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let adminId: string;
  let adminToken: string;
  const visitors = [randomUUID(), randomUUID(), randomUUID()];
  const supa = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const http = () => request(app.getHttpServer());
  const send = (body: object, token?: string) => {
    const r = http().post('/analytics/events').send(body);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
    const { data, error } = await supa.auth.admin.createUser({ email: `analytics-${Date.now()}@example.com`, email_confirm: true });
    if (error) throw error;
    adminId = data.user.id;
    await db.updateTable('profiles').set({ is_admin: true }).where('user_id', '=', adminId).execute();
    adminToken = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(adminId).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(config.SUPABASE_JWT_SECRET!));
  });

  afterAll(async () => {
    await db.deleteFrom('analytics_events').where('visitor_id', 'in', visitors).execute();
    if (adminId) await supa.auth.admin.deleteUser(adminId);
    await app.close();
  });

  it('records allowlisted events and props only; purchases can’t be reported from the browser', async () => {
    await send({ name: 'listing_view', visitorId: visitors[0], props: { listing_id: 'abc', signed_in: false, email: 'x@y.z', note: 'a'.repeat(100) } }).expect(204);
    await send({ name: 'pass_purchased', visitorId: visitors[0], props: {} }).expect(422);
    await send({ name: 'listing_view', visitorId: 'not-a-uuid' }).expect(422);
    const row = await db.selectFrom('analytics_events').selectAll().where('visitor_id', '=', visitors[0]!).executeTakeFirstOrThrow();
    expect(row.props).toEqual({ listing_id: 'abc', signed_in: false });
    expect(row.user_id).toBeNull();
  });

  it('ties a signed-in visitor’s event to the account', async () => {
    await send({ name: 'contact_click', visitorId: visitors[1], props: { context_type: 'LISTING', context_id: 'abc', signed_in: true } }, adminToken).expect(204);
    const row = await db.selectFrom('analytics_events').select('user_id').where('visitor_id', '=', visitors[1]!).executeTakeFirstOrThrow();
    expect(row.user_id).toBe(adminId);
  });

  it('counts distinct visitors per funnel step on the admin overview', async () => {
    const before = (await http().get('/admin/overview?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200)).body.funnel;
    // visitor 2: views twice (one visitor), then sees the paywall.
    await send({ name: 'listing_view', visitorId: visitors[2], props: { signed_in: false } }).expect(204);
    await send({ name: 'listing_view', visitorId: visitors[2], props: { signed_in: false } }).expect(204);
    await send({ name: 'paywall_shown', visitorId: visitors[2], props: { source: 'contact' } }).expect(204);
    const { body } = await http().get('/admin/overview?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const step = (f: { steps: { step: string; count: number }[] }, s: string) => f.steps.find((x) => x.step === s)!.count;
    expect(body.funnel.tracking).toBe(true);
    expect(step(body.funnel, 'VIEWED') - step(before, 'VIEWED')).toBe(1);
    expect(step(body.funnel, 'PAYWALL') - step(before, 'PAYWALL')).toBe(1);
    expect(body.funnel.listingViews.current - before.listingViews.current).toBe(2);
    expect(body.daily.at(-1)).toHaveProperty('visitors');
  });

  it('keeps the overview admin-only', () => http().get('/admin/overview').expect(401));
});
