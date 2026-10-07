// Synced from the web app (src/lib/api/errors.ts) by scripts/sync-contract.mjs — do not edit here.
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONTACT_PASS_REQUIRED"
  | "PAYMENT_FAILED"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "CONFLICT"
  | "UNKNOWN";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(e: unknown, code?: ApiErrorCode): e is ApiError {
  return e instanceof ApiError && (!code || e.code === code);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}
