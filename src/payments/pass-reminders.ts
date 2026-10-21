import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { sendEmail } from '../common/email.js';
import { renderEmail } from '../common/email-template.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

const HOUR_MS = 3_600_000;
/** Remind this long before a pass ends. */
const REMIND_BEFORE = '24 hours';

const istTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Hourly: emails people whose Contact Pass ends within a day. Expiry itself needs no job
 * (every check compares `expires_at` to now); this only sends the heads-up.
 */
@Injectable()
export class PassRemindersService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('PassReminders');
  private timer?: NodeJS.Timeout;

  constructor(@InjectDb() private readonly db: Database) {}

  onModuleInit() {
    // ponytail: in-process timer. Fine on one or many instances (the claim below is atomic);
    // move to pg_cron or a scheduled worker if the API ever scales to zero between requests.
    const run = () => void this.run().catch((e: Error) => this.log.error(`Reminder run failed: ${e.message}`));
    this.timer = setInterval(run, HOUR_MS);
    this.timer.unref();
    setTimeout(run, 60_000).unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Claims due passes (stamping reminder_sent_at in the same statement) and emails each one. Returns how many were sent. */
  async run(): Promise<number> {
    const { rows } = await sql<{ id: string; expires_at: Date; email: string | null; name: string | null }>`
      with claimed as (
        update public.contact_passes c set reminder_sent_at = now()
        where c.reminder_sent_at is null
          and c.expires_at > now() and c.expires_at <= now() + ${REMIND_BEFORE}::interval
          -- Already renewed: a later pass takes over, so there's nothing to remind about.
          and not exists (select 1 from public.contact_passes n where n.user_id = c.user_id and n.expires_at > c.expires_at)
          -- Bounded batch per run; the next hour picks up the rest.
          and c.id in (select id from public.contact_passes where reminder_sent_at is null and expires_at > now() and expires_at <= now() + ${REMIND_BEFORE}::interval limit 500)
        returning c.id, c.user_id, c.expires_at
      )
      select claimed.id, claimed.expires_at, u.email, p.display_name as name
      from claimed join auth.users u on u.id = claimed.user_id left join public.profiles p on p.user_id = claimed.user_id
    `.execute(this.db);

    let sent = 0;
    for (const r of rows) {
      if (!r.email) continue; // Phone-only accounts: nowhere to send it.
      const first = r.name?.split(/\s+/)[0] || 'there';
      const ok = await sendEmail(
        r.email,
        'Your Contact Pass ends tomorrow',
        renderEmail({
          preview: `Your pass ends on ${istTime(new Date(r.expires_at))}. Renew without losing a day.`,
          heading: `Hi ${first}, your pass ends tomorrow`,
          paragraphs: [
            `Your FindFlatmates Contact Pass ends on ${istTime(new Date(r.expires_at))}. After that you can still read your conversations, but you'll need a pass to send messages or start new ones.`,
            "Still looking? Renew now. The new pass starts when this one ends, so you don't lose any days.",
          ],
          cta: { label: 'Renew Contact Pass', url: `${config.WEB_URL}/contact-pass` },
          footnote: 'Listers always reply for free. Good luck with the search!',
        }),
      );
      if (ok) sent++;
      // Couldn't send: release the claim so the next run tries again.
      else await this.db.updateTable('contact_passes').set({ reminder_sent_at: null }).where('id', '=', r.id).execute();
    }
    if (rows.length) this.log.log(`Sent ${sent} of ${rows.length} pass reminders`);
    return sent;
  }
}
