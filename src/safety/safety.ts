import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AdminStats } from '@/lib/api/contract';
import type { Report } from '@/types/common';
import { forbidden, invalid } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { EXPIRE_AFTER_HOURS, STALE_AFTER_HOURS } from '../listings/listing.mapper.js';

@Controller()
export class SafetyController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Post('reports')
  async report(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<Report> {
    const input = z
      .object({
        targetType: z.enum(['LISTING', 'USER', 'GROUP']),
        targetId: z.uuid(),
        reason: z.enum(['SCAM', 'WRONG_INFORMATION', 'ALREADY_RENTED', 'INAPPROPRIATE_CONTENT', 'SUSPICIOUS_BEHAVIOUR', 'OTHER']),
        details: z.string().trim().max(1000).optional(),
      })
      .parse(body);
    const r = await this.db
      .insertInto('reports')
      .values({ reporter_id: user.id, target_type: input.targetType, target_id: input.targetId, reason: input.reason, details: input.details })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { id: r.id, reporterId: r.reporter_id, targetType: input.targetType, targetId: r.target_id, reason: input.reason, details: r.details ?? undefined, createdAt: new Date(r.created_at).toISOString(), status: 'OPEN' };
  }

  @Post('blocks')
  @HttpCode(204)
  async block(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { userId } = z.object({ userId: z.uuid() }).parse(body);
    if (userId === user.id) throw invalid('You can’t block yourself.');
    await this.db.insertInto('blocks').values({ blocker_id: user.id, blocked_user_id: userId }).onConflict((oc) => oc.columns(['blocker_id', 'blocked_user_id']).doNothing()).execute();
  }

  @Get('admin/stats')
  async stats(@CurrentUser() user: AuthUser): Promise<AdminStats> {
    const me = await this.db.selectFrom('profiles').select('is_admin').where('user_id', '=', user.id).executeTakeFirst();
    if (!me?.is_admin) throw forbidden('Admins only.');
    const count = <T>(q: { executeTakeFirstOrThrow(): Promise<T> }) => q.executeTakeFirstOrThrow();
    const n = sql<string>`count(*)`.as('n');
    const [listings, active, stale, users, reports, payments, verifications] = await Promise.all([
      count(this.db.selectFrom('listings').select(n)),
      count(this.db.selectFrom('listings').select(n).where('status', '=', 'ACTIVE').where(sql<boolean>`last_confirmed_at > now() - make_interval(hours => ${STALE_AFTER_HOURS})`)),
      count(this.db.selectFrom('listings').select(n).where('status', '=', 'ACTIVE').where(sql<boolean>`last_confirmed_at between now() - make_interval(hours => ${EXPIRE_AFTER_HOURS}) and now() - make_interval(hours => ${STALE_AFTER_HOURS})`)),
      count(this.db.selectFrom('profiles').select(n)),
      count(this.db.selectFrom('reports').select(n).where('status', '=', 'OPEN')),
      count(this.db.selectFrom('payments').select([n, sql<string>`coalesce(sum(amount), 0)`.as('sum')]).where('status', '=', 'SUCCEEDED')),
      count(this.db.selectFrom('verifications').select(n).where('status', '=', 'PENDING')),
    ]);
    return {
      listings: Number(listings.n),
      activeListings: Number(active.n),
      staleListings: Number(stale.n),
      users: Number(users.n),
      openReports: Number(reports.n),
      payments: Number(payments.n),
      revenueInr: Number(payments.sum),
      pendingVerifications: Number(verifications.n),
    };
  }
}
