import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { sendEmail } from '../common/email.js';
import { renderEmail } from '../common/email-template.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { DELETE_AFTER_DAYS } from './listing.mapper.js';

const HOUR_MS = 3_600_000;
/** The owner is emailed this many days before deletion, and nothing is deleted sooner than this after that email. */
export const REMIND_DAYS_BEFORE = 3;

const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Hourly upkeep of abandoned listings (not confirmed for DELETE_AFTER_DAYS; OCCUPIED and REMOVED are kept):
 * 1. REMIND_DAYS_BEFORE days ahead, email the owner once per confirmation cycle.
 * 2. Delete only listings whose reminder went out at least REMIND_DAYS_BEFORE days ago in this cycle,
 *    so a missed run or a failed email can delay a delete but never skip the warning.
 * Saved entries, photo links and the private location cascade; chats keep their own snapshot.
 */
@Injectable()
export class ListingCleanupService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ListingCleanup');
  private timer?: NodeJS.Timeout;

  constructor(@InjectDb() private readonly db: Database) {}

  onModuleInit() {
    if (config.LISTING_CLEANUP === 'off') return;
    // ponytail: in-process timer, same as PassRemindersService. Claims and deletes are atomic, so several instances are fine.
    const run = () => void this.run().catch((e: Error) => this.log.error(`Cleanup run failed: ${e.message}`));
    this.timer = setInterval(run, HOUR_MS);
    this.timer.unref();
    setTimeout(run, 90_000).unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** One pass of reminders then deletes. `only` narrows both to these listings (tests). */
  async run(only?: string[]) {
    const reminded = await this.remind(only);
    const deleted = await this.deleteAbandoned(only);
    // Analytics events are kept 180 days (enough for the dashboard's 90-day comparison).
    if (!only) await this.db.deleteFrom('analytics_events').where('created_at', '<', new Date(Date.now() - 180 * 86_400_000)).execute();
    return { reminded, deleted };
  }

  /** Claims listings due a reminder (stamping them in the same statement) and emails each owner once, listing them all. */
  async remind(only?: string[]): Promise<number> {
    const { rows } = await sql<{ id: string; lister_id: string; title: string; locality: string | null; deletes_at: Date; email: string | null; name: string | null }>`
      with claimed as (
        update public.listings l set delete_reminder_sent_at = now()
        where l.id in (
          select id from public.listings
          where status not in ('OCCUPIED', 'REMOVED')
            and last_confirmed_at < now() - make_interval(days => ${DELETE_AFTER_DAYS - REMIND_DAYS_BEFORE})
            -- Once per cycle: a reminder from before the last confirmation doesn't count.
            and (delete_reminder_sent_at is null or delete_reminder_sent_at < last_confirmed_at)
            ${only ? sql`and id = any(${sql.val(only)}::uuid[])` : sql``}
          limit 500
        )
        returning l.id, l.lister_id, l.title, l.locality,
          greatest(l.last_confirmed_at + make_interval(days => ${DELETE_AFTER_DAYS}), now() + make_interval(days => ${REMIND_DAYS_BEFORE})) as deletes_at
      )
      select claimed.*, u.email, p.display_name as name
      from claimed join auth.users u on u.id = claimed.lister_id left join public.profiles p on p.user_id = claimed.lister_id
    `.execute(this.db);

    const byOwner = new Map<string, typeof rows>();
    for (const r of rows) byOwner.set(r.lister_id, [...(byOwner.get(r.lister_id) ?? []), r]);
    let sent = 0;
    for (const listings of byOwner.values()) {
      const { email, name } = listings[0]!;
      // Phone-only accounts: nowhere to send it. The claim stands, so the in-app warning is their notice.
      if (!email) continue;
      const first = name?.split(/\s+/)[0] || 'there';
      const when = day(new Date(Math.min(...listings.map((l) => new Date(l.deletes_at).getTime()))));
      const names = listings.map((l) => `• ${l.title}${l.locality ? ` (${l.locality})` : ''}`).join('\n');
      const one = listings.length === 1;
      const ok = await sendEmail(
        email,
        one ? 'Is your place still available?' : `Are your ${listings.length} places still available?`,
        renderEmail({
          preview: `Confirm by ${when} or ${one ? 'it' : 'they'}’ll be removed from FindFlatmates.`,
          heading: `Hi ${first}, ${one ? 'is your place' : 'are your places'} still available?`,
          paragraphs: [
            `You haven’t confirmed ${one ? 'this listing' : 'these listings'} in a while, so seekers can’t tell if ${one ? 'it’s' : 'they’re'} still free:\n${names}`,
            `Unconfirmed listings are deleted on ${when}. One tap on “Still available” keeps ${one ? 'it' : 'them'} up for another ${DELETE_AFTER_DAYS} days. Already rented? Mark ${one ? 'it' : 'them'} as occupied instead.`,
          ],
          cta: { label: 'Confirm my listings', url: `${config.WEB_URL}/my-listings?tab=places` },
          footnote: 'Fresh listings rank higher on the map and get more enquiries.',
        }),
      );
      if (ok) sent++;
      // Couldn't send: release the claim so the next run tries again (and the delete waits for it).
      else await this.db.updateTable('listings').set({ delete_reminder_sent_at: null }).where('id', 'in', listings.map((l) => l.id)).execute();
    }
    if (rows.length) this.log.log(`Delete reminders: ${rows.length} listing(s), ${sent} email(s) sent`);
    return rows.length;
  }

  /** Deletes one bounded batch of listings that are past due and were warned in time. Returns how many went. */
  async deleteAbandoned(only?: string[]): Promise<number> {
    const { rows } = await sql<{ id: string }>`
      delete from public.listings where id in (
        select id from public.listings
        where status not in ('OCCUPIED', 'REMOVED') and last_confirmed_at < now() - make_interval(days => ${DELETE_AFTER_DAYS})
          and delete_reminder_sent_at >= last_confirmed_at
          and delete_reminder_sent_at < now() - make_interval(days => ${REMIND_DAYS_BEFORE})
          ${only ? sql`and id = any(${sql.val(only)}::uuid[])` : sql``}
        limit 500
      ) returning id`.execute(this.db);
    if (rows.length) this.log.log(`Deleted ${rows.length} listing(s) unconfirmed for ${DELETE_AFTER_DAYS} days`);
    return rows.length;
  }
}
