import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@/lib/api/errors';

/**
 * The one error type handlers throw. The body is `{ code, message }` — the
 * shape the frontend's http client turns back into an `ApiError`.
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: number,
  ) {
    super({ code, message }, status);
  }
}

export const notFound = (message: string) => new ApiError('NOT_FOUND', message, 404);
export const forbidden = (message: string) => new ApiError('FORBIDDEN', message, 403);
export const invalid = (message: string) => new ApiError('VALIDATION', message, 422);
export const unauthenticated = () => new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
