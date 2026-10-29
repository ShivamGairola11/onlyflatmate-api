import { createClient } from '@supabase/supabase-js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AppModule } from '../src/app.module.js';
import { sendEmail } from '../src/common/email.js';
import { config } from '../src/config.js';
import { type Database, KYSELY } from '../src/db/db.module.js';
import { PassRemindersService } from '../src/payments/pass-reminders.js';

// Never email real people from a test (the local .env may carry a live Resend key).
vi.mock('../src/common/email.js', () => ({ sendEmail: vi.fn(async () => true) }));

/**
 * Pass-expiry reminders (business-logic skill → Contact Pass). Local Supabase.
 * One email 24 h before a pass ends; none when a renewal follows it; a failed send is retried next run.
 */
type Case = 'due' | 'renewed' | 'later';
const HOUR = 3_600_000;

describe('Pass reminders (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let job: PassRemindersService;
  const users = {} as Record<Case, string>;
  const passes = {} as Record<Case, string>;
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  async function pass(userId: string, tag: string, endsInHours: number) {
    const pay = await db.insertInto('payments').values({ user_id: userId, amount: 169, plan: 'PRO', provider: 'MOCK', provider_order_id: `e2e_reminder_${tag}_${Date.now()}`, status: 'SUCCEEDED' }).returning('id').executeTakeFirstOrThrow();
    const ends = Date.now() + endsInHours * HOUR;
    return (await db.insertInto('contact_passes').values({ user_id: userId, payment_id: pay.id, plan: 'PRO', starts_at: new Date(ends - 7 * 24 * HOUR), expires_at: new Date(ends) }).returning('id').executeTakeFirstOrThrow()).id;
  }
  const stamped = async (c: Case) => (await db.selectFrom('contact_passes').select('reminder_sent_at').where('id', '=', passes[c]).executeTakeFirstOrThrow()).reminder_sent_at;
  const remindedTo = (email: string) => vi.mocked(sendEmail).mock.calls.filter(([to, subject]) => to === email && subject.includes('ends tomorrow'));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get(KYSELY);
    job = moduleRef.get(PassRemindersService);
    for (const c of ['due', 'renewed', 'later'] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: `reminder-${c}-${Date.now()}@example.com`, email_confirm: true, user_metadata: { full_name: `Reminder ${c}` } });
      if (error) throw error;
      users[c] = data.user.id;
    }
    passes.due = await pass(users.due, 'due', 20);
    passes.renewed = await pass(users.renewed, 'renewed', 20);
    await pass(users.renewed, 'renewal', 20 + 7 * 24); // stacked renewal: nothing to remind about
    passes.later = await pass(users.later, 'later', 30);
  });

  afterAll(async () => {
    for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
    await sql`delete from public.contact_passes where payment_id in (select id from public.payments where provider_order_id like 'e2e_reminder_%')`.execute(db);
    await sql`delete from public.payments where provider_order_id like 'e2e_reminder_%'`.execute(db);
    await app.close();
  });

  it('retries next run when the send fails', async () => {
    vi.mocked(sendEmail).mockResolvedValue(false);
    await job.run();
    expect(await stamped('due')).toBeNull(); // claim released
    vi.mocked(sendEmail).mockResolvedValue(true);
  });

  it('emails a pass ending within a day exactly once, and skips renewed and later ones', async () => {
    vi.mocked(sendEmail).mockClear();
    await job.run();
    await job.run();
    const email = (await admin.auth.admin.getUserById(users.due)).data.user!.email!;
    expect(remindedTo(email)).toHaveLength(1);
    expect(await stamped('due')).not.toBeNull();
    expect(await stamped('renewed')).toBeNull();
    expect(await stamped('later')).toBeNull();
  });
});
