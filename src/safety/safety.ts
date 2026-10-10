import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Report } from '@/types/common';
import { invalid } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { type Database, InjectDb } from '../db/db.module.js';

@Controller()
export class SafetyController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Post('reports')
  async report(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<Report> {
    const input = z
      .object({
        targetType: z.enum(['LISTING', 'USER', 'GROUP']),
        targetId: z.uuid(),
        reason: z.enum([
          'SCAM',
          'WRONG_INFORMATION',
          'ALREADY_RENTED',
          'INAPPROPRIATE_CONTENT',
          'SUSPICIOUS_BEHAVIOUR',
          'OTHER',
        ]),
        details: z.string().trim().max(1000).optional(),
      })
      .parse(body);
    const r = await this.db
      .insertInto('reports')
      .values({
        reporter_id: user.id,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        details: input.details,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return {
      id: r.id,
      reporterId: r.reporter_id,
      targetType: input.targetType,
      targetId: r.target_id,
      reason: input.reason,
      details: r.details ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
      status: 'OPEN',
    };
  }

  @Post('blocks')
  @HttpCode(204)
  async block(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { userId } = z.object({ userId: z.uuid() }).parse(body);
    if (userId === user.id) throw invalid('You can’t block yourself.');
    await this.db
      .insertInto('blocks')
      .values({ blocker_id: user.id, blocked_user_id: userId })
      .onConflict((oc) =>
        oc.columns(['blocker_id', 'blocked_user_id']).doNothing(),
      )
      .execute();
  }
}
