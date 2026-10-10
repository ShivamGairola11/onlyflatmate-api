import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  type CanActivate,
  type ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { type Expression, type SqlBool, sql } from 'kysely';
import { z } from 'zod';
import type {
  AdminListing,
  AdminPage,
  AdminPass,
  AdminPayment,
  AdminReport,
  AdminStats,
  AdminUser,
  AdminUserRef,
  AdminVerification,
} from '@/lib/api/contract';
import { ApiError, forbidden, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import {
  EXPIRE_AFTER_HOURS,
  STALE_AFTER_HOURS,
} from '../listings/listing.mapper.js';
import { grantPass, RZP_METHOD, razorpay } from '../payments/payments.js';

const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

/** Every /admin route: the signed-in user must have profiles.is_admin. Runs after the global AuthGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectDb() private readonly db: Database) {}

  async canActivate(ctx: ExecutionContext) {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    const me =
      user &&
      (await this.db
        .selectFrom('profiles')
        .select('is_admin')
        .where('user_id', '=', user.id)
        .executeTakeFirst());
    if (!me?.is_admin) throw forbidden('Admins only.');
    return true;
  }
}

const listQuery = z.object({
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined),
  status: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : undefined;
const ref = (r: {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}): AdminUserRef => ({
  id: r.user_id,
  name: r.display_name || 'Unnamed',
  email: r.email ?? undefined,
  phone: r.phone ?? undefined,
});
const pageOf = <T>(items: T[], total: number, page: number): AdminPage<T> => ({
  items,
  total,
  page,
  pageSize: PAGE_SIZE,
});
/** `count(*) over ()` rides along on each row so one query returns the page and the total. */
const totalOf = (rows: { total: string | number }[]) =>
  Number(rows[0]?.total ?? 0);
const total = sql<string>`count(*) over ()`.as('total');
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  private readonly log = new Logger('Admin');
  private readonly supabase = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  constructor(@InjectDb() private readonly db: Database) {}

  /* ---------------------------------------------------------------- overview */

  @Get('stats')
  async stats(): Promise<AdminStats> {
    const n = sql<string>`count(*)`.as('n');
    const one = <T>(q: { executeTakeFirstOrThrow(): Promise<T> }) =>
      q.executeTakeFirstOrThrow();
    const ago = (days: number) => new Date(Date.now() - days * DAY_MS);
    const [
      listings,
      active,
      stale,
      users,
      newUsers,
      reports,
      payments,
      revenue30d,
      verifications,
      passes,
      conversations,
      messages,
    ] = await Promise.all([
      one(this.db.selectFrom('listings').select(n)),
      one(
        this.db
          .selectFrom('listings')
          .select(n)
          .where('status', '=', 'ACTIVE')
          .where(
            sql<boolean>`last_confirmed_at > now() - make_interval(hours => ${STALE_AFTER_HOURS})`,
          ),
      ),
      one(
        this.db
          .selectFrom('listings')
          .select(n)
          .where('status', '=', 'ACTIVE')
          .where(
            sql<boolean>`last_confirmed_at between now() - make_interval(hours => ${EXPIRE_AFTER_HOURS}) and now() - make_interval(hours => ${STALE_AFTER_HOURS})`,
          ),
      ),
      one(this.db.selectFrom('profiles').select(n)),
      one(
        this.db
          .selectFrom('profiles')
          .select(n)
          .where('created_at', '>', ago(7)),
      ),
      one(this.db.selectFrom('reports').select(n).where('status', '=', 'OPEN')),
      // Complimentary passes are ₹0 payments; they aren't sales.
      one(
        this.db
          .selectFrom('payments')
          .select([n, sql<string>`coalesce(sum(amount), 0)`.as('sum')])
          .where('status', '=', 'SUCCEEDED')
          .where('amount', '>', 0),
      ),
      one(
        this.db
          .selectFrom('payments')
          .select(sql<string>`coalesce(sum(amount), 0)`.as('sum'))
          .where('status', '=', 'SUCCEEDED')
          .where('created_at', '>', ago(30)),
      ),
      one(
        this.db
          .selectFrom('verifications')
          .select(n)
          .where('status', '=', 'PENDING'),
      ),
      one(
        this.db
          .selectFrom('contact_passes')
          .select(n)
          .where('expires_at', '>', new Date()),
      ),
      one(this.db.selectFrom('conversations').select(n)),
      one(
        this.db.selectFrom('messages').select(n).where('sent_at', '>', ago(7)),
      ),
    ]);
    return {
      listings: Number(listings.n),
      activeListings: Number(active.n),
      staleListings: Number(stale.n),
      users: Number(users.n),
      newUsers7d: Number(newUsers.n),
      openReports: Number(reports.n),
      payments: Number(payments.n),
      revenueInr: Number(payments.sum),
      revenue30dInr: Number(revenue30d.sum),
      pendingVerifications: Number(verifications.n),
      activePasses: Number(passes.n),
      conversations: Number(conversations.n),
      messages7d: Number(messages.n),
    };
  }

  /* ------------------------------------------------------------------- users */

  @Get('users')
  async users(@Query() query: unknown): Promise<AdminPage<AdminUser>> {
    const { q, status, page } = listQuery.parse(query);
    const rows = await this.db
      .selectFrom('profiles as p')
      .innerJoin('auth.users as u', 'u.id', 'p.user_id')
      .select([
        'p.user_id',
        'p.display_name',
        'p.is_admin',
        'p.created_at',
        'p.last_active_at',
        'u.email',
        'u.phone',
        'u.banned_until',
        total,
      ])
      .select([
        sql<string>`(select count(*) from listings l where l.lister_id = p.user_id)`.as(
          'listings',
        ),
        sql<string>`(select coalesce(sum(amount), 0) from payments pa where pa.user_id = p.user_id and pa.status = 'SUCCEEDED')`.as(
          'paid',
        ),
        sql<Date | null>`(select max(expires_at) from contact_passes c where c.user_id = p.user_id and c.expires_at > now())`.as(
          'pass_until',
        ),
      ])
      .$if(!!q, (qb) =>
        qb.where((eb) => {
          const ors: Expression<SqlBool>[] = [
            eb('p.display_name', 'ilike', like(q!)),
            eb('u.email', 'ilike', like(q!)),
            eb('u.phone', 'ilike', like(q!.replace(/^\+/, ''))),
          ];
          if (uuidRe.test(q!)) ors.push(eb('p.user_id', '=', q!));
          return eb.or(ors);
        }),
      )
      .$if(status === 'ADMIN', (qb) => qb.where('p.is_admin', '=', true))
      .$if(status === 'BANNED', (qb) =>
        qb.where('u.banned_until', '>', new Date()),
      )
      .$if(status === 'PASS', (qb) =>
        qb.where(
          sql<boolean>`exists (select 1 from contact_passes c where c.user_id = p.user_id and c.expires_at > now())`,
        ),
      )
      .orderBy('p.created_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminUser => ({
      ...ref(r),
      createdAt: iso(r.created_at)!,
      lastActiveAt: iso(r.last_active_at)!,
      isAdmin: r.is_admin,
      bannedUntil:
        r.banned_until && new Date(r.banned_until) > new Date()
          ? iso(r.banned_until)
          : undefined,
      listings: Number(r.listings),
      totalPaidInr: Number(r.paid),
      passExpiresAt: iso(r.pass_until),
    }));
    return pageOf(items, totalOf(rows), page);
  }

  /** Bans block sign-in and token refresh. A token already issued keeps working until it expires (≤ 1 hour). */
  @Post('users/:id/ban')
  @HttpCode(204)
  async ban(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { banned } = z.object({ banned: z.boolean() }).parse(body);
    if (id === me.id) throw invalid('You can’t ban yourself.');
    const { error } = await this.supabase.auth.admin.updateUserById(id, {
      ban_duration: banned ? '876000h' : 'none',
    });
    if (error)
      throw new ApiError(
        'UNKNOWN',
        `Couldn’t update the account: ${error.message}`,
        502,
      );
    // Their listings come down with them; unbanning doesn't relist (the lister reconfirms).
    if (banned)
      await this.db
        .updateTable('listings')
        .set({ status: 'EXPIRED' })
        .where('lister_id', '=', id)
        .where('status', '=', 'ACTIVE')
        .execute();
    this.log.log(`${me.id} ${banned ? 'banned' : 'unbanned'} user ${id}`);
  }

  @Post('users/:id/admin')
  @HttpCode(204)
  async setAdmin(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(body);
    if (id === me.id && !isAdmin)
      throw invalid('You can’t remove your own admin access.');
    const r = await this.db
      .updateTable('profiles')
      .set({ is_admin: isAdmin })
      .where('user_id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('User not found');
    this.log.log(`${me.id} ${isAdmin ? 'granted' : 'revoked'} admin for ${id}`);
  }

  /* ---------------------------------------------------------------- payments */

  @Get('payments')
  async payments(@Query() query: unknown): Promise<AdminPage<AdminPayment>> {
    const { q, status, page } = listQuery.parse(query);
    const rows = await this.db
      .selectFrom('payments as pa')
      .innerJoin('profiles as p', 'p.user_id', 'pa.user_id')
      .innerJoin('auth.users as u', 'u.id', 'pa.user_id')
      .leftJoin('contact_passes as c', 'c.payment_id', 'pa.id')
      .select([
        'pa.id',
        'pa.amount',
        'pa.provider',
        'pa.provider_order_id',
        'pa.provider_payment_id',
        'pa.method',
        'pa.status',
        'pa.created_at',
        'p.user_id',
        'p.display_name',
        'u.email',
        'u.phone',
        'c.id as pass_id',
        'c.expires_at as pass_expires_at',
        total,
      ])
      .$if(!!q, (qb) =>
        qb.where((eb) => {
          const ors: Expression<SqlBool>[] = [
            eb('u.email', 'ilike', like(q!)),
            eb('u.phone', 'ilike', like(q!.replace(/^\+/, ''))),
            eb('p.display_name', 'ilike', like(q!)),
            eb('pa.provider_order_id', '=', q!),
            eb('pa.provider_payment_id', '=', q!),
          ];
          if (uuidRe.test(q!))
            ors.push(eb('pa.id', '=', q!), eb('pa.user_id', '=', q!));
          return eb.or(ors);
        }),
      )
      .$if(!!status, (qb) => qb.where('pa.status', '=', status!))
      .orderBy('pa.created_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminPayment => ({
      id: r.id,
      user: ref(r),
      amount: r.amount,
      provider: r.provider as AdminPayment['provider'],
      providerOrderId: r.provider_order_id,
      providerPaymentId: r.provider_payment_id ?? undefined,
      method: (r.method ?? undefined) as AdminPayment['method'],
      status: r.status as AdminPayment['status'],
      createdAt: iso(r.created_at)!,
      pass: r.pass_id
        ? { id: r.pass_id, expiresAt: iso(r.pass_expires_at)! }
        : undefined,
    }));
    return pageOf(items, totalOf(rows), page);
  }

  /** Full refund. Razorpay payments are refunded through Razorpay first; the pass ends now either way. */
  @Post('payments/:id/refund')
  @HttpCode(204)
  async refund(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const payment = await this.db
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!payment) throw notFound('Payment not found');
    if (payment.status !== 'SUCCEEDED')
      throw invalid(
        `Only paid payments can be refunded (this one is ${payment.status.toLowerCase()}).`,
      );
    if (payment.amount === 0)
      throw invalid(
        'Complimentary passes have nothing to refund — revoke the pass instead.',
      );

    if (payment.provider === 'RAZORPAY') {
      if (!razorpay || !payment.provider_payment_id)
        throw new ApiError(
          'PAYMENT_FAILED',
          'Razorpay isn’t configured on this server.',
          503,
        );
      await razorpay.payments
        .refund(payment.provider_payment_id, {
          notes: { reason: 'Refunded by admin', admin: me.id },
        })
        .catch((e: { error?: { description?: string } }) => {
          throw new ApiError(
            'PAYMENT_FAILED',
            `Razorpay refused the refund: ${e.error?.description ?? 'unknown error'}`,
            502,
          );
        });
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('payments')
        .set({ status: 'REFUNDED' })
        .where('id', '=', id)
        .execute();
      await trx
        .updateTable('contact_passes')
        .set({ expires_at: new Date() })
        .where('payment_id', '=', id)
        .where('expires_at', '>', new Date())
        .execute();
    });
    this.log.log(
      `${me.id} refunded payment ${id} (₹${payment.amount}, ${payment.provider})`,
    );
  }

  /**
   * For a payment stuck before "paid" (browser closed, webhook missed): ask Razorpay what happened to the
   * order. A captured payment grants the pass; an authorized one is captured first.
   */
  @Post('payments/:id/sync')
  @HttpCode(204)
  async sync(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const payment = await this.db
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!payment) throw notFound('Payment not found');
    if (payment.provider !== 'RAZORPAY')
      throw invalid('Only Razorpay payments can be checked with the provider.');
    if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED')
      throw invalid(`This payment is already ${payment.status.toLowerCase()}.`);
    if (!razorpay)
      throw new ApiError(
        'PAYMENT_FAILED',
        'Razorpay isn’t configured on this server.',
        503,
      );

    const { items } = await razorpay.orders.fetchPayments(
      payment.provider_order_id,
    );
    let paid = items.find((p) => p.status === 'captured');
    const authorized = !paid && items.find((p) => p.status === 'authorized');
    if (authorized)
      paid = await razorpay.payments.capture(
        authorized.id,
        authorized.amount,
        'INR',
      );
    if (!paid) {
      if (items.length && items.every((p) => p.status === 'failed'))
        await this.db
          .updateTable('payments')
          .set({ status: 'FAILED' })
          .where('id', '=', id)
          .execute();
      throw invalid(
        items.length
          ? 'Razorpay has no successful payment for this order.'
          : 'The customer never completed this payment.',
      );
    }
    if (Number(paid.amount) !== payment.amount * 100)
      throw invalid(
        `Amount mismatch: Razorpay captured ₹${Number(paid.amount) / 100}, expected ₹${payment.amount}.`,
      );
    await grantPass(this.db, payment, paid.id, RZP_METHOD[paid.method]);
    this.log.log(`${me.id} synced payment ${id} → granted pass`);
  }

  /* ------------------------------------------------------------------ passes */

  @Get('passes')
  async passes(@Query() query: unknown): Promise<AdminPage<AdminPass>> {
    const { q, status, page } = listQuery.parse(query);
    const now = new Date();
    const rows = await this.db
      .selectFrom('contact_passes as c')
      .innerJoin('payments as pa', 'pa.id', 'c.payment_id')
      .innerJoin('profiles as p', 'p.user_id', 'c.user_id')
      .innerJoin('auth.users as u', 'u.id', 'c.user_id')
      .select([
        'c.id',
        'c.starts_at',
        'c.expires_at',
        'c.payment_id',
        'pa.amount',
        'p.user_id',
        'p.display_name',
        'u.email',
        'u.phone',
        total,
      ])
      .$if(!!q, (qb) =>
        qb.where((eb) => {
          const ors: Expression<SqlBool>[] = [
            eb('u.email', 'ilike', like(q!)),
            eb('u.phone', 'ilike', like(q!.replace(/^\+/, ''))),
            eb('p.display_name', 'ilike', like(q!)),
          ];
          if (uuidRe.test(q!))
            ors.push(eb('c.user_id', '=', q!), eb('c.id', '=', q!));
          return eb.or(ors);
        }),
      )
      .$if(status === 'ACTIVE', (qb) => qb.where('c.expires_at', '>', now))
      .$if(status === 'EXPIRED', (qb) => qb.where('c.expires_at', '<=', now))
      .orderBy('c.expires_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminPass => ({
      id: r.id,
      user: ref(r),
      startsAt: iso(r.starts_at)!,
      expiresAt: iso(r.expires_at)!,
      active: new Date(r.expires_at) > now,
      paymentId: r.payment_id,
      amount: r.amount,
      complimentary: r.amount === 0,
    }));
    return pageOf(items, totalOf(rows), page);
  }

  /** Adds days to the pass — from its expiry if still running, from now if it already lapsed. */
  @Post('passes/:id/extend')
  @HttpCode(204)
  async extendPass(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { days } = z
      .object({ days: z.number().int().min(1).max(365) })
      .parse(body);
    const r = await this.db
      .updateTable('contact_passes')
      .set({
        expires_at: sql<Date>`greatest(expires_at, now()) + make_interval(days => ${days})`,
      })
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Pass not found');
    this.log.log(`${me.id} extended pass ${id} by ${days}d`);
  }

  @Post('passes/:id/revoke')
  @HttpCode(204)
  async revokePass(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const r = await this.db
      .updateTable('contact_passes')
      .set({ expires_at: new Date() })
      .where('id', '=', id)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw invalid('That pass isn’t active.');
    this.log.log(`${me.id} revoked pass ${id}`);
  }

  /** A complimentary pass: recorded as a ₹0 payment so every pass still traces back to a payment row. */
  @Post('passes')
  @HttpCode(204)
  async grant(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    const { userId, days } = z
      .object({ userId: z.uuid(), days: z.number().int().min(1).max(365) })
      .parse(body);
    const user = await this.db
      .selectFrom('profiles')
      .select('user_id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!user) throw notFound('User not found');
    const payment = await this.db
      .insertInto('payments')
      .values({
        user_id: userId,
        amount: 0,
        provider: 'MOCK',
        provider_order_id: `comp_${crypto.randomUUID()}`,
        status: 'CREATED',
      })
      .returning(['id', 'user_id', 'method'])
      .executeTakeFirstOrThrow();
    await grantPass(this.db, payment, `comp_by_${me.id}`, undefined, days);
    this.log.log(`${me.id} granted a ${days}d complimentary pass to ${userId}`);
  }

  /* ---------------------------------------------------------------- listings */

  @Get('listings')
  async listings(@Query() query: unknown): Promise<AdminPage<AdminListing>> {
    const { q, status, page } = listQuery.parse(query);
    const rows = await this.db
      .selectFrom('listings as l')
      .innerJoin('profiles as p', 'p.user_id', 'l.lister_id')
      .innerJoin('auth.users as u', 'u.id', 'l.lister_id')
      .select([
        'l.id',
        'l.title',
        'l.type',
        'l.locality',
        'l.city',
        'l.rent',
        'l.status',
        'l.created_at',
        'l.last_confirmed_at',
        'l.view_count',
        'p.user_id',
        'p.display_name',
        'u.email',
        'u.phone',
        total,
      ])
      .select(
        sql<string>`(select count(*) from reports r where r.target_type = 'LISTING' and r.target_id = l.id and r.status = 'OPEN')`.as(
          'open_reports',
        ),
      )
      .$if(!!q, (qb) =>
        qb.where((eb) => {
          const ors: Expression<SqlBool>[] = [
            eb('l.title', 'ilike', like(q!)),
            eb('l.locality', 'ilike', like(q!)),
            eb('p.display_name', 'ilike', like(q!)),
            eb('u.email', 'ilike', like(q!)),
          ];
          if (uuidRe.test(q!))
            ors.push(eb('l.id', '=', q!), eb('l.lister_id', '=', q!));
          return eb.or(ors);
        }),
      )
      .$if(status === 'REPORTED', (qb) =>
        qb.where(
          sql<boolean>`exists (select 1 from reports r where r.target_type = 'LISTING' and r.target_id = l.id and r.status = 'OPEN')`,
        ),
      )
      .$if(!!status && status !== 'REPORTED', (qb) =>
        qb.where('l.status', '=', status!),
      )
      .orderBy('l.created_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminListing => ({
      id: r.id,
      title: r.title,
      type: r.type as AdminListing['type'],
      locality: r.locality ?? '',
      city: r.city ?? '',
      rent: r.rent,
      status: r.status as AdminListing['status'],
      lister: ref(r),
      createdAt: iso(r.created_at)!,
      lastConfirmedAt: iso(r.last_confirmed_at)!,
      views: r.view_count,
      openReports: Number(r.open_reports),
    }));
    return pageOf(items, totalOf(rows), page);
  }

  /** EXPIRED takes a listing out of search (a takedown); ACTIVE puts it back and counts as a fresh confirmation. */
  @Post('listings/:id/status')
  @HttpCode(204)
  async setListingStatus(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { status } = z
      .object({ status: z.enum(['ACTIVE', 'EXPIRED', 'OCCUPIED']) })
      .parse(body);
    const r = await this.db
      .updateTable('listings')
      .set(
        status === 'ACTIVE'
          ? { status, last_confirmed_at: new Date() }
          : { status },
      )
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Listing not found');
    this.log.log(`${me.id} set listing ${id} → ${status}`);
  }

  /* ----------------------------------------------------------------- reports */

  @Get('reports')
  async reports(@Query() query: unknown): Promise<AdminPage<AdminReport>> {
    const { q, status, page } = listQuery.parse(query);
    const rows = await this.db
      .selectFrom('reports as r')
      .innerJoin('profiles as p', 'p.user_id', 'r.reporter_id')
      .innerJoin('auth.users as u', 'u.id', 'r.reporter_id')
      .leftJoin('listings as tl', (j) =>
        j
          .on('r.target_type', '=', 'LISTING')
          .on(sql<boolean>`tl.id::text = r.target_id::text`),
      )
      .leftJoin('profiles as tp', (j) =>
        j
          .on('r.target_type', '=', 'USER')
          .on(sql<boolean>`tp.user_id::text = r.target_id::text`),
      )
      .leftJoin('groups as tg', (j) =>
        j
          .on('r.target_type', '=', 'GROUP')
          .on(sql<boolean>`tg.id::text = r.target_id::text`),
      )
      .select([
        'r.id',
        'r.target_type',
        'r.target_id',
        'r.reason',
        'r.details',
        'r.status',
        'r.created_at',
        'p.user_id',
        'p.display_name',
        'u.email',
        'u.phone',
        total,
      ])
      .select([
        sql<string | null>`coalesce(tl.title, tp.display_name, tg.name)`.as(
          'target_label',
        ),
        sql<string | null>`coalesce(tl.lister_id, tp.user_id, tg.owner_id)`.as(
          'target_user_id',
        ),
      ])
      .$if(!!q, (qb) =>
        qb.where((eb) => {
          const ors: Expression<SqlBool>[] = [
            eb('r.details', 'ilike', like(q!)),
            eb('p.display_name', 'ilike', like(q!)),
            eb(
              sql<string>`coalesce(tl.title, tp.display_name, tg.name)`,
              'ilike',
              like(q!),
            ),
          ];
          if (uuidRe.test(q!))
            ors.push(eb('r.target_id', '=', q!), eb('r.id', '=', q!));
          return eb.or(ors);
        }),
      )
      .$if(!!status, (qb) => qb.where('r.status', '=', status!))
      .orderBy('r.created_at', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminReport => ({
      id: r.id,
      reporter: ref(r),
      targetType: r.target_type as AdminReport['targetType'],
      targetId: r.target_id,
      targetLabel: r.target_label ?? undefined,
      targetUserId: r.target_user_id ?? undefined,
      reason: r.reason as AdminReport['reason'],
      details: r.details ?? undefined,
      status: r.status as AdminReport['status'],
      createdAt: iso(r.created_at)!,
    }));
    return pageOf(items, totalOf(rows), page);
  }

  @Post('reports/:id/status')
  @HttpCode(204)
  async setReportStatus(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { status } = z
      .object({ status: z.enum(['OPEN', 'REVIEWED', 'ACTIONED']) })
      .parse(body);
    const r = await this.db
      .updateTable('reports')
      .set({ status })
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Report not found');
    this.log.log(`${me.id} set report ${id} → ${status}`);
  }

  /* ----------------------------------------------------------- verifications */

  @Get('verifications')
  async verifications(
    @Query() query: unknown,
  ): Promise<AdminPage<AdminVerification>> {
    const { q, status, page } = listQuery.parse(query);
    const rows = await this.db
      .selectFrom('verifications as v')
      .innerJoin('profiles as p', 'p.user_id', 'v.user_id')
      .innerJoin('auth.users as u', 'u.id', 'v.user_id')
      .select([
        'v.id',
        'v.type',
        'v.status',
        'v.verified_at',
        'p.user_id',
        'p.display_name',
        'u.email',
        'u.phone',
        total,
      ])
      .$if(!!q, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('p.display_name', 'ilike', like(q!)),
            eb('u.email', 'ilike', like(q!)),
            eb('u.phone', 'ilike', like(q!.replace(/^\+/, ''))),
          ]),
        ),
      )
      .$if(!!status, (qb) => qb.where('v.status', '=', status!))
      .orderBy('v.status', 'asc')
      .orderBy('v.id')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute();
    const items = rows.map((r): AdminVerification => ({
      id: r.id,
      user: ref(r),
      type: r.type as AdminVerification['type'],
      status: r.status as AdminVerification['status'],
      verifiedAt: iso(r.verified_at),
    }));
    return pageOf(items, totalOf(rows), page);
  }

  @Post('verifications/:id/status')
  @HttpCode(204)
  async setVerificationStatus(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { status } = z
      .object({ status: z.enum(['VERIFIED', 'REJECTED']) })
      .parse(body);
    const r = await this.db
      .updateTable('verifications')
      .set({ status, verified_at: status === 'VERIFIED' ? new Date() : null })
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r.numUpdatedRows) throw notFound('Verification not found');
    this.log.log(`${me.id} set verification ${id} → ${status}`);
  }
}
