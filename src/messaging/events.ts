import { Controller, Injectable, type MessageEvent, Sse } from '@nestjs/common';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import type { MessagingEvent } from '@/features/messaging/types';
import { type AuthUser, CurrentUser } from '../common/auth.js';

/** Proxies drop idle connections; a comment-only ping every 25 s keeps the stream open. */
const HEARTBEAT_MS = 25_000;

/**
 * Fan-out of live events to signed-in users.
 * ponytail: in-process, so it only reaches users connected to this API instance.
 * With more than one instance, publish through Postgres LISTEN/NOTIFY or Supabase Realtime instead.
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<{ to: string[]; event: MessagingEvent }>();

  publish(to: string[], event: MessagingEvent) {
    this.bus.next({ to, event });
  }

  streamFor(userId: string): Observable<MessageEvent> {
    const events = this.bus.pipe(
      filter((e) => e.to.includes(userId)),
      map((e): MessageEvent => ({ data: e.event })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));
    return merge(events, heartbeat);
  }
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** GET /events — server-sent events for the signed-in user (the web app's `messaging.subscribe`). */
  @Sse()
  stream(@CurrentUser() user: AuthUser) {
    return this.events.streamFor(user.id);
  }
}
