import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { z } from 'zod';
import type { ContactTopic } from '@/lib/api/contract';
import { type AuthUser, OptionalUser, Public } from '../common/auth.js';
import { sendEmail } from '../common/email.js';
import { renderEmail } from '../common/email-template.js';
import { RateLimit } from '../common/rate-limit.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

const TOPIC_LABEL: Record<ContactTopic, string> = {
  GENERAL: 'General question',
  PAYMENTS: 'Payments & refunds',
  LISTING: 'A listing or person',
  ACCOUNT: 'My data & account',
  GRIEVANCE: 'Grievance',
};

const input = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  topic: z.enum(Object.keys(TOPIC_LABEL) as [ContactTopic, ...ContactTopic[]]),
  message: z.string().trim().min(10).max(2000),
});

@Controller('contact')
export class ContactController {
  private readonly log = new Logger('Contact');

  constructor(@InjectDb() private readonly db: Database) {}

  /** The /contact form. Open to signed-out visitors, so it's limited tightly per IP. */
  @Public()
  @RateLimit(5, 3600)
  @Post()
  @HttpCode(204)
  async send(@OptionalUser() user: AuthUser | undefined, @Body() body: unknown) {
    const m = input.parse(body);
    // Saved first: the email is only a notification, so a Resend outage loses nothing.
    const row = await this.db
      .insertInto('contact_messages')
      .values({ user_id: user?.id ?? null, name: m.name, email: m.email, topic: m.topic, message: m.message })
      .returning('id')
      .executeTakeFirstOrThrow();
    const sent = await sendEmail(
      config.SUPPORT_EMAIL,
      `New message from ${m.name}: ${TOPIC_LABEL[m.topic]}`,
      renderEmail({
        preview: m.message.slice(0, 120),
        heading: TOPIC_LABEL[m.topic],
        paragraphs: [m.message],
        footnote: `From ${m.name} <${m.email}> · ${user ? `account ${user.id}` : 'not signed in'} · message ${row.id}\nReply to this email to answer them directly.`,
      }),
      m.email,
    );
    if (!sent) this.log.warn(`Contact message ${row.id} saved but the notification email failed`);
  }
}
