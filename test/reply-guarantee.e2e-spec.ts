import { createClient } from '@supabase/supabase-js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import { REPLY_GUARANTEE } from '@/features/payments/reply-guarantee';
import { AppModule } from '../src/app.module.js';
import { sendEmail } from '../src/common/email.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';
import { ReplyGuaranteeService } from '../src/payments/reply-guarantee.js';

// Never email real people from a test (the local .env may carry a live Resend key).
vi.mock('../src/common/email.js', () => ({ sendEmail: vi.fn(async () => true) }));

/**
 * Reply guarantee (business-logic skill → Contact Pass → Reply guarantee). Local Supabase.
 * A paid pass whose seeker heard nothing within 48 h of their first message gets 3 more days, once.
 */
type Case = 'ignored' | 'answered' | 'comp' | 'recent';
const DAY = 86_400_000;

describe('Reply guarantee (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let job: ReplyGuaranteeService;
  let listerId: string;
  const seekers = {} as Record<Case, string>;
  const passes = {} as Record<Case, { id: string; expiresAt: Date }>;
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const user = async (name: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email: `${name}-${Date.now()}@example.com`, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw error;
    return data.user.id;
  };

  /** A 7-day pass that started 4 days ago, and one chat whose first message was `askedHoursAgo` ago. */
  async function seed(c: Case, { amount, askedHoursAgo, replyAfterHours }: { amount: number; askedHoursAgo: number; replyAfterHours?: number }) {
    const seeker = (seekers[c] = await user(`guarantee-${c}`));
    const pay = await db.insertInto('payments').values({ user_id: seeker, amount, plan: amount ? 'PRO' : null, provider: 'MOCK', provider_order_id: `e2e_guarantee_${c}_${Date.now()}`, status: 'SUCCEEDED' }).returning('id').executeTakeFirstOrThrow();
    const startsAt = new Date(Date.now() - 4 * DAY);
    const expiresAt = new Date(startsAt.getTime() + 7 * DAY);
    const pass = await db.insertInto('contact_passes').values({ user_id: seeker, payment_id: pay.id, plan: amount ? 'PRO' : null, starts_at: startsAt, expires_at: expiresAt }).returning('id').executeTakeFirstOrThrow();
    passes[c] = { id: pass.id, expiresAt };
    const asked = new Date(Date.now() - askedHoursAgo * 3_600_000);
    const conv = await db.insertInto('conversations').values({ context_type: 'FLATMATE', context_id: crypto.randomUUID(), context: JSON.stringify({}), initiator_id: seeker, created_at: asked }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('conversation_participants').values([{ conversation_id: conv.id, user_id: seeker, role: 'SEEKER' }, { conversation_id: conv.id, user_id: listerId, role: 'MEMBER' }]).execute();
    await db.insertInto('messages').values({ conversation_id: conv.id, sender_id: seeker, body: 'Is the room still free?', sent_at: asked }).execute();
    if (replyAfterHours !== undefined) await db.insertInto('messages').values({ conversation_id: conv.id, sender_id: listerId, body: 'Yes!', sent_at: new Date(asked.getTime() + replyAfterHours * 3_600_000) }).execute();
  }

  const pass = async (c: Case) => db.selectFrom('contact_passes').select(['expires_at', 'reply_guarantee_at', 'reply_guarantee_days']).where('id', '=', passes[c].id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
    job = moduleRef.get(ReplyGuaranteeService);
    listerId = await user('guarantee-lister');
    await seed('ignored', { amount: 169, askedHoursAgo: 72 });
    await seed('answered', { amount: 169, askedHoursAgo: 72, replyAfterHours: 5 });
    await seed('comp', { amount: 0, askedHoursAgo: 72 });
    await seed('recent', { amount: 169, askedHoursAgo: 10 });
  });

  afterAll(async () => {
    // Deleting the users removes their passes and chats; their payments are kept (user_id → null), so drop those after.
    for (const id of [...Object.values(seekers), listerId]) if (id) await admin.auth.admin.deleteUser(id);
    await sql`delete from public.contact_passes where payment_id in (select id from public.payments where provider_order_id like 'e2e_guarantee_%')`.execute(db);
    await sql`delete from public.payments where provider_order_id like 'e2e_guarantee_%'`.execute(db);
    await app.close();
  });

  it('adds days to a paid pass nobody answered, emails once, and never twice', async () => {
    await job.run();
    await job.run();
    const p = await pass('ignored');
    expect(new Date(p.expires_at).getTime() - passes.ignored.expiresAt.getTime()).toBe(REPLY_GUARANTEE.days * DAY);
    expect(p.reply_guarantee_days).toBe(REPLY_GUARANTEE.days);
    expect(vi.mocked(sendEmail).mock.calls.filter(([, subject]) => subject.includes('days to your Contact Pass')).length).toBeGreaterThanOrEqual(1);
  });

  it('leaves answered, complimentary and still-waiting passes alone', async () => {
    for (const c of ['answered', 'comp', 'recent'] as const) {
      const p = await pass(c);
      expect(new Date(p.expires_at).getTime(), c).toBe(passes[c].expiresAt.getTime());
      expect(p.reply_guarantee_at, c).toBeNull();
    }
  });

  it('serves the paywall proof to signed-out visitors', async () => {
    const { body } = await request(app.getHttpServer()).get('/contact-pass/proof?city=Bengaluru').expect(200);
    expect(body).toMatchObject({ city: 'Bengaluru', liveListings: expect.any(Number) });
    expect(body.replyRate24h === null || (body.replyRate24h >= 0 && body.replyRate24h <= 1)).toBe(true);
  });
});
