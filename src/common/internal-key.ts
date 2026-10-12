import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

const expected = config.INTERNAL_API_KEY ? Buffer.from(config.INTERNAL_API_KEY) : undefined;

/** Constant-time compare, so the key can't be guessed byte by byte from response timing. */
function matches(given: string | undefined) {
  if (!expected || !given) return false;
  const buf = Buffer.from(given);
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}

/**
 * Only the Next.js BFF may call this API: every request must carry the shared `x-internal-key`.
 * Anyone who finds the API's address still gets nothing — no listings, no errors that hint at routes.
 * /health stays open for the host's uptime checks. Without a key configured (local dev) everything passes.
 */
export function internalKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!expected || req.path === '/health') return next();
  if (!matches(req.header('x-internal-key'))) {
    res.status(404).end();
    return;
  }
  next();
}

/**
 * The caller's real IP. The BFF forwards it as `x-client-ip`; that header is only trusted because the
 * internal key proved the request came from the BFF (or, in local dev, there's no key and no exposure).
 */
export function clientIp(req: Request) {
  return (req.header('x-client-ip') ?? req.socket.remoteAddress ?? 'unknown').slice(0, 64);
}
