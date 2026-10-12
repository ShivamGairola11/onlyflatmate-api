import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { getCity, landmarksIn, localitiesIn } from '@/lib/constants/places';
import { sql } from 'kysely';
import { z } from 'zod';
import type { FlatmateProfile, FlatmateSearchParams } from '@/features/flatmates/types';
import { invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser, OptionalUser, Public } from '../common/auth.js';
import { queryBool, queryList, queryNumber } from '../common/zod.js';
import { type Database, InjectDb } from '../db/db.module.js';

/** Preferred areas within this distance of the searched area count as a match. */
const NEARBY_AREA_KM = 6;
const dateIso = (d: string | Date) => (typeof d === 'string' ? `${d}T00:00:00.000Z` : d.toISOString());

@Injectable()
export class FlatmatesService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Flatmate profiles joined with the account fields people can't edit here (name, age, verification…). */
  private base() {
    return this.db
      .selectFrom('flatmate_profiles as f')
      .innerJoin('profiles as p', 'p.user_id', 'f.user_id')
      .selectAll('f')
      .select([
        'p.display_name',
        'p.age',
        'p.gender',
        'p.profession',
        'p.last_active_at',
        sql<string[]>`coalesce((select array_agg(v.type) from verifications v where v.user_id = f.user_id and v.status = 'VERIFIED'), '{}')`.as('verified_types'),
      ]);
  }

  private toProfile(r: Awaited<ReturnType<ReturnType<FlatmatesService['base']>['execute']>>[number]): FlatmateProfile {
    return {
      id: r.id,
      userId: r.user_id,
      name: r.display_name,
      age: r.age ?? 0,
      gender: (r.gender ?? 'OTHER') as FlatmateProfile['gender'],
      profession: r.profession,
      workArea: r.work_area,
      workplaceId: r.workplace_id ?? undefined,
      bio: r.bio,
      budgetMin: r.budget_min,
      budgetMax: r.budget_max,
      preferredAreas: r.preferred_areas,
      lookingFor: r.looking_for as FlatmateProfile['lookingFor'],
      moveIn: dateIso(r.move_in as unknown as string),
      lifestyle: r.lifestyle as FlatmateProfile['lifestyle'],
      genderPreference: r.gender_preference as FlatmateProfile['genderPreference'],
      hasPlace: r.has_place,
      listingId: r.listing_id ?? undefined,
      languages: r.languages,
      verified: { phone: r.verified_types.includes('PHONE'), identity: r.verified_types.includes('IDENTITY'), workplace: r.verified_types.includes('WORKPLACE') },
      lastActiveAt: new Date(r.last_active_at).toISOString(),
    };
  }

  async search(p: FlatmateSearchParams, viewerId?: string): Promise<FlatmateProfile[]> {
    let q = this.base().orderBy('p.last_active_at', 'desc');
    if (viewerId) {
      q = q.where('f.user_id', '!=', viewerId).where('f.user_id', 'not in', this.db.selectFrom('blocks').select('blocked_user_id').where('blocker_id', '=', viewerId));
    }
    if (p.city) {
      // In the metro: a preferred area there, or a workplace there (same rule as belongsToCity).
      const areas = localitiesIn(p.city).map((l) => l.slug);
      const workplaces = landmarksIn(p.city).map((l) => l.id);
      q = q.where((eb) => eb.or([sql<boolean>`f.preferred_areas && ${sql.val(areas)}::text[]`, eb('f.workplace_id', 'in', workplaces)]));
    }
    if (p.area) {
      // The area itself plus every locality within NEARBY_AREA_KM of it.
      const nearby = sql`array(select l.slug from public.localities l join public.localities a on a.slug = ${p.area} where extensions.st_dwithin(l.point, a.point, ${NEARBY_AREA_KM * 1000}))`;
      q = q.where(sql<boolean>`f.preferred_areas && (array[${p.area}]::text[] || ${nearby})`);
    }
    if (p.budgetMax !== undefined) q = q.where('f.budget_min', '<=', p.budgetMax);
    if (p.gender && p.gender !== 'ANY') q = q.where('p.gender', '=', p.gender);
    if (p.moveInBefore) q = q.where('f.move_in', '<=', p.moveInBefore.slice(0, 10) as never);
    if (p.lifestyle?.length) q = q.where(sql<boolean>`f.lifestyle @> ${sql.val(p.lifestyle)}::text[]`);
    if (p.hasPlace !== undefined) q = q.where('f.has_place', '=', p.hasPlace);
    if (p.workplaceId) q = q.where('f.workplace_id', '=', p.workplaceId);
    return (await q.limit(200).execute()).map((r) => this.toProfile(r));
  }

  async get(id: string) {
    const r = await this.base().where('f.id', '=', id).executeTakeFirst();
    if (!r) throw notFound('This profile is no longer available.');
    return this.toProfile(r);
  }

  async mine(userId: string) {
    const r = await this.base().where('f.user_id', '=', userId).executeTakeFirst();
    return r ? this.toProfile(r) : null;
  }

  async saveMine(userId: string, input: z.infer<typeof flatmateInput>) {
    const profile = await this.db.selectFrom('profiles').select(['work_area']).where('user_id', '=', userId).executeTakeFirst();
    if (!profile) throw notFound('Complete your profile first.');
    const values = {
      bio: input.bio,
      budget_min: input.budgetMin,
      budget_max: input.budgetMax,
      preferred_areas: input.preferredAreas,
      looking_for: input.lookingFor,
      move_in: input.moveIn.slice(0, 10),
      lifestyle: input.lifestyle,
      gender_preference: input.genderPreference,
      has_place: input.hasPlace,
      languages: input.languages,
      work_area: input.workArea ?? profile.work_area ?? '',
      workplace_id: input.workplaceId ?? null,
      updated_at: new Date(),
    };
    await this.db
      .insertInto('flatmate_profiles')
      .values({ user_id: userId, ...values })
      .onConflict((oc) => oc.column('user_id').doUpdateSet(values))
      .execute();
    // Publishing counts as activity ("Active now" on the card).
    await this.db.updateTable('profiles').set({ last_active_at: new Date() }).where('user_id', '=', userId).execute();
    return (await this.mine(userId))!;
  }

  async removeMine(userId: string) {
    await this.db.deleteFrom('flatmate_profiles').where('user_id', '=', userId).execute();
  }
}

const searchQuery = z.object({
  city: z.string().max(40).optional().transform((c) => getCity(c)?.id),
  area: z.string().max(80).optional(),
  budgetMax: queryNumber(),
  moveInBefore: z.string().max(40).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'ANY']).optional(),
  lifestyle: queryList(z.string().max(30)),
  workplaceId: z.string().max(200).optional(),
  hasPlace: queryBool(),
});

const flatmateInput = z
  .object({
    bio: z.string().trim().min(20).max(500),
    budgetMin: z.number().int().min(2000).max(200000),
    budgetMax: z.number().int().min(2000).max(200000),
    preferredAreas: z.array(z.string().max(80)).min(1).max(5),
    lookingFor: z.array(z.enum(['1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS'])).min(1),
    moveIn: z.string().min(10),
    lifestyle: z.array(z.string().max(30)).max(8),
    genderPreference: z.enum(['MALE', 'FEMALE', 'ANY']),
    hasPlace: z.boolean(),
    languages: z.array(z.string().max(30)).max(8),
    workArea: z.string().trim().max(80).optional(),
    workplaceId: z.string().max(200).optional(),
  })
  .refine((d) => d.budgetMin <= d.budgetMax, { path: ['budgetMax'], message: 'Max must be above min' });

@Controller('flatmates')
export class FlatmatesController {
  constructor(private readonly flatmates: FlatmatesService) {}

  @Public()
  @Get()
  search(@Query() query: unknown, @OptionalUser() user?: AuthUser) {
    return this.flatmates.search(searchQuery.parse(query) as FlatmateSearchParams, user?.id);
  }

  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.flatmates.mine(user.id);
  }

  @Put('me')
  save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = flatmateInput.safeParse(body);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Check your flatmate profile.');
    return this.flatmates.saveMine(user.id, parsed.data);
  }

  @Delete('me')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser) {
    return this.flatmates.removeMine(user.id);
  }

  @Public()
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.flatmates.get(id);
  }
}
