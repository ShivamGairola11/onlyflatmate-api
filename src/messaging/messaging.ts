import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Conversation, ConversationContext, ConversationParticipant, Message } from '@/features/messaging/types';
import { ApiError, forbidden, invalid, notFound } from '../common/api-error.js';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { assertNoContactInfo } from '../common/contact-info.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { ListingsService } from '../listings/listings.service.js';
import { EventsService } from './events.js';
import { RateLimit } from '../common/rate-limit.js';

const BHK_TEXT: Record<string, string> = { '1RK': '1 RK', '1BHK': '1 BHK', '2BHK': '2 BHK', '3BHK': '3 BHK', '4BHK_PLUS': '4+ BHK' };
const TYPE_TEXT: Record<string, string> = { PRIVATE_ROOM: 'Private room', SHARED_ROOM: 'Shared room', ENTIRE_FLAT: 'Entire flat', FLATMATE_VACANCY: 'Flatmate vacancy', PG: 'PG' };
/** Per request: the newest conversations in the inbox, and the newest messages in a thread. */
const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 500;
const short = (n: number) => `₹${Math.round(n / 100) / 10}k`;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

type MessageRow = { id: string; conversation_id: string; sender_id: string; body: string; sent_at: Date; read_at: Date | null };
const toMessage = (m: MessageRow): Message => ({ id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.body, sentAt: iso(m.sent_at)!, readAt: iso(m.read_at) });

/**
 * A lapsed seeker doesn't receive what others sent after their pass ended: the body never leaves
 * the server (so it can't be read from the page), only the fact that a message arrived.
 */
const lockFor = (viewerId: string, lapsedAt: Date | null) => (m: Message): Message =>
  lapsedAt && m.senderId !== viewerId && new Date(m.sentAt) > lapsedAt ? { ...m, body: '', locked: true } : m;

@Injectable()
export class MessagingService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly listings: ListingsService,
    private readonly events: EventsService,
  ) {}

  /** Contact Pass entitlement — checked here, never trusted from the client. */
  private async hasActivePass(userId: string) {
    return !!(await this.db.selectFrom('contact_passes').select('id').where('user_id', '=', userId).where('expires_at', '>', new Date()).executeTakeFirst());
  }

  /** When the user's last pass ended, or null while one is active (nothing locked). Never had one: everything from others is locked. */
  private async lapsedAt(userId: string): Promise<Date | null> {
    const row = await this.db.selectFrom('contact_passes').select(sql<Date | null>`max(expires_at)`.as('last')).where('user_id', '=', userId).executeTakeFirst();
    const last = row?.last ? new Date(row.last) : null;
    return last && last > new Date() ? null : (last ?? new Date(0));
  }

  private async blockedBetween(a: string, b: string) {
    return !!(await this.db
      .selectFrom('blocks')
      .select('id')
      .where((eb) => eb.or([eb.and([eb('blocker_id', '=', a), eb('blocked_user_id', '=', b)]), eb.and([eb('blocker_id', '=', b), eb('blocked_user_id', '=', a)])]))
      .executeTakeFirst());
  }

  private async participantIds(conversationId: string) {
    return (await this.db.selectFrom('conversation_participants').select('user_id').where('conversation_id', '=', conversationId).execute()).map((p) => p.user_id);
  }

  private async assertParticipant(conversationId: string, userId: string) {
    const ids = await this.participantIds(conversationId);
    if (!ids.length) throw notFound('Conversation not found');
    if (!ids.includes(userId)) throw forbidden('You’re not part of this conversation.');
    return ids;
  }

  /** Conversations with participants' first names, last message and the viewer's unread count. */
  private async load(viewerId: string, ids: string[]): Promise<Conversation[]> {
    if (!ids.length) return [];
    const [convs, parts, last, unread] = await Promise.all([
      this.db.selectFrom('conversations').selectAll().where('id', 'in', ids).execute(),
      this.db.selectFrom('conversation_participants as cp').innerJoin('profiles as p', 'p.user_id', 'cp.user_id').select(['cp.conversation_id', 'cp.user_id', 'cp.role', 'p.display_name', 'p.avatar_url']).where('cp.conversation_id', 'in', ids).execute(),
      this.db.selectFrom('messages').selectAll().distinctOn('conversation_id').where('conversation_id', 'in', ids).orderBy('conversation_id').orderBy('sent_at', 'desc').execute(),
      this.db
        .selectFrom('messages')
        .select(['conversation_id', sql<string>`count(*)`.as('n')])
        .where('conversation_id', 'in', ids)
        .where('sender_id', '!=', viewerId)
        .where('read_at', 'is', null)
        .groupBy('conversation_id')
        .execute(),
    ]);
    const seekerIn = new Set(parts.filter((p) => p.user_id === viewerId && p.role === 'SEEKER').map((p) => p.conversation_id));
    const lock = lockFor(viewerId, seekerIn.size ? await this.lapsedAt(viewerId) : null);
    return convs
      .map((c) => ({
        id: c.id,
        context: c.context as unknown as ConversationContext,
        participants: parts
          .filter((p) => p.conversation_id === c.id)
          .map((p): ConversationParticipant => ({ userId: p.user_id, name: p.display_name.split(' ')[0] || 'Member', avatarUrl: p.avatar_url ?? undefined, role: p.role as ConversationParticipant['role'] })),
        initiatorId: c.initiator_id,
        lastMessage: ((m) => (m ? (seekerIn.has(c.id) ? lock(toMessage(m)) : toMessage(m)) : undefined))(last.find((m) => m.conversation_id === c.id)),
        unreadCount: Number(unread.find((u) => u.conversation_id === c.id)?.n ?? 0),
        createdAt: iso(c.created_at)!,
        updatedAt: iso(c.updated_at)!,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async list(userId: string) {
    const ids = await this.db
      .selectFrom('conversation_participants as cp')
      .innerJoin('conversations as c', 'c.id', 'cp.conversation_id')
      .select('cp.conversation_id')
      .where('cp.user_id', '=', userId)
      .orderBy('c.updated_at', 'desc')
      .limit(MAX_CONVERSATIONS)
      .execute();
    return this.load(userId, ids.map((r) => r.conversation_id));
  }

  async get(id: string, userId: string) {
    await this.assertParticipant(id, userId);
    return (await this.load(userId, [id]))[0];
  }

  private async roleIn(conversationId: string, userId: string) {
    return (await this.db.selectFrom('conversation_participants').select('role').where('conversation_id', '=', conversationId).where('user_id', '=', userId).executeTakeFirst())?.role;
  }

  async messages(id: string, userId: string) {
    await this.assertParticipant(id, userId);
    // The latest MAX_MESSAGES, oldest first: a thread can't make one request return unbounded rows.
    const rows = (await this.db.selectFrom('messages').selectAll().where('conversation_id', '=', id).orderBy('sent_at', 'desc').limit(MAX_MESSAGES).execute())
      .reverse()
      .map(toMessage);
    if ((await this.roleIn(id, userId)) !== 'SEEKER') return rows;
    return rows.map(lockFor(userId, await this.lapsedAt(userId)));
  }

  /** What the conversation is about, and who's on the other side. */
  private async context(type: 'LISTING' | 'FLATMATE' | 'GROUP', id: string): Promise<{ context: ConversationContext; counterpartId: string }> {
    if (type === 'LISTING') {
      const [l] = await this.listings.getMany([id]);
      if (!l) throw notFound('Listing not found');
      return {
        counterpartId: l.listerId,
        context: { type, id, title: [l.location.locality, l.location.city].filter(Boolean).join(', '), subtitle: `${TYPE_TEXT[l.type]} · ${BHK_TEXT[l.property.bhk]}`, rent: l.pricing.rent, photoUrl: l.photos[0]?.url },
      };
    }
    if (type === 'FLATMATE') {
      const f = await this.db.selectFrom('flatmate_profiles as f').innerJoin('profiles as p', 'p.user_id', 'f.user_id').select(['f.user_id', 'f.budget_min', 'f.budget_max', 'p.display_name', 'p.age', 'p.profession']).where('f.id', '=', id).executeTakeFirst();
      if (!f) throw notFound('Profile not found');
      return { counterpartId: f.user_id, context: { type, id, title: f.display_name.split(' ')[0] || 'Member', subtitle: `${f.age ?? ''} · ${f.profession} · ${short(f.budget_min)}–${short(f.budget_max).slice(1)}` } };
    }
    const g = await this.db.selectFrom('groups').select(['owner_id', 'name', 'people_needed', sql<string>`(select count(*) from group_members m where m.group_id = groups.id)`.as('members')]).where('id', '=', id).executeTakeFirst();
    if (!g) throw notFound('Group not found');
    return { counterpartId: g.owner_id, context: { type, id, title: g.name, subtitle: `${g.members}/${g.people_needed} members` } };
  }

  async create(userId: string, input: z.infer<typeof createInput>) {
    // Before the conversation exists, so a refused first message doesn't leave an empty thread.
    assertNoContactInfo(input.initialMessage);
    const { context, counterpartId } = await this.context(input.contextType, input.contextId);
    if (counterpartId === userId) throw invalid('You can’t message yourself.');
    if (await this.blockedBetween(userId, counterpartId)) throw new ApiError('BLOCKED', 'You can’t contact this person.', 403);

    const existing = await this.db
      .selectFrom('conversations as c')
      .select('c.id')
      .where('c.context_id', '=', input.contextId)
      .where((eb) => eb.exists(eb.selectFrom('conversation_participants').whereRef('conversation_id', '=', 'c.id').where('user_id', '=', userId)))
      .where((eb) => eb.exists(eb.selectFrom('conversation_participants').whereRef('conversation_id', '=', 'c.id').where('user_id', '=', counterpartId)))
      .executeTakeFirst();
    if (existing) return this.get(existing.id, userId);

    // Seekers need an active Contact Pass to START a conversation. Listers never pay to reply.
    if (!(await this.hasActivePass(userId))) throw new ApiError('CONTACT_PASS_REQUIRED', 'A Contact Pass is required to contact listers.', 402);

    const id = await this.db.transaction().execute(async (trx) => {
      const c = await trx.insertInto('conversations').values({ context_type: input.contextType, context_id: input.contextId, context: JSON.stringify(context), initiator_id: userId }).returning('id').executeTakeFirstOrThrow();
      await trx
        .insertInto('conversation_participants')
        .values([
          { conversation_id: c.id, user_id: userId, role: 'SEEKER' },
          { conversation_id: c.id, user_id: counterpartId, role: input.contextType === 'LISTING' ? 'LISTER' : 'MEMBER' },
        ])
        .execute();
      return c.id;
    });
    if (input.initialMessage?.trim()) await this.send(id, userId, input.initialMessage);
    return this.get(id, userId);
  }

  async send(id: string, userId: string, body: string) {
    const ids = await this.assertParticipant(id, userId);
    const other = ids.find((p) => p !== userId);
    if (other && (await this.blockedBetween(userId, other))) throw new ApiError('BLOCKED', 'You can’t message this person.', 403);
    const text = body.trim();
    if (!text) throw invalid('Message can’t be empty.');
    assertNoContactInfo(text);
    // The seeker's side of every thread runs on their pass; listers and owners always reply free.
    if ((await this.roleIn(id, userId)) === 'SEEKER' && !(await this.hasActivePass(userId))) {
      throw new ApiError('CONTACT_PASS_REQUIRED', 'Your Contact Pass has expired. Renew it to keep chatting — your messages are all still here.', 402);
    }
    const m = await this.db.insertInto('messages').values({ conversation_id: id, sender_id: userId, body: text }).returningAll().executeTakeFirstOrThrow();
    await this.db.updateTable('conversations').set({ updated_at: m.sent_at }).where('id', '=', id).execute();
    const message = toMessage(m);
    // The live push goes through the same lock: a lapsed seeker gets the "new message" without its text.
    const seeker = (await this.db.selectFrom('conversation_participants').select('user_id').where('conversation_id', '=', id).where('role', '=', 'SEEKER').executeTakeFirst())?.user_id;
    const lapsed = seeker && seeker !== userId ? await this.lapsedAt(seeker) : null;
    if (seeker && lapsed) {
      this.events.publish(ids.filter((p) => p !== seeker), { type: 'message', conversationId: id, message });
      this.events.publish([seeker], { type: 'message', conversationId: id, message: lockFor(seeker, lapsed)(message) });
    } else {
      this.events.publish(ids, { type: 'message', conversationId: id, message });
    }
    return message;
  }

  async markRead(id: string, userId: string) {
    const ids = await this.assertParticipant(id, userId);
    const readAt = new Date();
    await this.db.updateTable('messages').set({ read_at: readAt }).where('conversation_id', '=', id).where('sender_id', '!=', userId).where('read_at', 'is', null).execute();
    this.events.publish(ids, { type: 'read', conversationId: id, readerId: userId, readAt: readAt.toISOString() });
  }

  async unreadCount(userId: string) {
    const r = await this.db
      .selectFrom('messages as m')
      .innerJoin('conversation_participants as cp', (j) => j.onRef('cp.conversation_id', '=', 'm.conversation_id').on('cp.user_id', '=', userId))
      .select(sql<string>`count(*)`.as('n'))
      .where('m.sender_id', '!=', userId)
      .where('m.read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { count: Number(r.n) };
  }
}

const createInput = z.object({ contextType: z.enum(['LISTING', 'FLATMATE', 'GROUP']), contextId: z.uuid(), initialMessage: z.string().max(2000).optional() });

@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.messaging.list(user.id);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.messaging.unreadCount(user.id);
  }

  @RateLimit(10, 60)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.messaging.create(user.id, createInput.parse(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.messaging.get(id, user.id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.messaging.messages(id, user.id);
  }

  @RateLimit(30, 60)
  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.messaging.send(id, user.id, z.object({ body: z.string().max(2000) }).parse(body).body);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.messaging.markRead(id, user.id);
  }
}
