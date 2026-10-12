import { Controller, Injectable, type MessageEvent, Sse } from '@nestjs/common';
import { defer, filter, finalize, interval, map, merge, Observable, Subject, takeUntil, timer } from 'rxjs';
import { ApiError } from '../common/api-error.js';
import type { MessagingEvent } from '@/features/messaging/types';
import { type AuthUser, CurrentUser } from '../common/auth.js';

/** Proxies drop idle connections; a comment-only ping every 25 s keeps the stream open. */
const HEARTBEAT_MS = 25_000;
/** Tabs per user; more is a script, not a person. */
const MAX_STREAMS_PER_USER = 5;
/**
 * Streams end after this and the browser reconnects (EventSource does it on its own), which re-runs the
 * auth check — so a banned or signed-out user's stream doesn't live on.
 */
const MAX_STREAM_MS = 60 * 60_000;

/**
 * Fan-out of live events to signed-in users.
 * ponytail: in-process, so it only reaches users connected to this API instance.
 * With more than one instance, publish through Postgres LISTEN/NOTIFY or Supabase Realtime instead.
 */
@Injectable()
export class EventsService {
  private readonly bus = new Subject<{ to: string[]; event: MessagingEvent }>();
  private readonly open = new Map<string, number>();

  publish(to: string[], event: MessagingEvent) {
    this.bus.next({ to, event });
  }

  streamFor(userId: string): Observable<MessageEvent> {
    if ((this.open.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) throw new ApiError('RATE_LIMITED', 'Too many open connections. Close a few tabs and try again.', 429);
    return defer(() => {
      this.open.set(userId, (this.open.get(userId) ?? 0) + 1);
      return this.live(userId);
    }).pipe(
      takeUntil(timer(MAX_STREAM_MS)),
      finalize(() => {
        const n = (this.open.get(userId) ?? 1) - 1;
        if (n > 0) this.open.set(userId, n);
        else this.open.delete(userId);
      }),
    );
  }

  private live(userId: string): Observable<MessageEvent> {
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
