# Business-logic review — open decisions & improvements

Last reviewed: 2026-10-22. When a decision is made, move it to **Decided** with the date, and update `SKILL.md`.

Legend: **P0** = fix before real traffic or money · **P1** = hurts conversion or trust · **P2** = cleanup.

---

## 1. Should viewing require login? — **Decided 2026-10-22 and implemented** (see Decided). The reasoning is kept below.

**Still open: the experiment.** The events exist, but there's no assignment. The minimal setup:
- A 50/50 split: a GTM-side cookie, or an `ff_exp` cookie set in the BFF, sent as a `variant` property on every event.
- A flag that restores the old listing `LockedPanel` for the control group.
- Comparison metric: `pass_purchased` per unique `listing_view` visitor, by variant. Supporting metrics: `contact_click`, `signin_done`, revenue per visitor.
- Don't run it until the GTM → GA4 forwarding of these events has been checked in GTM preview.

**Today:**
- Anonymous visitors see a cover photo, price and summary.
- Everything else on a listing sits behind "Sign in — it's free": the other photos, amenities, flatmates, commute and lister.
- Flatmate bios and group members are locked the same way.
- Explore paging stops at 120 for signed-out users.

**Why it should change:**
1. **The gate protects nothing.**
   - `GET /listings/:id` returns the full payload to anonymous callers, and SSR embeds it in the HTML so crawlers can index it (`basera/src/server/public-data.ts`).
   - The gate's own comment says *"preview gate, not security"*.
   - So a scraper loses nothing. Only a real person on a phone pays the friction.
2. **It hides the exact things people decide on.** Photos, flatmates and commute are why someone shortlists a flat. Hiding them before sign-in means people bounce before they're convinced.
3. **The pass is already the monetisation gate.** You earn when someone *contacts*. A sign-in wall in front of *reading* adds a second hurdle before the one that pays. Every extra step before the pass lowers pass sales.
4. **Mobile friction is worse than it looks.**
   - Sign-in is Google or email/password only (phone OTP is off).
   - A Google round-trip **drops the pending action**: the user clicks Save, signs in, comes back, and nothing is saved.
5. **SEO and sharing.** A listing shared on WhatsApp opens to a locked page. The friend who received it is your best lead, and they hit a wall.

**Proposed model:**

| Action | Needs |
|---|---|
| Browse, search, full listing detail (all photos, amenities, commute, flatmates' age/profession, lister first name) | nothing |
| Explore beyond 120 results | nothing. Keep the cap only as an anti-scrape rate limit, without a "sign in" prompt |
| Save, compare, create alerts | sign-in (it's personal data, a natural moment to ask) |
| Contact / Connect / message | sign-in **+ pass** (unchanged) |
| Post a place, create/join group, report/block | sign-in (unchanged) |
| **People data**: flatmate bio, lifestyle, languages; group members and their budgets | sign-in, **enforced in the API**, not just hidden in the UI. This is personal data about private individuals, so if it's gated, gate it for real. |

**Also:**
- ~~Persist the pending action across the OAuth redirect~~ — done 2026-10-22.
- Re-enable phone OTP, or remove the phone promises from the copy (see §3).

**Measure it** (the events were added 2026-10-22; the experiment is still open, see above): Push to `dataLayer` for `listing_view`, `signin_prompt_shown`, `signin_done`, `contact_click`, `paywall_shown`, `pass_purchased`. Run a 2-week A/B (gated vs open listing detail) and compare **pass purchases per visitor**, not sign-ups.

---

## 2. Pricing — P1

- **MAX is worse value than PRO:** ₹999 for 30 days is ₹33/day; PRO is ₹21/day. The picker shows the per-day price, so people will notice. Options:
  - ₹399 for 30 days (₹13/day), which makes MAX a real upsell; or
  - drop MAX.
  - Most flat hunts last 1–3 weeks, so a 14-day tier (around ₹249) may fit better than 30 days.
- The page says "₹149, not a month's rent", but the "from" price everywhere is ₹99. Pick one anchor.
- Consider **one free contact** (first conversation free, pass from the second). It proves the chat works before the user pays, and it's cheap because listers reply for free anyway.
- Seekers who never bought a pass see *every* incoming message locked, including replies to conversations a lister started. Decide whether a lister reaching out first should be readable for free. It's a strong conversion moment ("Aisha replied — renew to read") but can feel like a bait wall.

## 3. Copy vs behaviour (trust) — P1

| Copy says | Code does | Fix |
|---|---|---|
| "Takes 30 seconds with your phone number" (`contact-pass-view.tsx:238`); privacy page describes OTP | Phone sign-in is off | Turn OTP on or change the copy |
| FAQ and reminder email: "you can still read your conversations" | Messages after lapse are locked | Say "your history stays; new replies unlock when you renew" |
| Pass covers "rooms, flats, flatmates and **groups**" | No UI to message a group | Add "Message group" or drop "groups" from the copy |
| Contact-info error: "Keep the conversation on **Basera**" | Brand is FindFlatmates | Use `appConfig.name` |
| 402 message: "contact listers" | Also fires for flatmates and groups | Generic wording |
| ~~Block error: "You've blocked this lister"~~ | Fixed 2026-10-22: a block now reads as "doesn't exist" (404) | — |
| Privacy policy lists GTM/GA | Vercel Analytics is also loaded; no consent banner | Add it to the policy; consider a consent banner (DPDP Act) |

## 4. Bugs in business rules — P0

1. **Mock payments in production** are blocked only when `NODE_ENV=production` (`src/config.ts:57`). If that variable is missing on a deploy, passes are free. Key it off `PAYMENTS_PROVIDER` plus an explicit `ALLOW_MOCK_PAYMENTS`, or fail closed.
2. **Contact-info bypass:** custom amenities (free text, shown "in the lister's words"), lifestyle tags, flatmate `preferredAreas`, group `areas` and profile `lookingFor.areas` aren't checked on the server. A phone number fits in 30 characters, and that leaks the paywall.
3. **Group matches** only score the first 60 entire flats **nationwide** (`src/groups/groups.ts:196`). Filter candidates by the group's city and areas with `ST_DWithin` first.
4. **Unban restores every REMOVED listing**, including ones taken down for scams (`src/admin/admin.ts:413-418`). Record *why* a listing was removed (a `removed_reason` column) and only restore ban-caused ones.

## 5. Gaps in the product loop — P1/P2

- **There's no in-app sign that a pass is about to expire.** Only an email is sent, and phone-only users get nothing. Add a banner in `/messages` within 24 h of expiry.
- **Header "Get Pass" is desktop-only (`lg`).** On phones, where most users are, the pass is reachable only via contact CTAs. Put it in the profile menu or mobile tab.
- **Listers get no nudges.** Listings go STALE after 72 h and only an in-app note asks them to confirm. Stale listings erode seeker trust, and seekers are who pays. Send a "still available?" email or WhatsApp with a one-tap confirm link at 60 h.
- **Support inbox** is stored but there's no admin tab to read it. Everything relies on the forwarded email.
- **No unblock**, and no list of who you've blocked.
- **Deleting a listing** orphans its photo files. Abandoned PENDING uploads are never cleaned up.
- **No "no brokerage" filter.** "Zero brokerage" is the platform's pitch, but seekers can't filter for it.
- ~~`GET /listings/batch`, `GET /flatmates/:id` and `GET /groups/:id/matches` ignore blocks~~ — fixed 2026-10-22.

## 6. Web ↔ API drift — P2

Each hand-copied rule (see the table in `SKILL.md`) is a future bug. Cheapest fix: move the Zod schemas the API already mirrors (listing, flatmate, group, contact form, plans, freshness constants) into the synced `contract/` folder, so one copy exists. Until then, close the known drift: bathrooms 6 vs 10, member budget 2000 vs 1000, and the web-only refinements (`hasBrokerage`, ageMin ≤ ageMax, room bathroom/balcony).

## 7. Scale ceilings (fine now, note for later)

The rate limiter, SSE bus and commute cache are in-memory per instance, so they break once you run more than one API instance (already marked `ponytail:` in code). Geoapify's free tier is about 3k requests/day.

---

## Decided

- **2026-10-22 — Gate actions, not property discovery** (product owner). What's implemented:
  - Listing details are public in the API and the UI.
  - The 120-result signed-out cap is removed; paging stops at 1000 for everyone.
  - Flatmate profiles and group members are trimmed for signed-out callers **in the API**.
  - Group matches are signed-in only.
  - Save, contact, post, group and report actions still need sign-in; contacting still needs a pass (rules unchanged).
  - The pending action survives Google sign-in.
  - Details: `SKILL.md` → "Who sees what".
  - **Not decided** (unchanged): pricing, free contacts, the A/B experiment, phone OTP, a public-profile consent setting.
