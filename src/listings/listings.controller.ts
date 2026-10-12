import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { ListingSearchParams } from '@/features/listings/types';
import { type AuthUser, CurrentUser, OptionalUser, Public } from '../common/auth.js';
import { ApiError } from '../common/api-error.js';
import { assertNoContactInfo } from '../common/contact-info.js';
import { queryList, queryNumber } from '../common/zod.js';
import { ListingEditorService } from './listing-editor.service.js';
import { listingInput, listingTexts } from './listing-input.js';
import { ListingsService } from './listings.service.js';
import { RateLimit } from '../common/rate-limit.js';

/** Parse a listing body and refuse contact details in any of its text. */
const checkedListing = (body: unknown) => {
  const input = listingInput.parse(body);
  assertNoContactInfo(...listingTexts(input));
  return input;
};

const searchQuery = z
  .object({
    area: z.string().max(80).optional(),
    north: queryNumber(),
    south: queryNumber(),
    east: queryNumber(),
    west: queryNumber(),
    minRent: queryNumber(),
    maxRent: queryNumber(),
    types: queryList(z.enum(['PRIVATE_ROOM', 'SHARED_ROOM', 'ENTIRE_FLAT', 'FLATMATE_VACANCY', 'PG'])),
    bhk: queryList(z.enum(['1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS'])),
    furnishing: queryList(z.enum(['FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED'])),
    buildingTypes: queryList(z.enum(['GATED_SOCIETY', 'BUILDER_FLOOR', 'DDA_FLAT', 'INDEPENDENT_HOUSE', 'STANDALONE_APARTMENT', 'OTHER'])),
    amenities: queryList(z.string().regex(/^[A-Z_]{2,30}$/)),
    gender: z.enum(['MALE', 'FEMALE', 'ANY']).optional(),
    moveIn: z.enum(['IMMEDIATE', '15_DAYS', '30_DAYS', 'CUSTOM']).optional(),
    moveInDate: z.iso.date().optional(),
    workplaceId: z.string().max(200).optional(),
    maxCommuteMinutes: queryNumber(),
    sort: z.enum(['RECOMMENDED', 'PRICE_ASC', 'PRICE_DESC', 'NEWEST', 'COMMUTE']).optional(),
    cursor: z.string().max(40).optional(),
    limit: queryNumber(),
  })
  .transform(({ north, south, east, west, ...rest }) => ({
    ...rest,
    bounds: north !== undefined && south !== undefined && east !== undefined && west !== undefined ? { north, south, east, west } : undefined,
  }));

const idList = z.preprocess((v) => String(v ?? '').split(',').filter(Boolean), z.array(z.uuid()).max(60));

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly editor: ListingEditorService,
  ) {}

  @Public()
  @RateLimit(60, 60)
  @Get()
  search(@Query() query: unknown, @OptionalUser() user?: AuthUser) {
    return this.listings.search(searchQuery.parse(query) as ListingSearchParams & { cursor?: string; limit?: number }, user?.id);
  }

  @Public()
  @RateLimit(60, 60)
  @Get('pins')
  pins(@Query() query: unknown, @OptionalUser() user?: AuthUser) {
    return this.listings.pins(searchQuery.parse(query) as ListingSearchParams, user?.id);
  }

  @Public()
  @RateLimit(30, 60)
  @Get('batch')
  batch(@Query('ids') ids: unknown) {
    return this.listings.getMany(idList.parse(ids));
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.mine(user.id);
  }

  @Public()
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @OptionalUser() user?: AuthUser) {
    return this.listings.get(id, user?.id);
  }

  @RateLimit(10, 3600)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.editor.create(user.id, checkedListing(body));
  }

  /** Paste a social-media post; get a draft back. Signed in, to keep scrapers off it. */
  @RateLimit(20, 3600)
  @Post('import')
  import(@Body() body: unknown) {
    return this.editor.importFromText(z.object({ text: z.string().trim().min(20, 'Paste the whole post').max(5000) }).parse(body).text);
  }

  @Get(':id/edit')
  editable(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.editor.editable(id, user.id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.editor.update(id, user.id, checkedListing(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.editor.remove(id, user.id);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.editor.confirmAvailability(id, user.id);
  }

  @Post(':id/occupied')
  occupied(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.editor.markOccupied(id, user.id);
  }
}

@Controller('listing-draft')
export class ListingDraftController {
  constructor(private readonly editor: ListingEditorService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.editor.draft(user.id);
  }

  @Put()
  save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    // A draft is half-finished by definition: only its size is checked here; publishing validates it fully.
    const { values } = z.object({ values: z.record(z.string(), z.unknown()) }).parse(body);
    if (JSON.stringify(values).length > 50_000) throw new ApiError('VALIDATION', 'Draft is too large.', 413);
    return this.editor.saveDraft(user.id, values);
  }

  @Delete()
  @HttpCode(204)
  discard(@CurrentUser() user: AuthUser) {
    return this.editor.discardDraft(user.id);
  }
}
