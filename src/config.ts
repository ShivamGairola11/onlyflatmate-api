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
  /** Photon-compatible geocoder (address search, reverse lookup). */
  GEOCODER_URL: z.url().default('https://photon.komoot.io'),
  /** OSRM-compatible routers, comma-separated, tried in order. Public ones stall now and then. */
  ROUTER_URLS: z
    .string()
    .default('https://routing.openstreetmap.de/routed-car,https://router.project-osrm.org')
    .transform((s) => s.split(',').map((u) => u.trim()).filter(Boolean)),
  ROUTER_TIMEOUT_MS: z.coerce.number().default(4000),
  /** Contact Pass checkout. "mock" accepts any payment (dev only); "razorpay" verifies signatures. */
  PAYMENTS_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
});

export type Config = z.infer<typeof schema>;

export const config: Config = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
})();
