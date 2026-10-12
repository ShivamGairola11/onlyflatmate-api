import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiError } from './api-error.js';
import { clientIp } from './internal-key.js';

interface Policy {
  limit: number;
  windowSec: number;
}

const RATE_LIMIT = 'rateLimit';
/** Per-route limit on top of the global one: `limit` requests per `windowSec`, per signed-in user (or IP when signed out). */
export const RateLimit = (limit: number, windowSec: number) => SetMetadata(RATE_LIMIT, { limit, windowSec } satisfies Policy);

/** Every caller, every route: generous for people, tight for scripts. */
const GLOBAL: Policy = { limit: 300, windowSec: 60 };
/** Bound the table so a flood of distinct IPs can't grow memory without limit. */
const MAX_KEYS = 100_000;

/**
 * Fixed-window counters, after AuthGuard so a signed-in caller is limited as themselves.
 * ponytail: in-process — each API instance counts separately, so N instances allow N× the limit.
 * Move the counters to Redis (or Postgres) when running more than one instance.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly reflector: Reflector) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  /** Counts one hit; returns seconds until the window resets if this one is over the limit. */
  private hit(key: string, p: Policy): number | undefined {
    const now = Date.now();
    let w = this.hits.get(key);
    if (!w || w.resetAt <= now) {
      if (this.hits.size >= MAX_KEYS) this.sweep();
      if (this.hits.size >= MAX_KEYS) this.hits.clear(); // Under a flood, forgetting beats running out of memory.
      w = { count: 0, resetAt: now + p.windowSec * 1000 };
      this.hits.set(key, w);
    }
    w.count++;
    return w.count > p.limit ? Math.ceil((w.resetAt - now) / 1000) : undefined;
  }

  canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    // No visitor IP and no user: the BFF's own server-side read (cached page data, webhooks), not a person.
    // Only the BFF can reach the API (internal key), so this can't be used to dodge the limits.
    if (!req.user && !req.header('x-client-ip')) return true;
    const who = req.user ? `u:${req.user.id}` : `ip:${clientIp(req)}`;
    const route = this.reflector.getAllAndOverride<Policy>(RATE_LIMIT, [ctx.getHandler(), ctx.getClass()]);
    const wait = this.hit(`*:${who}`, GLOBAL) ?? (route ? this.hit(`${ctx.getClass().name}.${ctx.getHandler().name}:${who}`, route) : undefined);
    if (wait !== undefined) {
      ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(wait));
      throw new ApiError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', 429);
    }
    return true;
  }
}
