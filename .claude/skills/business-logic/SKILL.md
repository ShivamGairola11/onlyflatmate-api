---
name: business-logic
description: FindFlatmates business rules — who can see what (anonymous / signed-in / pass holder / owner / admin), Contact Pass plans and paywall, locked messages, listing/flatmate/group rules and limits, freshness, privacy, moderation, payments. Load before changing any route guard, entitlement, price, limit, validation, visibility or moderation rule in basera-api OR basera. Update this file (and review.md if a decision changes) in the same change whenever a business rule changes.
---

# Business logic — FindFlatmates

**The backend (`basera-api`) is the source of truth.** The frontend (`../basera`) may mirror a rule for UX, but the API enforces it. Rules hand-copied in both repos are listed under *Duplicated rules* and must be changed in both.

Open questions and improvement feedback: [review.md](review.md). UI rules: `../basera/.claude/skills/ui-contract/SKILL.md`.

## Update protocol

When a change touches a rule below:
1. Change the API first, then the web mirror (if any).
2. Edit this file: the rule, its number and its `file:line`.
3. If it settles or reopens a question in `review.md`, update it there too.
4. Contract types changed → `npm run contract:sync` here.

## Product in one line

A map-first rental and flatmate marketplace for 8 Indian cities (delhi-ncr, mumbai, bengaluru, hyderabad, chennai, kolkata, pune, ahmedabad). Core loop: **Explore → Listing → Commute → Contact Pass → Chat.** Listing, browsing and replying are free. The only thing anyone pays for is a **Contact Pass**, which lets a seeker *start* chats.

## Who sees what

Principle (decided 2026-10-22): **gate actions, not property discovery.** Listings are public. People data needs sign-in. Contacting needs sign-in and a pass. All of it is **enforced in the API**; the UI only mirrors it.

| | Signed out | Signed in | Pass holder | Owner / member | Admin |
|---|---|---|---|---|---|
| Explore list and map, filters, commute | ✅ paging to **1000** (same as signed in) | ✅ | ✅ | | |
| Listing detail: all photos, price/deposit/charges, amenities, home and room details, availability, approximate location, map, commute | ✅ full | ✅ | ✅ + "Message" | Edit/confirm/occupied/delete | |
| Listing residents | age, gender, profession (name `""`, lifestyle `[]`, no `userId`) | full | full | | |
| Lister | first name, member since, verified badges (no age or profession) | + age, profession | | | |
| Exact address | ❌ | ❌ | ❌ | owner (`GET /listings/:id/edit`) | |
| Phone / email of others | ❌ never | ❌ | ❌ (the pass enables chat, not a number reveal) | | ✅ |
| Flatmate profile (list and detail) | name, age, gender, profession, badges, "looking for" (budget, areas, BHK, move-in). `userId`/`bio`/`workArea` are `""` and `lifestyle`/`languages` `[]`; the lifestyle filter is ignored. | full + Connect | Connect opens chat | | |
| Group (list and detail) | brief: name, BHK, areas, target budget, move-in, size. Members are anonymous seats (`name`/`profession` `""`, `budget` 0); `ownerId`/`inviteCode` `""`; no note. | members with names, professions and budgets (no ids or invite code unless a member) | — (no UI to message a group) | everything | |
| Group matches | ❌ 401 | ✅ (blocks applied) | | | |
| Save, compare, post, create/join group, report/block, contact | ❌ → sign-in dialog (resumes afterwards, see below) | ✅ | ✅ | | |
| `/saved`, `/messages`, `/my-listings`, `/profile`, `/have-a-place` | sign-in empty state | ✅ | | | |
| `/admin` | ❌ | 403 unless `profiles.is_admin` | | | ✅ |

**Where it's enforced:**
- **API guards:** signed-in by default; `@Public()` / `@OptionalUser()` opt out (`src/common/auth.ts:66-84`). Admin uses `AdminGuard` (`src/admin/admin.ts:108`).
- **Field trim:** `src/common/visibility.ts` (`publicListing`, `publicLister`, `publicFlatmate`, `publicGroup`). It's applied whenever the caller isn't signed in, in:
  - `ListingsService.hydrate` (search, detail, batch);
  - `ListingsService.get` (lister);
  - `FlatmatesService.search`/`get`;
  - `GroupsService.forViewer` (list and detail).
- **SSR / link previews:** `basera/src/server/public-data.ts` calls the API with no user, so the HTML, the dehydrated cache, OG images and meta descriptions all get the trimmed shape. The browser refetches with the session (`Prefetched` marks the data stale; sign-in invalidates all queries).
- **Blocks:** apply to `GET /listings/:id`, `GET /listings/batch`, `GET /saved/listings`, `GET /flatmates/:id`, search and group matches. A blocked target answers **404 with the same message as a missing one**, so it never says who blocked whom.
- **Abuse limits:** paging stops at 1000. Per IP or account: `GET /listings` 60/min, `GET /listings/:id` 120/min, `GET /flatmates/:id` 120/min, batch 30/min (≤ 60 ids), matches 30/min, global 300/min. No sign-in wall is used for anti-scraping.
- **Web gate primitives** (UX only):
  - `useRequireAuth(reason, action, resume?)` (`basera/src/features/auth/hooks/use-session.ts`).
  - `LockedPanel` (`sign-in-gate.tsx`).
  - Flatmate and group pages lock on `useSignedOut() || <id field empty>`, so the server-rendered HTML locks too.
  - There is no listing gate any more. There's no middleware either.
- **Sign-in methods:** Google and email/password. **Phone OTP is off** (`PHONE_SIGNIN = false`, `basera/src/features/auth/components/auth-dialog.tsx:15`).
- **Mock mode** (`NEXT_PUBLIC_API_MODE=mock`) doesn't trim fields; its people pages still lock via `useSignedOut`.

### Resume after sign-in

- **Record:** `useRequireAuth(..., resume)` stores an allowlisted record, which `basera/src/features/auth/pending-action.ts` defines and validates:
  - `save{listingId}`
  - `contact{contextType,contextId}`
  - `pass`
  - `create-group`
  - `join-group`
- **In-dialog sign-in** (email, phone) runs the in-memory callback.
- **Google:** the record goes to `sessionStorage` (`ff.pendingAction`; ids only, 15-minute TTL, same tab, same path) just before the redirect. `PendingActionReplay` (root layout) reads it once on return. It replays only when the visitor really is signed in, and drops it otherwise (cancelled or failed sign-in).
- **The API still decides every replay:**
  - save is idempotent;
  - contact is idempotent and pass-gated (no pass → the checkout opens and nothing is charged);
  - group create/join only reopen their dialog.
- **Cleared** on dialog close, on in-dialog sign-in, and on read.
- **Not resumed:** report/block (the visitor re-clicks), and email sign-up's confirmation link (it opens in a new tab).

### Analytics events

`track()` in `basera/src/lib/analytics.ts` pushes to the GTM `dataLayer` (GTM runs in production only). Properties are ids, page type, auth state, plan and amount only — never names, contact details or message text.

**First-party copy for the admin dashboard:**
- **Where events go:** in http mode, every event except `pass_purchased` is also sent to `POST /analytics/events` (`src/analytics/analytics.ts`; public, 120/min).
  - It's stored in `analytics_events` with a random browser `visitor_id` (localStorage `ff.vid`; no fingerprinting) and `user_id` when signed in.
  - Event names are allowlisted. Props are allowlisted keys with primitive values ≤ 64 chars; anything else is dropped.
- **Retention:** 180 days (pruned by the hourly cleanup job).
- **Purchases:** the funnel reads them from `payments` (distinct paying users), so they can't be faked from a browser.
- **Admin overview** (`GET /admin/overview`): `funnel` (distinct visitors per step VISITED → VIEWED → CONTACTED → PAYWALL → PURCHASED, vs the previous period), sign-in completion, signed-out view share, `topListings`, and daily visitors/views/contacts.
- Tests: `test/analytics.e2e-spec.ts`.

| Event | Fired | Props |
|---|---|---|
| `listing_view` | listing page has data and the session is known; once per listing per page load | `listing_id`, `page_type`, `signed_in` |
| `signin_prompt_shown` | sign-in dialog opens | `action` (resume kind or `none`) |
| `signin_done` | in-dialog sign-in succeeds, or a Google return with a session | `method`, `action` |
| `contact_click` | Contact / Connect pressed | `context_type`, `context_id`, `signed_in` |
| `paywall_shown` | Contact Pass checkout opens | `source` (`contact`/`direct`), `context_type` |
| `pass_purchased` | after `POST /payments/confirm` succeeds (server-verified) | `plan`, `value`, `currency` |

No A/B test is running: there's no assignment or experiment framework. See `review.md` §1.

## Contact Pass (the only revenue)

| Plan | Days | ₹ | ₹/day |
|---|---|---|---|
| MINI | 3 | 99 | 33 |
| PRO (default, "popular") | 7 | 149 | 21 |
| MAX | 30 | 999 | 33 |

- `src/payments/payments.ts:25-29` ⇄ `basera/src/lib/config/app.ts:66-72`. Pre-plan passes = 7 days (`LEGACY_DAYS`).
- **Renewal stacks:** a new pass starts at `greatest(max(expires_at), now())`. No auto-renew. Active means `expires_at > now()`.
- Reminder email 24 h before expiry (hourly job, `src/payments/pass-reminders.ts`). Phone-only accounts get no reminder.
- **Paywall:**
  - `POST /conversations` → 402 `CONTACT_PASS_REQUIRED` without a pass, for LISTING, FLATMATE and GROUP contexts.
  - Re-opening an existing thread with the same person and context is free.
  - Sending needs a pass only when your role in the thread is SEEKER (the initiator).
- **Never pays:** listers, flatmate-profile owners and group owners replying in their threads. Listing, uploading, browsing, saving and commute are free for everyone. Admins are *not* exempt.
- **Locked messages:**
  - For a seeker, messages from the other side sent after their latest pass expired come back `body:'' , locked:true` (list, thread and SSE).
  - Someone who never bought a pass sees every incoming message locked.
  - Renewing unlocks all history. A seeker's own messages are never locked.
  - The web shows a blurred bubble, "renew to read" and a renew bar instead of the composer.
- **Payment:**
  - Razorpay (UPI/card/netbanking). The server fixes the amount and verifies the HMAC signature, order and amount, captures if needed, and is idempotent.
  - Webhook `payment.captured` is the backup path.
  - `PAYMENTS_PROVIDER=mock` grants without checks. Production refuses mock **only if `NODE_ENV=production`** (`src/config.ts:57`).
- **Admin money actions:**
  - Refund (SUCCEEDED and > ₹0 only; the pass ends now).
  - Sync from Razorpay.
  - Extend or comp-grant, 1–365 days (comp = a ₹0 MOCK payment, not refundable).
  - Revoke.
- **Refund policy (legal):** only when a payment was taken without a pass, or for a duplicate charge, requested within 30 days.

## Listings

- **Types:** PRIVATE_ROOM, SHARED_ROOM, ENTIRE_FLAT, FLATMATE_VACANCY, PG. **BHK:** 1RK–4BHK_PLUS. **Building:** GATED_SOCIETY, BUILDER_FLOOR, DDA_FLAT, INDEPENDENT_HOUSE, STANDALONE_APARTMENT, OTHER (needs a description of ≥ 2 chars).
- **Limits** (`src/listings/listing-input.ts`):
  - Money: rent ₹2,000–3,00,000; deposit 0–10L; maintenance 0–50k; brokerage 0–10L.
  - Rooms and building: bedrooms and bathrooms 1–10; floor −2..100 and ≤ totalFloors (1–100); area 50–20,000 sqft.
  - Amenities ≤ 20 (free text 2–30 chars allowed).
  - Extras ≤ 10 (label 2–40, ₹1–2L, MONTHLY or ONE_TIME).
  - People: flatmates ≤ 6, ages 18–80; preference note ≤ 300.
  - Text: title ≤ 120 (auto-filled if blank); description ≤ 1000; address ≤ 140.
  - Photos ≤ 15, which must be the user's own READY uploads.
  - The pin must sit inside a served city.
- **No contact info** (phones incl. spelled-out digits, +91/0, emails incl. "(at)") in any free text: listing, profile, flatmate, group, messages. Detector `contract/lib/validation/contact-info.ts`; server `src/common/contact-info.ts`.
- **Brokerage:** a plain amount the lister charges (shown as "Brokerage ₹Xk" on cards). The platform never takes brokerage. There is no "no-broker" filter.
- **Count limits:** none, apart from 10 creates per hour. One draft per user (≤ 50 kB). Saved ≤ 200. Creating a listing switches the profile mode to OFFERING.
- **Freshness** (`src/listings/listing.mapper.ts:6-20` ⇄ `basera/src/lib/config/app.ts:84`):
  - STALE after 72 h without confirmation; EXPIRED after 14 days. Derived, never stored.
  - Search and pins show only ACTIVE listings confirmed within 14 days.
  - "Confirm still available" resets the clock and revives OCCUPIED, but not REMOVED.
- **Auto-delete:** a listing not confirmed for **30 days** (`DELETE_AFTER_DAYS`, `src/listings/listing.mapper.ts`) is hard-deleted by `ListingCleanupService` (`src/listings/listing-cleanup.ts`, hourly, batches of 500).
  - **Email first:** at 27 days the owner gets one email per confirmation cycle (`REMIND_DAYS_BEFORE = 3`). It lists all their due listings and links to My listings. The claim is stamped in `listings.delete_reminder_sent_at`; a stamp older than `last_confirmed_at` belongs to an earlier cycle, so confirming re-arms it.
  - **Never without notice:** a delete needs a reminder stamped in this cycle at least 3 days earlier. A missed run or a failed send (which releases the claim) delays the delete; it never skips the warning. Phone-only accounts get the stamp but no email; the in-app warning is their notice.
  - OCCUPIED and REMOVED listings are never auto-deleted.
  - Each listing carries `deletesAt` (last confirmation + 30 d; absent when kept), so the web shows the date without copying the rule.
  - Confirming restarts the clock.
  - `LISTING_CLEANUP=off` disables the job (local dev, so dated seed data survives).
  - **Owner nudges:** an attention dot on the avatar and an "N to confirm" badge on "My listings" in the profile menu for STALE/EXPIRED listings. "My listings" shows a banner and, per listing, "Deleted on {date} unless you confirm" (`deletesAt`, the earliest possible date), plus the email above.
- **REMOVED** = moderator takedown or ban. 404 for everyone except the owner (who sees it as EXPIRED).
- **Location privacy:** the public point is fuzzed 122–350 m with a crypto-random bearing, re-fuzzed only when the pin moves. The exact point is only in `listing_private_locations`. Commute routes start from the public point.
- **Photos:** JPEG/PNG/WebP, ≤ 10 MB, ≤ 40 MP. Re-encoded on the server (EXIF/GPS stripped).
- **Import:** the user pastes their own post text; a rule-based parser fills the draft. Published as `source=FACEBOOK_IMPORT` and badged "Imported post".
- **Delete** is a hard delete.

## Search & ranking

- Page 24 (max 60). Pins ≤ 500. Area search radius = `max(radius_km×1.8, 2.5 km)`.
- Move-in: IMMEDIATE (≤ 2 days), 15_DAYS, 30_DAYS, CUSTOM (+1 day). Gender matches ANY or the chosen gender. Amenities must all match.
- **Recommended sort** = freshness×2, +1 if confirmed within 72 h, + commute bonus `1 − min(mins,90)/90` (`src/listings/listings.service.ts:109-113`).
- **Commute model:** car = free-flow×1.6 + 4 min; bike = 0.8×car, only under 35 km; metro = max(8, 10 + 1.75·km + 7·interchanges). Labelled as an estimate.
- Blocks hide listings in both directions (signed-in only).

## Flatmates & groups

- **Flatmate profile:** bio 20–500 chars; budget ₹2k–2L (min ≤ max); areas 1–5; lookingFor 1–5; lifestyle ≤ 8; languages ≤ 8. Search ≤ 200 results; area filter = the area + 6 km.
- **Group:**
  - Name 3–60; BHK 1–5; areas 1–8; total budget ₹5k–5L; 2–6 people; member budget ₹1k–2L.
  - Invite code is 6 characters (no 0/O/1/I). Any member can add people by name.
  - The owner can't leave (delete instead) and can't be removed.
- **Group matches:** a flat needs BHK in the group's list plus ≥ 3 of these 4: budget ≤ 103%, nearest area ≤ 3.5 km, BHK, available within 20 days of move-in. Top 12. ⚠ Candidate pool = first 60 ENTIRE_FLATs **nationwide** (`src/groups/groups.ts:196`).

## Safety, verification, moderation, support

- **Report:** LISTING/USER/GROUP; reasons SCAM, WRONG_INFO, ALREADY_RENTED, INAPPROPRIATE, SUSPICIOUS, OTHER; details ≤ 1000 chars.
- **Block:** idempotent. No unblock or list-blocks route.
- **Verification:**
  - PHONE and EMAIL are set by Supabase triggers.
  - Workplace email: 6-digit code, 10 min lifetime, 5 tries, resend after 60 s, 18 free-mail domains rejected.
  - Identity document → PENDING → admin decides; the document is deleted after the decision.
  - Public badges: phone and ID (plus workplace on flatmate cards). Email is never shown.
- **Admin** = `profiles.is_admin`, checked against the DB on every request. The first admin is set in SQL.
  - Ban = 100 years, enforced within 30 s; their listings go to REMOVED.
  - ⚠ Unban returns **all** REMOVED listings to EXPIRED.
- **Support:** `POST /contact`. Topics GENERAL/PAYMENTS/LISTING/ACCOUNT/GRIEVANCE; 5 per hour; stored, then emailed to `SUPPORT_EMAIL`. ⚠ There is no admin screen to read the stored messages.
- **Legal:** users must be 18+. Grievance acknowledged in 24 h, resolved in 15 days. Data deleted within 30 days of account deletion.

## Platform guards

- Only the BFF may call the API (`x-internal-key`; otherwise 404).
- Rate limits: 300/min global per user or IP, plus per-route limits (e.g. create listing 10/h, start chat 10/min, send 30/min, contact 5/h). The limiter is in-memory, per instance.
- SSE: ≤ 5 streams per user, 60 min each.
- Body ≤ 100 kB. Errors are `{code,message}`.

## Tests

- **API unit:** `npx vitest run src/common/visibility.spec.ts` (the field policy).
- **API e2e** (local Supabase, `npm run db:start`; apply new migrations with `npx supabase migration up --local`): `npm run test:e2e`.
  - `test/access.e2e-spec.ts` creates 130 fresh listings and removes them afterwards.
  - It covers: public listing fields, the residents/lister trim, paging past 120, the batch trim, blocks both ways (404, same message), flatmate and group trims, matches 401, sign-in for save/contact, and 402 without a pass.
- **Web self-checks:** `npx tsx scripts/check-pending-action.ts`, `check-safe-return-to.ts`, `check-contact-info.ts`.

## Duplicated rules (change both)

| Rule | API | Web |
|---|---|---|
| Pass plans | `src/payments/payments.ts:25` | `src/lib/config/app.ts:66` |
| Freshness 72 h / 14 d | `src/listings/listing.mapper.ts:6` | `src/lib/config/app.ts:84`, mock `listings.ts:20,83` |
| Listing limits | `src/listings/listing-input.ts` | `src/lib/validation/listing.ts:45-103`, `listing-builder-steps.ts:19-21` |
| Flatmate / group limits | `src/flatmates/flatmates.ts:150`, `src/groups/groups.ts:225` | `src/lib/validation/listing.ts:107-145` |
| Contact form | `src/contact/contact.ts:19` | `features/legal/contact-form.tsx:24` |
| Import parser | `src/listings/listing-import.ts` | `src/lib/api/mock/listing-import.ts` (diverged) |
| Free-mail list | `src/verifications/verifications.ts:22` (18) | mock `index.ts:45` (12) |
| Signed-out field policy | `src/common/visibility.ts` | doc comments on `Flatmate`, `FlatmateProfile`, `FlatGroup`, `PublicUser` in the contract; the UI locks on the empty fields |

**Known drift (web ≠ API):**
- Bathrooms 6 vs 10.
- Group member budget min 2000 vs 1000.
- Web-only: `hasBrokerage` ≥ 1, ageMin ≤ ageMax, room bathroom/balcony required.
- API-only caps: flatmate lookingFor/languages, group areas.
