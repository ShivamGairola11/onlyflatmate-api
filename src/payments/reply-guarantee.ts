import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type RawBuilder, sql } from 'kysely';
import { REPLY_GUARANTEE } from '@/features/payments/reply-guarantee';
import { sendEmail } from '../common/email.js';
import { renderEmail } from '../common/email-template.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

const HOUR_MS = 3_600_000;
const { hours: HOURS, days: DAYS } = REPLY_GUARANTEE;

const istTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Seeker-started chats created since `since`: when the seeker first wrote (`asked`) and when the other side first
 * wrote back (`answered`, null if never). Chats where the seeker never wrote are left out — nothing to answer.
 * Shared by the admin reply figures and the paywall's reply rate.
 */
export const seekerChats = (since: RawBuilder<unknown>) => sql`
  select c.id, c.context_type, c.context_id, a.asked,
    (select min(r.sent_at) from public.messages r where r.conversation_id = c.id and r.sender_id <> c.initiator_id) as answered
  from public.conversations c
  cross join lateral (select min(m.sent_at) as asked from public.messages m where m.conversation_id = c.id and m.sender_id = c.initiator_id) a
  where c.created_at >= ${since} and a.asked is not null`;

/**
 * Hourly: the reply guarantee. A paid pass whose seeker started chats on it, and heard nothing back from anyone within
 * HOURS of their first message, gets DAYS more — added to their latest pass (from now if it already lapsed), once per
 * pass. Complimentary, refunded and revoked passes and banned users don't qualify.
 */
@Injectable()
export class ReplyGuaranteeService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ReplyGuarantee');
  private timer?: NodeJS.Timeout;

  constructor(@InjectDb() private readonly db: Database) {}

  onModuleInit() {
    // ponytail: in-process timer, like PassRemindersService; safe on many instances (each credit is claimed atomically).
    const run = () => void this.run().catch((e: Error) => this.log.error(`Guarantee run failed: ${e.message}`));
    this.timer = setInterval(run, HOUR_MS);
    this.timer.unref();
    setTimeout(run, 90_000).unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Credits every due pass. Returns how many were credited. */
  async run(): Promise<number> {
    const { rows } = await sql<{ id: string; user_id: string; email: string | null; name: string | null }>`
      select p.id, p.user_id, u.email, pr.display_name as name
      from public.contact_passes p
      join public.payments pay on pay.id = p.payment_id and pay.status = 'SUCCEEDED' and pay.amount > 0
      join auth.users u on u.id = p.user_id
      left join public.profiles pr on pr.user_id = p.user_id
      -- The seeker's first message in a chat they started while this pass ran.
      cross join lateral (
        select min(m.sent_at) as first_ask
        from public.conversations c join public.messages m on m.conversation_id = c.id and m.sender_id = c.initiator_id
        where c.initiator_id = p.user_id and c.created_at >= p.starts_at and c.created_at < p.expires_at
      ) t
      where p.reply_guarantee_at is null
        and t.first_ask <= now() - make_interval(hours => ${HOURS})
        -- ponytail: passes are judged once their window closes; a week's grace covers missed runs, older ones are skipped.
        and t.first_ask > now() - interval '7 days'
        and (u.banned_until is null or u.banned_until < now())
        and not exists (
          select 1 from public.conversations c2 join public.messages r on r.conversation_id = c2.id
          where c2.initiator_id = p.user_id and r.sender_id <> p.user_id
            and r.sent_at between t.first_ask and t.first_ask + make_interval(hours => ${HOURS})
        )
      limit 200
    `.execute(this.db);

    let credited = 0;
    for (const r of rows) {
      const until = await this.db.transaction().execute(async (trx) => {
        // Claim first: a second instance (or a retry) finds it settled and does nothing.
        const claim = await trx
          .updateTable('contact_passes')
          .set({ reply_guarantee_at: new Date(), reply_guarantee_days: DAYS })
          .where('id', '=', r.id)
          .where('reply_guarantee_at', 'is', null)
          .executeTakeFirst();
        if (!claim.numUpdatedRows) return null;
        // Onto the pass that ends last, so stacked passes keep running back to back.
        const latest = await trx.selectFrom('contact_passes').select('id').where('user_id', '=', r.user_id).orderBy('expires_at', 'desc').limit(1).executeTakeFirstOrThrow();
        const { expires_at } = await trx
          .updateTable('contact_passes')
          .set({ expires_at: sql<Date>`greatest(expires_at, now()) + make_interval(days => ${DAYS})` })
          .where('id', '=', latest.id)
          .returning('expires_at')
          .executeTakeFirstOrThrow();
        return new Date(expires_at);
      });
      if (!until) continue;
      credited++;
      if (!r.email) continue; // Phone-only accounts: the longer pass shows in the app.
      const first = r.name?.split(/\s+/)[0] || 'there';
      await sendEmail(
        r.email,
        `We added ${DAYS} days to your Contact Pass`,
        renderEmail({
          preview: `Nobody replied within ${HOURS} hours, so your pass now runs until ${istTime(until)}.`,
          heading: `Hi ${first}, here are ${DAYS} more days`,
          paragraphs: [
            `Nobody you messaged replied within ${HOURS} hours, so our reply guarantee has added ${DAYS} days to your Contact Pass, free. It now runs until ${istTime(until)}.`,
            'Listings confirmed in the last few days get the quickest answers. Try a few more.',
          ],
          cta: { label: 'Find more places', url: `${config.WEB_URL}/explore` },
          footnote: 'Listers always reply for free. Good luck with the search!',
        }),
      );
    }
    if (credited) this.log.log(`Reply guarantee: credited ${credited} of ${rows.length} passes`);
    return credited;
  }
}
