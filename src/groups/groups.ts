import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import type { FlatGroup, GroupMatch, GroupMember, MatchCriterion } from '@/features/groups/types';
import { forbidden, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser, OptionalUser, Public } from '../common/auth.js';
import { distanceKm } from '../common/geo.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { ListingsService } from '../listings/listings.service.js';
import { PlacesService } from '../places/places.service.js';

const DAY_MS = 86_400_000;
const dateIso = (d: unknown) => (typeof d === 'string' ? `${d}T00:00:00.000Z` : new Date(d as Date).toISOString());
const rupeesShort = (n: number) => `₹${n >= 1000 ? `${Math.round(n / 100) / 10}k` : n}`;
/** Unambiguous characters only (no 0/O, 1/I). */
const inviteCode = () => Array.from(randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

@Injectable()
export class GroupsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
    private readonly places: PlacesService,
  ) {}

  private async load(ids?: string[]): Promise<FlatGroup[]> {
    let q = this.db.selectFrom('groups').selectAll();
    if (ids) q = q.where('id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const groups = await q.orderBy('created_at', 'desc').execute();
    if (!groups.length) return [];
    const members = await this.db.selectFrom('group_members').selectAll().where('group_id', 'in', groups.map((g) => g.id)).orderBy('joined_at').execute();
    return groups.map((g) => ({
      id: g.id,
      ownerId: g.owner_id,
      name: g.name,
      bhk: g.bhk as FlatGroup['bhk'],
      areas: g.areas,
      totalBudget: g.total_budget,
      moveIn: dateIso(g.move_in),
      peopleNeeded: g.people_needed,
      lifestyle: g.lifestyle as FlatGroup['lifestyle'],
      note: g.note ?? undefined,
      inviteCode: g.invite_code,
      createdAt: new Date(g.created_at).toISOString(),
      members: members
        .filter((m) => m.group_id === g.id)
        .map(
          (m): GroupMember => ({
            id: m.id,
            groupId: m.group_id,
            userId: m.user_id ?? undefined,
            name: m.name,
            profession: m.profession,
            budget: m.budget,
            role: m.role as GroupMember['role'],
            status: m.status as GroupMember['status'],
            joinedAt: new Date(m.joined_at).toISOString(),
          }),
        ),
    }));
  }

  async get(id: string) {
    const [g] = await this.load([id]);
    if (!g) throw notFound('This group doesn’t exist.');
    return g;
  }

  /** The viewer's own groups first, then newest. */
  async list(viewerId?: string) {
    const groups = await this.load();
    const mine = (g: FlatGroup) => (g.members.some((m) => m.userId === viewerId) ? 1 : 0);
    return groups.sort((a, b) => mine(b) - mine(a) || +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  private async owned(id: string, userId: string) {
    const g = await this.get(id);
    if (g.ownerId !== userId) throw forbidden('Only the organiser can do that.');
    return g;
  }

  private async me(userId: string) {
    const p = await this.db.selectFrom('profiles').select(['display_name', 'profession']).where('user_id', '=', userId).executeTakeFirstOrThrow();
    return { name: p.display_name.split(' ')[0] || 'Member', profession: p.profession };
  }

  async create(userId: string, input: z.infer<typeof createInput>) {
    const me = await this.me(userId);
    const id = await this.db.transaction().execute(async (trx) => {
      const g = await trx
        .insertInto('groups')
        .values({ owner_id: userId, name: input.name, bhk: input.bhk, areas: input.areas, total_budget: input.totalBudget, move_in: input.moveIn.slice(0, 10), people_needed: input.peopleNeeded, lifestyle: input.lifestyle, note: input.note, invite_code: inviteCode() })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('group_members').values({ group_id: g.id, user_id: userId, name: me.name, profession: me.profession, budget: input.ownerBudget, role: 'OWNER', status: 'JOINED' }).execute();
      return g.id;
    });
    return this.get(id);
  }

  async update(id: string, userId: string, input: z.infer<typeof updateInput>) {
    const g = await this.owned(id, userId);
    if (input.peopleNeeded < g.members.length) throw invalid(`The group already has ${g.members.length} people.`);
    await this.db
      .updateTable('groups')
      .set({ name: input.name, bhk: input.bhk, areas: input.areas, total_budget: input.totalBudget, move_in: input.moveIn.slice(0, 10), people_needed: input.peopleNeeded, lifestyle: input.lifestyle, note: input.note ?? null })
      .where('id', '=', id)
      .execute();
    return this.get(id);
  }

  async remove(id: string, userId: string) {
    await this.owned(id, userId);
    await this.db.deleteFrom('groups').where('id', '=', id).execute();
  }

  /** Members add people who've already agreed (they appear as INVITED until they join). */
  async addMember(id: string, userId: string, input: z.infer<typeof memberInput>) {
    const g = await this.get(id);
    if (!g.members.some((m) => m.userId === userId)) throw forbidden('Only members can invite people.');
    if (g.members.length >= g.peopleNeeded) throw invalid('This group is already full.');
    await this.db.insertInto('group_members').values({ group_id: id, name: input.name, profession: input.profession, budget: input.budget, role: 'MEMBER', status: 'INVITED' }).execute();
    return this.get(id);
  }

  async removeMember(id: string, userId: string, memberId: string) {
    const g = await this.owned(id, userId);
    const m = g.members.find((x) => x.id === memberId);
    if (!m) throw notFound('Member not found');
    if (m.role === 'OWNER') throw invalid('The organiser can’t be removed.');
    await this.db.deleteFrom('group_members').where('id', '=', memberId).execute();
    return this.get(id);
  }

  async setMyBudget(id: string, userId: string, budget: number) {
    const res = await this.db.updateTable('group_members').set({ budget }).where('group_id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (!res.numUpdatedRows) throw forbidden('You’re not in this group.');
    return this.get(id);
  }

  async leave(id: string, userId: string) {
    const g = await this.get(id);
    const me = g.members.find((m) => m.userId === userId);
    if (!me) throw forbidden('You’re not in this group.');
    if (me.role === 'OWNER') throw invalid('Organisers delete the group instead of leaving it.');
    await this.db.deleteFrom('group_members').where('id', '=', me.id).execute();
  }

  async join(userId: string, code: string, budget: number) {
    const row = await this.db.selectFrom('groups').select('id').where('invite_code', '=', code.trim().toUpperCase()).executeTakeFirst();
    if (!row) throw notFound('That invite code doesn’t match any group.');
    const g = await this.get(row.id);
    if (g.members.some((m) => m.userId === userId)) return g;
    if (g.members.length >= g.peopleNeeded) throw invalid('This group is already full.');
    const me = await this.me(userId);
    await this.db.insertInto('group_members').values({ group_id: g.id, user_id: userId, name: me.name, profession: me.profession, budget, role: 'MEMBER', status: 'JOINED' }).execute();
    return this.get(g.id);
  }

  /** Whole flats scored on budget, location, BHK and move-in (same rules as the web prototype). */
  async matches(id: string): Promise<GroupMatch[]> {
    const g = await this.get(id);
    const localities = await this.places.localities();
    const areas = g.areas.map((a) => localities.find((l) => l.slug === a)).filter((a) => !!a);
    const moveIn = new Date(g.moveIn).getTime();
    const candidates = await this.listings.search({ types: ['ENTIRE_FLAT'], limit: 60 });
    return candidates.items
      .map((listing): GroupMatch => {
        const monthly = listing.pricing.rent + listing.pricing.maintenance;
        const nearest = areas.length ? Math.min(...areas.map((a) => distanceKm(listing.location, a))) : Infinity;
        const criteria: MatchCriterion[] = [
          { key: 'BUDGET', label: monthly <= g.totalBudget ? 'Budget' : `Over budget by ${rupeesShort(monthly - g.totalBudget)}`, matched: monthly <= g.totalBudget * 1.03 },
          { key: 'LOCATION', label: 'Location', matched: nearest <= 3.5 },
          { key: 'BHK', label: 'BHK', matched: g.bhk.includes(listing.property.bhk) },
          { key: 'MOVE_IN', label: 'Move-in', matched: new Date(listing.availableFrom).getTime() <= moveIn + 20 * DAY_MS },
        ];
        const score = criteria.reduce((s, c) => s + (c.matched ? (c.key === 'LOCATION' || c.key === 'BUDGET' ? 30 : 20) : 0), 0) - Math.min(nearest, 30);
        return { listing, criteria, score };
      })
      .filter((m) => m.criteria.filter((c) => c.matched).length >= 3 && m.criteria.find((c) => c.key === 'BHK')?.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }
}

const bhk = z.array(z.enum(['1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS'])).min(1);
const budget = z.number().int().min(1000).max(200000);
const updateInput = z.object({
  name: z.string().trim().min(3).max(60),
  bhk,
  areas: z.array(z.string().max(80)).min(1).max(8),
  totalBudget: z.number().int().min(5000).max(500000),
  moveIn: z.string().min(10),
  peopleNeeded: z.number().int().min(2).max(6),
  lifestyle: z.array(z.string().max(30)).max(14),
  note: z.string().trim().max(280).optional(),
});
const createInput = updateInput.extend({ ownerBudget: budget });
const memberInput = z.object({ name: z.string().trim().min(1).max(40), profession: z.string().trim().min(2).max(60), budget });

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Public()
  @Get()
  list(@OptionalUser() user?: AuthUser) {
    return this.groups.list(user?.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.groups.create(user.id, createInput.parse(body));
  }

  @Post('join')
  join(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { inviteCode: code, budget: share } = z.object({ inviteCode: z.string().trim().min(4).max(12), budget }).parse(body);
    return this.groups.join(user.id, code, share);
  }

  @Public()
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.groups.get(id);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.groups.update(id, user.id, updateInput.parse(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.groups.remove(id, user.id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.groups.addMember(id, user.id, memberInput.parse(body));
  }

  @Patch(':id/members/me')
  setMyBudget(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.groups.setMyBudget(id, user.id, z.object({ budget }).parse(body).budget);
  }

  @Delete(':id/members/:memberId')
  removeMember(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Param('memberId', new ParseUUIDPipe()) memberId: string) {
    return this.groups.removeMember(id, user.id, memberId);
  }

  @Post(':id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.groups.leave(id, user.id);
  }

  @Public()
  @Get(':id/matches')
  matches(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.groups.matches(id);
  }
}
