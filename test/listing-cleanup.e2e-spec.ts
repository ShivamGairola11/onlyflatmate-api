import { createClient } from '@supabase/supabase-js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { sql } from 'kysely';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { sendEmail } from '../src/common/email.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';
import { ListingCleanupService } from '../src/listings/listing-cleanup.js';

// Never email real people from a test (the local .env may carry a live Resend key).
vi.mock('../src/common/email.js', () => ({ sendEmail: vi.fn(async () => true) }));

/**
 * Abandoned-listing upkeep (business-logic skill → Listings → Auto-delete). Local Supabase.
 * Unconfirmed for 30 days → deleted, but only 3+ days after the owner was emailed; occupied listings are kept.
 */
const TAG = 'e2e-cleanup';
type Case = 'due' | 'dueWarned' | 'occupied' | 'soon' | 'fresh';

describe('Listing cleanup (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let cleanup: ListingCleanupService;
  let listerId: string;
  let token: string;
  const ids = {} as Record<Case, string>;
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  /** Copy of a seed listing with a status, a last check-in and (optionally) a reminder this many days ago. */
  async function clone(status: string, confirmedDaysAgo: number, remindedDaysAgo?: number) {
    const cols = (await sql<{ c: string }>`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name not in ('id', 'title', 'status', 'last_confirmed_at', 'delete_reminder_sent_at')`.execute(db)).rows.map((r) => sql.ref(r.c));
    const reminded = remindedDaysAgo === undefined ? sql`null` : sql`now() - make_interval(days => ${remindedDaysAgo})`;
    const { rows } = await sql<{ id: string }>`insert into listings (${sql.join(cols)}, title, status, last_confirmed_at, delete_reminder_sent_at)
      select ${sql.join(cols)}, ${TAG}, ${status}, now() - make_interval(days => ${confirmedDaysAgo}), ${reminded} from listings limit 1 returning id`.execute(db);
    await db.updateTable('listings').set({ lister_id: listerId }).where('id', '=', rows[0]!.id).execute();
    return rows[0]!.id;
  }
  const only = () => Object.values(ids);
  const remaining = async () => (await db.selectFrom('listings').select('id').where('id', 'in', only()).execute()).map((r) => r.id).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
    cleanup = moduleRef.get(ListingCleanupService);
    // A throwaway owner with an email (seed accounts are phone-only), so the reminder has somewhere to go.
    const { data, error } = await admin.auth.admin.createUser({ email: `cleanup-${Date.now()}@example.com`, email_confirm: true, user_metadata: { full_name: 'Cleanup Test' } });
    if (error) throw error;
    listerId = data.user.id;
    token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(listerId).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(config.SUPABASE_JWT_SECRET!));
    ids.due = await clone('ACTIVE', 31); // past due but never warned
    ids.dueWarned = await clone('ACTIVE', 31, 4); // past due, warned 4 days ago
    ids.occupied = await clone('OCCUPIED', 31);
    ids.soon = await clone('ACTIVE', 28); // inside the 3-day reminder window
    ids.fresh = await clone('ACTIVE', 10);
  });

  afterAll(async () => {
    await db.deleteFrom('listings').where('title', '=', TAG).execute();
    if (listerId) await admin.auth.admin.deleteUser(listerId);
    await app.close();
  });

  it('tells the owner when an unconfirmed listing will be deleted, and not for occupied ones', async () => {
    const { body } = await request(app.getHttpServer()).get('/listings/mine').set('Authorization', `Bearer ${token}`).expect(200);
    const byId = new Map(body.map((l: { id: string }) => [l.id, l]));
    const fresh = byId.get(ids.fresh) as { lastConfirmedAt: string; deletesAt: string };
    expect(new Date(fresh.deletesAt).getTime() - new Date(fresh.lastConfirmedAt).getTime()).toBe(30 * 86_400_000);
    expect(byId.get(ids.occupied)).not.toHaveProperty('deletesAt');
  });

  it('warns first: emails the owner once, deletes only what was warned 3+ days ago', async () => {
    const result = await cleanup.run(only());
    // Reminded: never-warned past-due + inside the window. One email lists both (same owner).
    expect(result).toEqual({ reminded: 2, deleted: 1 });
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0]![1]).toBe('Are your 2 places still available?');
    expect(await remaining()).toEqual([ids.due, ids.occupied, ids.soon, ids.fresh].sort());
  });

  it('doesn’t remind twice in one cycle, and still waits out the 3 days', async () => {
    vi.mocked(sendEmail).mockClear();
    expect(await cleanup.run(only())).toEqual({ reminded: 0, deleted: 0 });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('confirming restarts the clock and re-arms the reminder for the next cycle', async () => {
    await request(app.getHttpServer()).post(`/listings/${ids.due}/confirm`).set('Authorization', `Bearer ${token}`).expect(201);
    const { body } = await request(app.getHttpServer()).get('/listings/mine').set('Authorization', `Bearer ${token}`).expect(200);
    expect(new Date(body.find((x: { id: string }) => x.id === ids.due).deletesAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Age it past due again: the old reminder belongs to the previous cycle, so it's warned again, not deleted.
    await db.updateTable('listings').set({ last_confirmed_at: sql`now() - interval '31 days'` }).where('id', '=', ids.due).execute();
    await db.updateTable('listings').set({ delete_reminder_sent_at: sql`now() - interval '40 days'` }).where('id', '=', ids.due).execute();
    expect(await cleanup.run([ids.due])).toEqual({ reminded: 1, deleted: 0 });
  });

  it('keeps the warning when the email fails, so the delete waits', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(false);
    const failed = await clone('ACTIVE', 31);
    expect(await cleanup.run([failed])).toEqual({ reminded: 1, deleted: 0 });
    const row = await db.selectFrom('listings').select('delete_reminder_sent_at').where('id', '=', failed).executeTakeFirstOrThrow();
    expect(row.delete_reminder_sent_at).toBeNull();
  });
});
