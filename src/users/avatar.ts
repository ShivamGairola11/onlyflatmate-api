import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, HttpCode, Injectable, Logger, Post } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { sql } from 'kysely';
import sharp, { type Metadata } from 'sharp';

// Decoded images aren't kept in memory between requests, and one decode can't take every core.
sharp.cache(false);
sharp.concurrency(2);
import { z } from 'zod';
import { ApiError, invalid } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { RateLimit } from '../common/rate-limit.js';

const STAGING = 'avatar-uploads';
const PUBLIC = 'avatars';
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
/** Decoded size cap: rejects "decompression bombs" (tiny files that expand to huge images). */
const MAX_PIXELS = 40_000_000;
const SIZE = 512;

/**
 * Profile photos. The browser uploads to a private staging bucket; nothing reaches the public bucket until
 * the API has decoded it (by content, not by extension or claimed type), checked format and size, and
 * re-encoded it — which also drops EXIF metadata such as GPS location.
 */
@Injectable()
export class AvatarService {
  private readonly log = new Logger('Avatars');
  private readonly client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  /** One upload per user per few seconds; per process is enough to stop hammering. */

  constructor(@InjectDb() private readonly db: Database) {}

  async uploadSlot(userId: string, contentType: (typeof TYPES)[number]) {
    const path = `${userId}/${randomUUID()}`;
    const { data, error } = await this.client.storage.from(STAGING).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError('UNKNOWN', 'Uploads are unavailable right now. Try again shortly.', 503);
    return { path, uploadUrl: data.signedUrl, headers: { 'Content-Type': contentType } };
  }

  async publish(userId: string, path: string) {
    if (!path.startsWith(`${userId}/`) || path.includes('..')) throw invalid('That upload doesn’t belong to you.');

    const staging = this.client.storage.from(STAGING);
    try {
      const { data: blob, error } = await staging.download(path);
      if (error || !blob) throw new ApiError('VALIDATION', 'The photo hasn’t finished uploading.', 409);
      if (blob.size > MAX_BYTES) throw invalid('Photos must be under 5 MB.');
      const input = Buffer.from(await blob.arrayBuffer());

      // Decode by content. Anything that isn't really a JPEG/PNG/WebP — including SVG, HTML or a renamed file — fails here.
      let meta: Metadata;
      try {
        meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
      } catch {
        throw invalid('That file isn’t a supported image. Use a JPG, PNG or WebP photo.');
      }
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw invalid('Use a JPG, PNG or WebP photo.');
      if ((meta.width ?? 0) < 96 || (meta.height ?? 0) < 96) throw invalid('That photo is too small — use one at least 96 × 96 pixels.');

      // Re-encode: upright (EXIF orientation applied), square crop, WebP. Metadata is not copied over.
      const output = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
        .rotate()
        .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();

      const key = `${userId}/${randomUUID()}.webp`;
      const pub = this.client.storage.from(PUBLIC);
      const { error: upErr } = await pub.upload(key, output, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (upErr) throw new ApiError('UNKNOWN', 'Couldn’t save the photo. Try again.', 502);
      const avatarUrl = pub.getPublicUrl(key).data.publicUrl;

      const previous = await this.db.selectFrom('profiles').select('avatar_url').where('user_id', '=', userId).executeTakeFirst();
      try {
        await this.db.updateTable('profiles').set({ avatar_url: avatarUrl }).where('user_id', '=', userId).execute();
      } catch (e) {
        await pub.remove([key]).catch(() => undefined); // don't leave an orphaned public file behind
        throw e;
      }
      await this.removeOwned(previous?.avatar_url);
      this.log.log(`${userId} set a new profile photo (${meta.format} ${meta.width}×${meta.height} → webp ${SIZE}px)`);
      return { avatarUrl };
    } finally {
      // The raw upload is never kept, whatever happened.
      await staging.remove([path]).catch(() => undefined);
    }
  }

  async useProvider(userId: string) {
    const row = await sql<{ url: string | null }>`select public.provider_avatar(raw_user_meta_data) as url from auth.users where id = ${userId}`.execute(this.db);
    const url = row.rows[0]?.url;
    if (!url) throw invalid('No sign-in photo is available for this account.');
    const previous = await this.db.selectFrom('profiles').select('avatar_url').where('user_id', '=', userId).executeTakeFirst();
    await this.db.updateTable('profiles').set({ avatar_url: url }).where('user_id', '=', userId).execute();
    await this.removeOwned(previous?.avatar_url);
    return { avatarUrl: url };
  }

  async remove(userId: string) {
    const previous = await this.db.selectFrom('profiles').select('avatar_url').where('user_id', '=', userId).executeTakeFirst();
    await this.db.updateTable('profiles').set({ avatar_url: null }).where('user_id', '=', userId).execute();
    await this.removeOwned(previous?.avatar_url);
  }

  /** Delete a photo from our bucket (provider URLs aren't ours to delete). */
  private async removeOwned(url: string | null | undefined) {
    const marker = `/storage/v1/object/public/${PUBLIC}/`;
    const i = url?.indexOf(marker) ?? -1;
    if (url && i >= 0) await this.client.storage.from(PUBLIC).remove([url.slice(i + marker.length)]).catch(() => undefined);
  }
}

@Controller('users/me/avatar')
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @RateLimit(20, 3600)
  @Post('upload')
  upload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { contentType } = z.object({ contentType: z.enum(TYPES, 'Use a JPG, PNG or WebP photo.'), sizeBytes: z.number().int().positive().max(MAX_BYTES, 'Photos must be under 5 MB.') }).parse(body);
    return this.avatars.uploadSlot(user.id, contentType);
  }

  @RateLimit(6, 60)
  @Post()
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { path } = z.object({ path: z.string().max(120) }).parse(body);
    return this.avatars.publish(user.id, path);
  }

  @Post('provider')
  @HttpCode(200)
  useProvider(@CurrentUser() user: AuthUser) {
    return this.avatars.useProvider(user.id);
  }

  @Delete()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser) {
    return this.avatars.remove(user.id);
  }
}
