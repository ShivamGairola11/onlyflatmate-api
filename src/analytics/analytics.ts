import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, OptionalUser, Public } from '../common/auth.js';
import { RateLimit } from '../common/rate-limit.js';
import { type Database, InjectDb } from '../db/db.module.js';

/** Browser-reported events (web `lib/analytics.ts`). `pass_purchased` is deliberately absent: purchases come from `payments`. */
export const CLIENT_EVENTS = ['listing_view', 'signin_prompt_shown', 'signin_done', 'contact_click', 'paywall_shown'] as const;

/** The only properties kept; anything else (or anything long) is dropped, so no personal data can ride along. */
const PROP_KEYS = ['listing_id', 'page_type', 'signed_in', 'action', 'method', 'context_type', 'context_id', 'source'] as const;
const value = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

const input = z.object({
  name: z.enum(CLIENT_EVENTS),
  visitorId: z.uuid(),
  props: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Allowlisted keys with short primitive values. */
export function cleanProps(props: Record<string, unknown>) {
  const out: Record<string, string | number | boolean> = {};
  for (const k of PROP_KEYS) {
    const v = value.safeParse(props[k]);
    if (v.success) out[k] = v.data;
  }
  return out;
}

@Controller('analytics')
export class AnalyticsController {
  constructor(@InjectDb() private readonly db: Database) {}

  /** One event from the web app. Signed out is fine; signed in, it's tied to the account too. */
  @Public()
  @RateLimit(120, 60)
  @Post('events')
  @HttpCode(204)
  async record(@OptionalUser() user: AuthUser | undefined, @Body() body: unknown) {
    const e = input.parse(body);
    // ponytail: one insert per event; batch or buffer if this ever becomes the hottest write path.
    await this.db.insertInto('analytics_events').values({ name: e.name, visitor_id: e.visitorId, user_id: user?.id ?? null, props: JSON.stringify(cleanProps(e.props)) }).execute();
  }
}
