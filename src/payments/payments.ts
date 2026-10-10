import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import Razorpay from 'razorpay';
import {
  validatePaymentVerification,
  validateWebhookSignature,
} from 'razorpay/dist/utils/razorpay-utils.js';
import { z } from 'zod';
import type { ContactPass } from '@/features/payments/types';
import type { ContactPassStatus } from '@/lib/api/contract';
import { ApiError, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser, Public } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

/** Same values as the web app's contactPassConfig. */
const PRICE_INR = 59;
export const VALIDITY_DAYS = 7;

/** Null in mock mode. config.ts guarantees both keys are set when the provider is razorpay. */
export const razorpay =
  config.PAYMENTS_PROVIDER === 'razorpay'
    ? new Razorpay({
        key_id: config.RAZORPAY_KEY_ID!,
        key_secret: config.RAZORPAY_KEY_SECRET!,
      })
    : null;

export type Method = 'UPI' | 'CARD' | 'NETBANKING';
/** Razorpay's method names → ours. Anything else (wallet, EMI…) isn't stored. */
export const RZP_METHOD: Record<string, Method> = {
  upi: 'UPI',
  card: 'CARD',
  netbanking: 'NETBANKING',
};

const paymentFailed = (message: string, status = 400) =>
  new ApiError('PAYMENT_FAILED', message, status);

const toPass = (p: {
  id: string;
  user_id: string;
  payment_id: string;
  starts_at: Date;
  expires_at: Date;
}): ContactPass => ({
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
    const pass = await this.db
      .selectFrom('contact_passes')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('expires_at', '>', new Date())
      .orderBy('expires_at', 'desc')
      .executeTakeFirst();
    return {
      active: !!pass,
      pass: pass && toPass(pass),
      priceInr: PRICE_INR,
      validityDays: VALIDITY_DAYS,
    };
  }

  /** Step 1 of checkout: an order the payment provider will charge against. */
  @Post('payments/contact-pass/order')
  async order(@CurrentUser() user: AuthUser) {
    let providerOrderId = `order_${randomUUID()}`;
    if (razorpay) {
      // Razorpay charges in paise. The amount is fixed here, server-side, so the client can't change it.
      const order = await razorpay.orders
        .create({
          amount: PRICE_INR * 100,
          currency: 'INR',
          receipt: `cp_${randomUUID().slice(0, 32)}`,
          notes: { userId: user.id, purpose: 'CONTACT_PASS' },
        })
        .catch(() => {
          throw paymentFailed(
            'Couldn’t start the payment. Please try again.',
            502,
          );
        });
      providerOrderId = order.id;
    }
    const p = await this.db
      .insertInto('payments')
      .values({
        user_id: user.id,
        amount: PRICE_INR,
        provider: razorpay ? 'RAZORPAY' : 'MOCK',
        provider_order_id: providerOrderId,
      })
      .returning(['id', 'provider_order_id', 'amount'])
      .executeTakeFirstOrThrow();
    return {
      paymentId: p.id,
      providerOrderId: p.provider_order_id,
      amount: p.amount,
      currency: 'INR' as const,
      keyId: razorpay ? config.RAZORPAY_KEY_ID : undefined,
    };
  }

  /** Step 2: confirm the payment and grant the pass. Idempotent — retries return the same pass. */
  @Post('payments/confirm')
  async confirm(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = z
      .object({
        paymentId: z.uuid(),
        method: z.enum(['UPI', 'CARD', 'NETBANKING']),
        providerPaymentId: z.string().max(100).optional(),
        providerSignature: z.string().max(500).optional(),
      })
      .parse(body);
    const payment = await this.db
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', input.paymentId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!payment) throw notFound('Payment not found');

    const existing = await this.db
      .selectFrom('contact_passes')
      .selectAll()
      .where('payment_id', '=', payment.id)
      .executeTakeFirst();
    if (existing) return toPass(existing);

    let providerPaymentId = `mockpay_${randomUUID()}`;
    if (payment.provider === 'RAZORPAY') {
      // Razorpay signs order_id|payment_id with our key secret. Only a matching signature proves the payment.
      if (!input.providerPaymentId || !input.providerSignature)
        throw paymentFailed('Payment details are missing.');
      if (!config.RAZORPAY_KEY_SECRET)
        throw paymentFailed('Online payments aren’t set up.', 503);
      const valid = validatePaymentVerification(
        {
          order_id: payment.provider_order_id,
          payment_id: input.providerPaymentId,
        },
        input.providerSignature,
        config.RAZORPAY_KEY_SECRET,
      );
      if (!valid)
        throw paymentFailed(
          'We couldn’t verify this payment. If money was deducted, please contact support.',
        );
      providerPaymentId = input.providerPaymentId;
    } else if (payment.provider !== 'MOCK') {
      throw paymentFailed('Unsupported payment provider.', 501);
    }

    return grantPass(this.db, payment, providerPaymentId, input.method);
  }

  /**
   * Razorpay → us, via the web app's /api/webhooks/razorpay. Grants the pass when the browser never
   * got to /payments/confirm (tab closed, network dropped after paying). Authenticated by signature only.
   */
  @Public()
  @Post('webhooks/razorpay')
  @HttpCode(200)
  async razorpayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    if (!config.RAZORPAY_WEBHOOK_SECRET)
      throw new ApiError('PAYMENT_FAILED', 'Webhook not configured.', 503);
    const raw = req.rawBody?.toString('utf8');
    if (
      !raw ||
      !signature ||
      !validateWebhookSignature(raw, signature, config.RAZORPAY_WEBHOOK_SECRET)
    ) {
      throw new ApiError('FORBIDDEN', 'Invalid signature.', 401);
    }

    const event = JSON.parse(raw) as {
      event: string;
      payload?: {
        payment?: {
          entity?: {
            id: string;
            order_id: string;
            amount: number;
            method: string;
          };
        };
      };
    };
    const p = event.payload?.payment?.entity;
    // Other events (and test pings) are acknowledged so Razorpay doesn't retry them.
    if (event.event !== 'payment.captured' || !p?.order_id) return { ok: true };

    const payment = await this.db
      .selectFrom('payments')
      .selectAll()
      .where('provider_order_id', '=', p.order_id)
      .where('provider', '=', 'RAZORPAY')
      .executeTakeFirst();
    // Not one of our Contact Pass orders, or the amount doesn't match what we charged: nothing to grant.
    if (!payment || p.amount !== payment.amount * 100) return { ok: true };

    await grantPass(this.db, payment, p.id, RZP_METHOD[p.method]);
    return { ok: true };
  }
}

/**
 * Marks the payment paid and issues its pass. Safe to call twice (confirm, webhook and an admin sync
 * can race): one pass per payment.
 */
export function grantPass(
  db: Database,
  payment: { id: string; user_id: string; method: string | null },
  providerPaymentId: string,
  method?: Method,
  days = VALIDITY_DAYS,
) {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('payments')
      .set({
        status: 'SUCCEEDED',
        method: method ?? (payment.method as Method | null),
        provider_payment_id: providerPaymentId,
      })
      .where('id', '=', payment.id)
      .execute();
    const now = new Date();
    await trx
      .insertInto('contact_passes')
      .values({
        user_id: payment.user_id,
        payment_id: payment.id,
        starts_at: now,
        expires_at: new Date(now.getTime() + days * 86_400_000),
      })
      .onConflict((oc) => oc.column('payment_id').doNothing())
      .execute();
    return toPass(
      await trx
        .selectFrom('contact_passes')
        .selectAll()
        .where('payment_id', '=', payment.id)
        .executeTakeFirstOrThrow(),
    );
  });
}
