import { z } from 'zod';

// Local development reads backend/.env; hosted environments set real variables instead.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

/** Every setting the API reads, validated once at startup so a bad deploy fails fast. */
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.url(),
  SUPABASE_URL: z.url(),
  /** Server-only key: Storage signed URLs and admin calls. Never sent to a browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Local / legacy projects sign tokens with this (HS256). Cloud projects use the JWKS instead. */
  SUPABASE_JWT_SECRET: z.string().optional(),
  /** Geoapify key for address search and reverse lookup (geoapify.com). Without it, address search answers 503. */
  GEOAPIFY_API_KEY: z.string().optional(),
  /** OSRM-compatible routers, comma-separated, tried in order. Public ones stall now and then. */
  ROUTER_URLS: z
    .string()
    .default('https://routing.openstreetmap.de/routed-car,https://router.project-osrm.org')
    .transform((s) => s.split(',').map((u) => u.trim()).filter(Boolean)),
  ROUTER_TIMEOUT_MS: z.coerce.number().default(4000),
  /** Contact Pass checkout. "mock" accepts any payment (dev only); "razorpay" verifies signatures. */
  PAYMENTS_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  /** Razorpay API keys. The key id is public (Checkout needs it); the secret never leaves the server. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /**
   * The secret set on the webhook in the Razorpay dashboard (not the API key secret). Optional so local
   * dev runs without one (webhooks can't reach localhost); set it in production or the webhook answers 503.
   */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Resend (resend.com) API key for transactional email: work-email verification codes. */
  RESEND_API_KEY: z.string().optional(),
  /** Sender for those emails; the domain must be verified in Resend. */
  EMAIL_FROM: z.string().default('FindFlatmates <verify@findflatmates.in>'),
  /**
   * Shared secret the Next.js BFF sends as `x-internal-key`. With it set, the API answers nobody else
   * (404), so its address leaking doesn't expose any data. Required in production.
   */
  INTERNAL_API_KEY: z.string().min(32).optional(),
  /** The web app's public origin, for links in emails (no trailing slash). */
  WEB_URL: z.url().default('https://findflatmates.in').transform((u) => u.replace(/\/+$/, '')),
}).refine((c) => c.PAYMENTS_PROVIDER !== 'razorpay' || (c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET), {
  message: 'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENTS_PROVIDER=razorpay',
})
  // Production must be locked to the BFF and take real payments; a forgotten dev setting fails the deploy.
  .refine((c) => process.env.NODE_ENV !== 'production' || c.INTERNAL_API_KEY, { message: 'INTERNAL_API_KEY (32+ chars) is required in production' })
  .refine((c) => process.env.NODE_ENV !== 'production' || c.PAYMENTS_PROVIDER === 'razorpay', { message: 'PAYMENTS_PROVIDER=mock is not allowed in production' });

export type Config = z.infer<typeof schema>;

export const config: Config = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
})();
