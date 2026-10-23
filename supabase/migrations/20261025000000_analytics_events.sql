-- First-party product events (the same ones pushed to GTM), so the admin dashboard can show the funnel.
-- visitor_id is a random id the browser keeps (no fingerprinting); user_id only when signed in.
-- Purchases are NOT recorded here: the funnel reads them from payments, which can't be spoofed.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null check (name in ('listing_view', 'signin_prompt_shown', 'signin_done', 'contact_click', 'paywall_shown')),
  visitor_id uuid not null,
  user_id uuid references public.profiles (user_id) on delete set null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_name_created on public.analytics_events (name, created_at);
create index analytics_events_created on public.analytics_events (created_at);

-- Only the API (privileged role) reads or writes it, like every other table.
alter table public.analytics_events enable row level security;
