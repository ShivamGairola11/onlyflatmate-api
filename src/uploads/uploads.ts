import { randomUUID } from 'node:crypto';
import { Body, Controller, Injectable, Logger, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { z } from 'zod';
import type { PhotoUploadTicket, UploadedPhoto } from '@/lib/api/contract';
import { ApiError, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { RateLimit } from '../common/rate-limit.js';

const BUCKET = 'listing-photos';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const MAX_BYTES = 10 * 1024 * 1024;
/** Decompression-bomb guard: ~40 MP covers every phone camera. */
const MAX_PIXELS = 40_000_000;
const FORMAT_OF = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;
/** Signed upload URLs from Supabase are valid for 2 hours. */
const TICKET_TTL_MS = 2 * 60 * 60_000;

/**
 * Photos go straight from the browser to Supabase Storage on a short-lived
 * signed URL; the API reserves the slot, then checks and cleans the file before it can be used.
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
    const photo = await this.db.selectFrom('photos').select(['id', 'url', 'status', 'storage_path', 'content_type']).where('id', '=', photoId).where('owner_id', '=', userId).executeTakeFirst();
    if (!photo) throw notFound('Photo not found.');
    if (photo.status !== 'READY') {
      if (!photo.storage_path) throw new ApiError('VALIDATION', 'The photo hasn’t finished uploading.', 409);
      await this.sanitise(photo.storage_path, photo.content_type as keyof typeof EXT);
      await this.db.updateTable('photos').set({ status: 'READY' }).where('id', '=', photoId).execute();
    }
    return { photoId, url: photo.url };
  }

  /**
   * The browser re-encodes before upload, but anyone can PUT anything to their signed URL. So before a
   * photo can be used: decode it (it must really be a JPEG/PNG/WebP within the pixel limit) and re-encode it
   * in place. Re-encoding drops all metadata — above all EXIF GPS, which would reveal the exact building.
   */
  private async sanitise(path: string, declared: keyof typeof EXT) {
    const { data: blob, error } = await this.storage.download(path);
    if (error || !blob) throw new ApiError('VALIDATION', 'The photo hasn’t finished uploading.', 409);
    const input = Buffer.from(await blob.arrayBuffer());
    const reject = async () => {
      await this.storage.remove([path]);
      throw invalid('That file isn’t a photo we can use. Upload a JPG, PNG or WebP image.');
    };
    if (input.length > MAX_BYTES) return reject();
    let format: string | undefined;
    try {
      format = (await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata()).format;
    } catch {
      return reject();
    }
    // The real content must match what the ticket was issued for (that's the type the bucket serves it as).
    if (FORMAT_OF[declared] !== format) return reject();
    const clean = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate().toFormat(FORMAT_OF[declared], { quality: 85 }).toBuffer();
    const { error: upErr } = await this.storage.upload(path, clean, { contentType: declared, upsert: true });
    if (upErr) throw new ApiError('UNKNOWN', 'Couldn’t process the photo. Try again.', 502);
  }
}

const createInput = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']), sizeBytes: z.number().int().positive() });

@Controller('uploads/photos')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @RateLimit(60, 3600)
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
