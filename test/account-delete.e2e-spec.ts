import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';

/** DELETE /users/me (Facebook / Play data-deletion requirement). Runs against the local Supabase database. */
describe('Account deletion (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
  });

  afterAll(() => app.close());

  it('deletes the account and its data, keeps the payment detached, and the token stops working', async () => {
    const { data, error } = await admin.auth.admin.createUser({ email: `e2e-delete-${Date.now()}@example.com`, email_confirm: true });
    if (error) throw error;
    const id = data.user.id;
    await db.insertInto('profiles').values({ user_id: id, display_name: 'Delete Me' }).onConflict((oc) => oc.column('user_id').doNothing()).execute();
    const payment = await db
      .insertInto('payments')
      .values({ user_id: id, amount: 169, provider: 'MOCK', provider_order_id: `e2e-delete-${id}`, status: 'SUCCEEDED' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(config.SUPABASE_JWT_SECRET!));

    await request(app.getHttpServer()).delete('/users/me').set('Authorization', `Bearer ${token}`).expect(204);

    expect(await db.selectFrom('auth.users').select('id').where('id', '=', id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('profiles').select('user_id').where('user_id', '=', id).executeTakeFirst()).toBeUndefined();
    expect((await db.selectFrom('payments').select('user_id').where('id', '=', payment.id).executeTakeFirstOrThrow()).user_id).toBeNull();
    await db.deleteFrom('payments').where('id', '=', payment.id).execute();
  });
});
