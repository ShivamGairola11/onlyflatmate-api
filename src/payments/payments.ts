import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import type { ContactPass } from '@/features/payments/types';
import type { ContactPassStatus } from '@/lib/api/contract';
import { ApiError, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

/** Same values as the web app's contactPassConfig. */
const PRICE_INR = 59;
const VALIDITY_DAYS = 7;

const toPass = (p: { id: string; user_id: string; payment_id: string; starts_at: Date; expires_at: Date }): ContactPass => ({
  id: p.id,
  userId: p.user_id,
  paymentId: p.payment_id,
  startsAt: new Date(p.starts_at).toISOString(),
  expiresAt: new Date(p.expires_at).toISOString(),
  status: new Date(p.expires_at) > new Date() ? 'ACTIVE' : 'EXPIRED',
});

@Controller()
export class PaymentsController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get('contact-pass')
  async status(@CurrentUser() user: AuthUser): Promise<ContactPassStatus> {
    const pass = await this.db.selectFrom('contact_passes').selectAll().where('user_id', '=', user.id).where('expires_at', '>', new Date()).orderBy('expires_at', 'desc').executeTakeFirst();
    return { active: !!pass, pass: pass && toPass(pass), priceInr: PRICE_INR, validityDays: VALIDITY_DAYS };
  }

  /** Step 1 of checkout: an order the payment provider will charge against. */
  @Post('payments/contact-pass/order')
  async order(@CurrentUser() user: AuthUser) {
    // ponytail: mock orders only. With Razorpay, create the order through its Orders API here and store its id.
    const providerOrderId = `order_${randomUUID()}`;
    const p = await this.db
      .insertInto('payments')
      .values({ user_id: user.id, amount: PRICE_INR, provider: config.PAYMENTS_PROVIDER === 'razorpay' ? 'RAZORPAY' : 'MOCK', provider_order_id: providerOrderId })
      .returning(['id', 'provider_order_id', 'amount'])
      .executeTakeFirstOrThrow();
    return { paymentId: p.id, providerOrderId: p.provider_order_id, amount: p.amount, currency: 'INR' as const };
  }

  /** Step 2: confirm the payment and grant the pass. Idempotent — retries return the same pass. */
  @Post('payments/confirm')
  async confirm(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = z.object({ paymentId: z.uuid(), method: z.enum(['UPI', 'CARD', 'NETBANKING']), providerSignature: z.string().max(500).optional() }).parse(body);
    const payment = await this.db.selectFrom('payments').selectAll().where('id', '=', input.paymentId).where('user_id', '=', user.id).executeTakeFirst();
    if (!payment) throw notFound('Payment not found');

    const existing = await this.db.selectFrom('contact_passes').selectAll().where('payment_id', '=', payment.id).executeTakeFirst();
    if (existing) return toPass(existing);

    if (payment.provider !== 'MOCK') {
      // Razorpay: verify HMAC-SHA256(order_id|payment_id) with the key secret before granting anything.
      throw new ApiError('PAYMENT_FAILED', 'Online payments aren’t set up yet.', 501);
    }

    return this.db.transaction().execute(async (trx) => {
      await trx.updateTable('payments').set({ status: 'SUCCEEDED', method: input.method, provider_payment_id: `mockpay_${randomUUID()}` }).where('id', '=', payment.id).execute();
      const now = new Date();
      const pass = await trx
        .insertInto('contact_passes')
        .values({ user_id: user.id, payment_id: payment.id, starts_at: now, expires_at: new Date(now.getTime() + VALIDITY_DAYS * 86_400_000) })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPass(pass);
    });
  }
}
