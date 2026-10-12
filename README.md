# Basera API (NestJS)

The business-logic API. Only the Next.js BFF calls it (server to server, `src/app/api/*` in the web app),
forwarding the user's Supabase access token as `Authorization: Bearer …`.

```
Browser ──▶ Next.js BFF (/api, httpOnly session cookies) ──▶ NestJS API ──▶ Supabase Postgres + PostGIS
                         └─ Supabase Auth (OTP, Google)                  └─ Supabase Storage
```

## Run locally

Needs Docker. The web app lives in a separate repo (`../basera`).

```bash
npm install
npm run db:start      # local Supabase: Postgres + PostGIS, Auth, Storage, Studio on :54323
npm run db:reset      # apply supabase/migrations and load supabase/seed.sql
npm run start:dev     # this API on http://127.0.0.1:4000
```

`.env` holds the Supabase CLI's local defaults (copy `.env.example`). To point the web app at this
API, set `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_BASE_URL=/api` in the web app's `.env.local`
(its BFF settings are in that repo's `.env.example`).

Demo personas sign in with real OTP verification using test numbers (`supabase/config.toml`,
`[auth.sms.test_otp]`, code `123456`). Any number listed there works from the sign-in dialog too.

`supabase/seed.sql` is generated from the web app's prototype data: run `npm run seed:generate` in
the web app (it writes here), then `npm run db:reset`.

## How it fits together

- **Contract types are the web app's.** `contract/` is a copy of `src/lib/api/contract.ts` and every
  type it imports, kept by `npm run contract:sync` (reads `../basera` by default). Code here imports
  them with `import type … from '@/…'`, which tsconfig maps onto `contract/`; SWC compiles only `src`
  and drops type-only imports. Re-sync whenever the contract changes and commit the diff — a type
  error after syncing is the API telling you what to update.
- **Schema** lives in `supabase/migrations` (plain SQL). After changing it, run `npm run db:types`
  here to regenerate `src/db/schema.ts` for Kysely.
- **Access:** every table has row level security on with no policies, so Supabase's public API
  exposes nothing. This API connects with a privileged role and enforces ownership in code.
- **Auth:** `src/common/auth.ts` verifies Supabase JWTs (JWKS in the cloud, the HS256 secret
  locally). Routes are signed-in by default; `@Public()` opts out, `@OptionalUser()` still sees who
  is asking.
- **Errors** always leave as `{ code, message }` (`src/common/exception.filter.ts`), the shape the
  web app's HTTP client turns back into an `ApiError`.

## Security

Only the web app's BFF may call this API (shared `INTERNAL_API_KEY`, everything else gets a 404), every route is rate-limited, and production refuses to start without the key or with mock payments. The full audit — findings, fixes, rate limits, deployment checklist and known limits — is in the web app at `docs/SECURITY.md`. Re-run the attack suite with `scripts/security-smoke.sh` after changing auth, payments, uploads or any public endpoint.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | Watch mode |
| `npm run build` / `start:prod` | SWC build with type-check / run `dist/src/main.js` |
| `npm run test:e2e` | API tests against the local database |
| `npm run db:types` | Regenerate Kysely types from the local schema |
| `npm run lint` | oxlint |
| `npm run contract:sync` | Re-copy the API contract types from the web app |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase |
