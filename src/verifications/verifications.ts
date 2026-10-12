import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Body, Controller, HttpCode, Injectable, Post } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Verification } from '@/features/profiles/types';
import { ApiError, invalid } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { sendEmail } from '../common/email.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { RateLimit } from '../common/rate-limit.js';

export const ID_BUCKET = 'id-documents';
const ID_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
const ID_MAX_BYTES = 8 * 1024 * 1024;

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;
/** Personal mailboxes can't prove an employer. */
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'rediffmail.com', 'proton.me', 'protonmail.com', 'aol.com', 'zoho.com', 'zohomail.in', 'gmx.com', 'yandex.com']);

const hashCode = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest();
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

type Row = { id: string; user_id: string; type: string; status: string; verified_at: Date | null; document_type: string | null; detail: string | null; submitted_at: Date | null; review_note: string | null };
export const toVerification = (v: Row): Verification => ({
  id: v.id,
  userId: v.user_id,
  type: v.type as Verification['type'],
  status: v.status as Verification['status'],
  verifiedAt: iso(v.verified_at),
  documentType: (v.document_type ?? undefined) as Verification['documentType'],
  detail: v.detail ?? undefined,
  submittedAt: iso(v.submitted_at),
  reviewNote: v.review_note ?? undefined,
});

@Injectable()
export class VerificationsService {
  private readonly storage = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(ID_BUCKET);

  constructor(@InjectDb() private readonly db: Database) {}

  /** A signed, one-off upload slot in the private bucket, under the user's own folder. */
  async identityUpload(userId: string, contentType: keyof typeof ID_TYPES) {
    const path = `${userId}/${randomUUID()}.${ID_TYPES[contentType]}`;
    const { data, error } = await this.storage.createSignedUploadUrl(path);
    if (error || !data) throw new ApiError('UNKNOWN', 'Uploads are unavailable right now. Try again shortly.', 503);
    return { path, uploadUrl: data.signedUrl, headers: { 'Content-Type': contentType } };
  }

  /** Queues the uploaded ID for admin review. Replaces (and deletes) an earlier pending upload. */
  async submitIdentity(userId: string, path: string, documentType: string): Promise<Verification> {
    // Exactly the shape our upload ticket issues: the caller's folder, a uuid, a known extension. No `..`, no other folders.
    if (!new RegExp(`^${userId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(path)) throw invalid('That upload doesn’t belong to you.');
    const folder = path.slice(0, path.lastIndexOf('/'));
    const { data: files } = await this.storage.list(folder, { search: path.slice(path.lastIndexOf('/') + 1) });
    if (!files?.length) throw new ApiError('VALIDATION', 'The file hasn’t finished uploading.', 409);

    const existing = await this.db.selectFrom('verifications').selectAll().where('user_id', '=', userId).where('type', '=', 'IDENTITY').executeTakeFirst();
    if (existing?.status === 'VERIFIED') throw invalid('Your identity is already verified.');
    if (existing?.document_path && existing.document_path !== path) await this.storage.remove([existing.document_path]);

    const row = await this.db
      .insertInto('verifications')
      .values({ user_id: userId, type: 'IDENTITY', status: 'PENDING', document_type: documentType, document_path: path, submitted_at: new Date(), review_note: null })
      .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ status: 'PENDING', document_type: documentType, document_path: path, submitted_at: new Date(), review_note: null, verified_at: null }))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toVerification(row);
  }

  async sendWorkCode(userId: string, email: string) {
    const domain = email.split('@')[1]!.toLowerCase();
    if (FREE_MAIL.has(domain)) throw invalid('Use your company email, not a personal one.');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const values = { domain, code_hash: hashCode(userId, code).toString('hex'), expires_at: expiresAt, attempts: 0, sent_at: new Date() };
    // Claim the send slot in one statement (insert, or replace a code older than a minute) before emailing,
    // so parallel requests can't each send a mail.
    const claimed = await this.db
      .insertInto('work_email_codes')
      .values({ user_id: userId, ...values })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(values).where('work_email_codes.sent_at', '<', new Date(Date.now() - RESEND_AFTER_MS)))
      .returning('user_id')
      .executeTakeFirst();
    if (!claimed) throw new ApiError('RATE_LIMITED', 'A code was just sent. Wait a minute before asking for another.', 429);
    try {
      await this.deliver(email, code);
    } catch (e) {
      // Not sent: free the slot so they can try again straight away.
      await this.db.deleteFrom('work_email_codes').where('user_id', '=', userId).execute();
      throw e;
    }
    return { domain, expiresAt: expiresAt.toISOString() };
  }

  async confirmWorkCode(userId: string, code: string): Promise<Verification> {
    // Count the attempt and read the code in one statement, so parallel guesses can't share one "attempts" read.
    const pending = await this.db
      .updateTable('work_email_codes')
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('user_id', '=', userId)
      .where('attempts', '<', MAX_ATTEMPTS)
      .where('expires_at', '>', new Date())
      .returningAll()
      .executeTakeFirst();
    if (!pending) {
      const exists = await this.db.selectFrom('work_email_codes').select(['attempts', 'expires_at']).where('user_id', '=', userId).executeTakeFirst();
      if (exists && new Date(exists.expires_at) > new Date()) throw new ApiError('RATE_LIMITED', 'Too many attempts. Request a new code.', 429);
      throw new ApiError('OTP_EXPIRED', 'That code has expired. Request a new one.', 410);
    }
    if (!timingSafeEqual(Buffer.from(pending.code_hash, 'hex'), hashCode(userId, code))) throw new ApiError('OTP_INVALID', 'That code isn’t right. Check your work inbox and try again.', 401);

    const row = await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('work_email_codes').where('user_id', '=', userId).execute();
      const now = new Date();
      return trx
        .insertInto('verifications')
        .values({ user_id: userId, type: 'WORKPLACE', status: 'VERIFIED', verified_at: now, submitted_at: now, detail: pending.domain })
        .onConflict((oc) => oc.columns(['user_id', 'type']).doUpdateSet({ status: 'VERIFIED', verified_at: now, submitted_at: now, detail: pending.domain, review_note: null }))
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return toVerification(row);
  }

  /** Sends the code through Resend. Without a key, local development prints it to the log instead. */
  private async deliver(email: string, code: string) {
    if (!config.RESEND_API_KEY && process.env.NODE_ENV === 'production') throw new ApiError('UNKNOWN', 'Work email verification isn’t available yet.', 503);
    const sent = await sendEmail(
      email,
      `${code} is your FindFlatmates verification code`,
      `Your code is ${code}. It expires in 10 minutes.\n\nEnter it on your FindFlatmates profile to verify where you work. If you didn't ask for this, you can ignore this email.`,
    );
    if (!sent) throw new ApiError('UNKNOWN', 'We couldn’t send the email right now. Try again shortly.', 502);
  }
}

@Controller('verifications')
export class VerificationsController {
  constructor(private readonly verifications: VerificationsService) {}

  @RateLimit(10, 3600)
  @Post('identity/upload')
  identityUpload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { contentType, sizeBytes } = z
      .object({ contentType: z.enum(Object.keys(ID_TYPES) as [keyof typeof ID_TYPES, ...(keyof typeof ID_TYPES)[]]), sizeBytes: z.number().int().positive().max(ID_MAX_BYTES, 'Files must be under 8 MB.') })
      .parse(body);
    void sizeBytes;
    return this.verifications.identityUpload(user.id, contentType);
  }

  @RateLimit(10, 3600)
  @Post('identity')
  submitIdentity(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { path, documentType } = z.object({ path: z.string().max(200), documentType: z.enum(['AADHAAR', 'PAN', 'DRIVING_LICENCE', 'PASSPORT', 'VOTER_ID']) }).parse(body);
    return this.verifications.submitIdentity(user.id, path, documentType);
  }

  @RateLimit(5, 3600)
  @Post('workplace/send')
  sendWorkCode(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { email } = z.object({ email: z.email('Enter your work email address.').max(254) }).parse(body);
    return this.verifications.sendWorkCode(user.id, email.trim());
  }

  @RateLimit(20, 3600)
  @Post('workplace/confirm')
  @HttpCode(200)
  confirmWorkCode(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).parse(body);
    return this.verifications.confirmWorkCode(user.id, code);
  }
}
