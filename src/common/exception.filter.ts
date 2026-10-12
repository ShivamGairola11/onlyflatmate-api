import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Every error leaves the API as `{ code, message }`. Unknown errors never leak details. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (error instanceof ZodError) {
      const first = error.issues[0];
      // One readable message; the full issue tree would hand callers a map of our schema.
      res.status(422).json({ code: 'VALIDATION', message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input' });
      return;
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const status = error.getStatus();
      if (typeof body === 'object' && body && 'code' in body) {
        res.status(status).json(body);
        return;
      }
      // Nest's own errors (404 route, 400 bad JSON …) mapped onto our codes.
      const code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : status < 500 ? 'VALIDATION' : 'UNKNOWN';
      res.status(status).json({ code, message: error.message });
      return;
    }
    // Body-parser errors (too large, malformed JSON) are the client's, not ours: answer 4xx, don't log a stack.
    const parserStatus = (error as { status?: unknown; type?: unknown }).status;
    if (typeof (error as { type?: unknown }).type === 'string' && typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500) {
      res.status(parserStatus).json({ code: 'VALIDATION', message: parserStatus === 413 ? 'That request is too large.' : 'The request body couldn’t be read.' });
      return;
    }
    this.log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ code: 'UNKNOWN', message: 'Something went wrong. Please try again.' });
  }
}
