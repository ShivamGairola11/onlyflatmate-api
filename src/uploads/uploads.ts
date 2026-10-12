import { randomUUID } from 'node:crypto';
import { Body, Controller, Injectable, Logger, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { PhotoUploadTicket, UploadedPhoto } from '@/lib/api/contract';
import { ApiError, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';

const BUCKET = 'listing-photos';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const MAX_BYTES = 10 * 1024 * 1024;
/** Signed upload URLs from Supabase are valid for 2 hours. */
const TICKET_TTL_MS = 2 * 60 * 60_000;

/**
 * Photos go straight from the browser to Supabase Storage on a short-lived
 * signed URL; the API only reserves the slot and confirms it landed.
 */
@Injectable()
export class UploadsService {
  private readonly log = new Logger('Uploads');
  private readonly storage = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);

  constructor(@InjectDb() private readonly db: Database) {}

  async create(userId: string, contentType: keyof typeof EXT, sizeBytes: number): Promise<PhotoUploadTicket> {
    const photoId = randomUUID();
    const path = `${userId}/${photoId}.${EXT[contentType]}`;
    const { data, error } = await this.storage.createSignedUploadUrl(path);
    if (error || !data) {
      this.log.error(`Signed upload URL failed for ${BUCKET}/${path}: ${error?.message ?? 'no data'}`);
      throw new ApiError('UNKNOWN', 'Photo uploads are unavailable right now.', 503);
    }
    await this.db
      .insertInto('photos')
      .values({ id: photoId, owner_id: userId, storage_path: path, url: this.storage.getPublicUrl(path).data.publicUrl, content_type: contentType, size_bytes: sizeBytes })
      .execute();
    return { photoId, uploadUrl: data.signedUrl, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString() };
  }

  async complete(userId: string, photoId: string): Promise<UploadedPhoto> {
    const photo = await this.db.selectFrom('photos').select(['id', 'url', 'status']).where('id', '=', photoId).where('owner_id', '=', userId).executeTakeFirst();
    if (!photo) throw notFound('Photo not found.');
    if (photo.status !== 'READY') {
      // The bucket is public-read, so a HEAD on the public URL tells us the bytes arrived.
      const head = await fetch(photo.url, { method: 'HEAD' }).catch(() => undefined);
      if (!head?.ok) throw new ApiError('VALIDATION', 'The photo hasn’t finished uploading.', 409);
      await this.db.updateTable('photos').set({ status: 'READY' }).where('id', '=', photoId).execute();
    }
    return { photoId, url: photo.url };
  }
}

const createInput = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), sizeBytes: z.number().int().positive() });

@Controller('uploads/photos')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { contentType, sizeBytes } = createInput.parse(body);
    if (sizeBytes > MAX_BYTES) throw invalid('Each photo must be under 10 MB.');
    return this.uploads.create(user.id, contentType, sizeBytes);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.uploads.complete(user.id, id);
  }
}
