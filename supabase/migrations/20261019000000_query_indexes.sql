-- Indexes for the queries the API actually runs (security audit, Oct 2026). Without them, every
-- public search, inbox load and block check is a sequential scan that grows with the data — the
-- cheapest way for heavy traffic (or a scraper) to slow the site for everyone.

-- Listing search: default filter (ACTIVE + recently confirmed) and recommended / pins ordering.
create index if not exists listings_active_confirmed_idx on public.listings (last_confirmed_at desc) where status = 'ACTIVE';
create index if not exists listings_created_idx on public.listings (created_at desc);
create index if not exists listings_amenities_gin on public.listings using gin (amenities);

-- Flatmates search: area overlap, workplace filter, ordering by activity.
create index if not exists flatmate_profiles_areas_gin on public.flatmate_profiles using gin (preferred_areas);
create index if not exists flatmate_profiles_workplace_idx on public.flatmate_profiles (workplace_id);
create index if not exists profiles_last_active_idx on public.profiles (last_active_at desc);

-- Groups list: city filter by areas, newest first.
create index if not exists groups_areas_gin on public.groups using gin (areas);
create index if not exists groups_created_idx on public.groups (created_at desc);

-- Messaging: existing-conversation lookup, inbox order, unread counts.
create index if not exists conversations_context_idx on public.conversations (context_id);
create index if not exists conversations_updated_idx on public.conversations (updated_at desc);
create index if not exists messages_unread_idx on public.messages (conversation_id) where read_at is null;
create index if not exists messages_sender_idx on public.messages (sender_id);

-- Blocks are checked in both directions; the unique index only covers blocker-first.
create index if not exists blocks_blocked_idx on public.blocks (blocked_user_id);

-- Uploads by owner; the pass-reminder job's claim.
create index if not exists photos_owner_idx on public.photos (owner_id);
create index if not exists contact_passes_remind_idx on public.contact_passes (expires_at) where reminder_sent_at is null;
