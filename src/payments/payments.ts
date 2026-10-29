import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { sql } from 'kysely';
import Razorpay from 'razorpay';
import { z } from 'zod';
import type { ContactPass, PassPlan, PassPlanId } from '@/features/payments/types';
import { holderRank, planPrice, upgradeOffer } from '@/features/payments/upgrade';
import type { ContactPassProof, ContactPassStatus } from '@/lib/api/contract';
import { ApiError, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser, Public } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { RateLimit } from '../common/rate-limit.js';
import { EXPIRE_AFTER_HOURS } from '../listings/listing.mapper.js';
import { seekerChats } from './reply-guarantee.js';

/** Same values as the web app's contactPassPlans. */
export const PLANS: Record<PassPlanId, PassPlan> = {
  MINI: { id: 'MINI', name: 'Mini', days: 3, priceInr: 99 },
  PRO: { id: 'PRO', name: 'Pro', days: 7, priceInr: 169 },
  MAX: { id: 'MAX', name: 'Max', days: 30, priceInr: 369 },
};
/** Passes bought before plans existed were all a week. */
const LEGACY_DAYS = 7;

/** The paywall shows a reply rate only once this many chats back it, so a thin start isn't advertised. */
const PROOF_MIN_CHATS = 20;
const PROOF_TTL_MS = 10 * 60_000;
const proofCache = new Map<string, { at: number; value: ContactPassProof }>();

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

/** HMAC-SHA256 hex check in constant time (the SDK's helpers compare with `===`). */
function signatureOk(payload: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const paymentFailed = (message: string, status = 400) =>
  new ApiError('PAYMENT_FAILED', message, status);

const toPass = (p: {
  id: string;
  user_id: string;
  payment_id: string;
  starts_at: Date;
  expires_at: Date;
  plan: string | null;
}): ContactPass => ({
  id: p.id,
  userId: p.user_id,
  paymentId: p.payment_id,
  startsAt: new Date(p.starts_at).toISOString(),
  expiresAt: new Date(p.expires_at).toISOString(),
  status: new Date(p.expires_at) > new Date() ? 'ACTIVE' : 'EXPIRED',
  plan: (p.plan as PassPlanId | null) ?? undefined,
});

@Controller()
export class PaymentsController {
  constructor(@InjectDb() private readonly db: Database) {}

  /** The user's unexpired passes (stacked ones included), latest expiry first. */
  private activePasses(userId: string) {
    return this.db
      .selectFrom('contact_passes')
      .selectAll()
      .where('user_id', '=', userId)
      .where('expires_at', '>', new Date())
      .orderBy('expires_at', 'desc')
      .execute();
  }

  @Get('contact-pass')
  async status(@CurrentUser() user: AuthUser): Promise<ContactPassStatus> {
    const passes = await this.activePasses(user.id);
    const plans = Object.values(PLANS);
    return {
      active: passes.length > 0,
      pass: passes[0] && toPass(passes[0]),
      plans,
      upgrade: upgradeOffer(plans, holderRank(passes.map((p) => p.plan as PassPlanId | null))),
    };
  }

  /** The paywall's proof: live listings (in a city, or everywhere) and how often listers answer. Public; cached. */
  @Public()
  @RateLimit(60, 60)
  @Get('contact-pass/proof')
  async proof(@Query() query: unknown): Promise<ContactPassProof> {
    const { city } = z.object({ city: z.string().trim().min(1).max(60).optional() }).parse(query);
    const key = city?.toLowerCase() ?? '';
    const hit = proofCache.get(key);
    if (hit && hit.at > Date.now() - PROOF_TTL_MS) return hit.value;
    const { rows } = await sql<{ live: string; chats: string; fast: string }>`
      select (select count(*) from public.listings where status = 'ACTIVE' and last_confirmed_at > now() - make_interval(hours => ${EXPIRE_AFTER_HOURS})
                ${city ? sql`and lower(city) = ${key}` : sql``}) as live,
             count(*) as chats, count(*) filter (where s.answered <= s.asked + interval '24 hours') as fast
      from (${seekerChats(sql`now() - interval '30 days'`)}) s
      where s.asked <= now() - interval '24 hours'`.execute(this.db);
    const chats = Number(rows[0]!.chats);
    const value = { liveListings: Number(rows[0]!.live), city, replyRate24h: chats >= PROOF_MIN_CHATS ? Number(rows[0]!.fast) / chats : null };
    // ponytail: per-instance cache keyed by whatever city callers send; cleared wholesale if it ever grows past the 8 real ones by much.
    if (proofCache.size > 50) proofCache.clear();
    proofCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Step 1 of checkout: an order the payment provider will charge against. */
  @RateLimit(20, 3600)
  @Post('payments/contact-pass/order')
  async order(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const plan = PLANS[z.object({ plan: z.enum(['MINI', 'PRO', 'MAX']) }).parse(body).plan];
    // Holders moving up to a longer plan get the upgrade discount; the price is decided here, never by the client.
    const passes = await this.activePasses(user.id);
    const amount = planPrice(plan, holderRank(passes.map((p) => p.plan as PassPlanId | null)));
    let providerOrderId = `order_${randomUUID()}`;
    if (razorpay) {
      // Razorpay charges in paise. The amount is fixed here, server-side, so the client can't change it.
      const order = await razorpay.orders
        .create({
          amount: amount * 100,
          currency: 'INR',
          receipt: `cp_${randomUUID().slice(0, 32)}`,
          notes: { userId: user.id, purpose: 'CONTACT_PASS', plan: plan.id },
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
        amount,
        plan: plan.id,
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
  @RateLimit(30, 3600)
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
      const valid = signatureOk(
        `${payment.provider_order_id}|${input.providerPaymentId}`,
        input.providerSignature,
        config.RAZORPAY_KEY_SECRET,
      );
      if (!valid)
        throw paymentFailed(
          'We couldn’t verify this payment. If money was deducted, please contact support.',
        );
      // The signature proves the payment was authorised, not that money was taken. Ask Razorpay, capture
      // it if needed, and grant only for the right order and amount — an uncaptured payment auto-refunds.
      const rp = await razorpay!.payments.fetch(input.providerPaymentId).catch(() => undefined);
      if (!rp || rp.order_id !== payment.provider_order_id || Number(rp.amount) !== payment.amount * 100)
        throw paymentFailed('We couldn’t verify this payment. If money was deducted, please contact support.');
      if (rp.status === 'authorized') {
        await razorpay!.payments.capture(rp.id, payment.amount * 100, 'INR').catch(() => {
          throw paymentFailed('We couldn’t complete this payment. You haven’t been charged — please try again.', 502);
        });
      } else if (rp.status !== 'captured') {
        throw paymentFailed('This payment didn’t go through. You haven’t been charged.');
      }
      providerPaymentId = input.providerPaymentId;
    } else if (payment.provider === 'MOCK') {
      // Leftover test orders must never turn into free passes once real payments are on.
      if (razorpay) throw paymentFailed('This order has expired. Please start the payment again.');
    } else {
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
      !signatureOk(raw, signature, config.RAZORPAY_WEBHOOK_SECRET)
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
    // Not one of our Contact Pass orders, the amount doesn't match, or it's already settled
    // (retries and replays must never undo a refund): nothing to grant.
    if (!payment || p.amount !== payment.amount * 100 || payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') return { ok: true };
    // The buyer deleted their account before the capture landed: no one to give a pass to. Admins refund it.
    if (!payment.user_id) return { ok: true };

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
  payment: { id: string; user_id: string | null; method: string | null; plan: string | null },
  providerPaymentId: string,
  method?: Method,
  /** Only for plan-less payments (admin complimentary passes). */
  days = LEGACY_DAYS,
) {
  const userId = payment.user_id;
  if (!userId) throw paymentFailed('The account for this payment was deleted.', 409);
  if (payment.plan) days = PLANS[payment.plan as PassPlanId].days;
  return db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('payments')
      .set({
        status: 'SUCCEEDED',
        method: method ?? (payment.method as Method | null),
        provider_payment_id: providerPaymentId,
      })
      .where('id', '=', payment.id)
      // A refunded payment stays refunded, whatever arrives late.
      .where('status', '!=', 'REFUNDED')
      .executeTakeFirst();
    if (!updated.numUpdatedRows) throw paymentFailed('This payment was refunded.', 409);
    // Renewing early stacks: the new pass starts when the current one ends, so no paid days are lost.
    // (greatest() skips the null from a user with no passes.)
    const { from } = await trx
      .selectFrom('contact_passes')
      .select(sql<Date>`greatest(max(expires_at), now())`.as('from'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    const startsAt = new Date(from);
    await trx
      .insertInto('contact_passes')
      .values({
        user_id: userId,
        payment_id: payment.id,
        plan: payment.plan,
        starts_at: startsAt,
        expires_at: new Date(startsAt.getTime() + days * 86_400_000),
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
