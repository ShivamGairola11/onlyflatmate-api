import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Commute } from '@/features/commute/types';
import { notFound } from '../common/api-error.js';
import { Public } from '../common/auth.js';
import { latOf, lngOf } from '../common/geo.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { CommuteService, type Origin } from './commute.service.js';
import { RateLimit } from '../common/rate-limit.js';

const destinationId = z.string().min(1).max(200);

@Controller('commute')
export class CommuteController {
  constructor(
    private readonly commute: CommuteService,
    @InjectDb() private readonly db: Database,
  ) {}

  /** Commutes start from the listing's public (approximate) point, never the exact one. */
  private async origins(ids: string[]): Promise<Origin[]> {
    if (!ids.length) return [];
    const rows = await this.db.selectFrom('listings').select(['id', latOf('public_point').as('lat'), lngOf('public_point').as('lng')]).where('id', 'in', ids).execute();
    return rows.map((r) => ({ id: r.id, location: { latitude: r.lat, longitude: r.lng } }));
  }

  @Public()
  @RateLimit(30, 60)
  @Post('estimate')
  async estimate(@Body() body: unknown): Promise<Record<string, Commute>> {
    const input = z.object({ listingIds: z.array(z.uuid()).max(100), destinationId }).parse(body);
    const commutes = await this.commute.forOrigins(await this.origins(input.listingIds), input.destinationId);
    return Object.fromEntries(commutes);
  }

  @Public()
  @RateLimit(20, 60)
  @Get('route')
  async route(@Query() query: unknown) {
    const input = z.object({ listingId: z.uuid(), destinationId }).parse(query);
    const [origin] = await this.origins([input.listingId]);
    if (!origin) throw notFound('This listing doesn’t exist or has been removed.');
    return this.commute.route(origin, input.destinationId);
  }
}
