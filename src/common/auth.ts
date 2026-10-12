import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { ApiError, unauthenticated } from './api-error.js';

export interface AuthUser {
  id: string;
}

type AuthedRequest = Request & { user?: AuthUser };

const IS_PUBLIC = 'isPublic';
/** Route works signed out. If a token is sent anyway it's still verified, so `@OptionalUser()` sees who's asking. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user. Only on routes that aren't `@Public()`. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<AuthedRequest>().user!);
/** The user if a valid token was sent, else undefined. For `@Public()` routes that change with who's asking. */
export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => ctx.switchToHttp().getRequest<AuthedRequest>().user);

const issuer = `${config.SUPABASE_URL}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const hsSecret = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : undefined;

/**
 * Verifies the Supabase access token the BFF forwards as `Authorization: Bearer`.
 * Cloud projects sign with asymmetric keys (checked against the JWKS); local and
 * legacy projects use the shared HS256 secret.
 */
async function verify(token: string): Promise<JWTPayload> {
  const { alg } = decodeProtectedHeader(token);
  const options = { audience: 'authenticated' };
  if (alg === 'HS256') {
    if (!hsSecret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not set');
    return (await jwtVerify(token, hsSecret, options)).payload;
  }
  return (await jwtVerify(token, jwks, { ...options, issuer })).payload;
}

/** How long a "not banned" answer is trusted, so a ban takes effect within this, not at token expiry (~1 h). */
const BAN_CHECK_TTL_MS = 30_000;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly banChecked = new Map<string, { banned: boolean; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  private async isBanned(userId: string) {
    const hit = this.banChecked.get(userId);
    if (hit && Date.now() - hit.at < BAN_CHECK_TTL_MS) return hit.banned;
    const row = await this.db.selectFrom('auth.users').select('banned_until').where('id', '=', userId).executeTakeFirst();
    // A deleted account counts as banned: its token must stop working too.
    const banned = !row || (!!row.banned_until && new Date(row.banned_until) > new Date());
    if (this.banChecked.size > 50_000) this.banChecked.clear();
    this.banChecked.set(userId, { banned, at: Date.now() });
    return banned;
  }

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        const payload = await verify(token);
        if (payload.sub) req.user = { id: payload.sub };
      } catch {
        // A bad token on a public route is treated as signed out; elsewhere it's a 401.
        if (!isPublic) throw unauthenticated();
      }
    }
    if (req.user && (await this.isBanned(req.user.id))) throw new ApiError('FORBIDDEN', 'This account has been suspended.', 403);
    if (!isPublic && !req.user) throw unauthenticated();
    return true;
  }
}
