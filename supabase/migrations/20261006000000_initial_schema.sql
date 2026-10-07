-- Basera initial schema.
--
-- Access model: the browser never talks to this database. Every table has row
-- level security ON and NO policies, so Supabase's public API (anon/authenticated
-- roles) can read nothing. The NestJS API connects with a privileged role and
-- enforces ownership itself (the same rules the mock API enforces today).
--
-- Enumerations are text + CHECK so new values are a one-line migration.
-- Shapes mirror src/lib/api/contract.ts; JSON columns hold display-only nesting.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Places: the gazetteer the app searches by (seeded from src/lib/constants/places.ts)
-- ---------------------------------------------------------------------------

create table public.localities (
  slug text primary key,
  name text not null,
  city text not null,
  region text not null,
  point extensions.geography(Point, 4326) not null,
  radius_km numeric(4, 2) not null,
  nearest_metro text
);
create index localities_point_idx on public.localities using gist (point);

create table public.landmarks (
  id text primary key,
  name text not null,
  short_name text not null,
  kind text not null check (kind in ('WORKPLACE', 'COLLEGE')),
  city text not null,
  region text not null,
  point extensions.geography(Point, 4326) not null
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- One row per auth user: the contract's User and Profile together.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  mode text not null default 'SEEKING' check (mode in ('SEEKING', 'OFFERING')),
  is_admin boolean not null default false,
  age smallint check (age between 18 and 99),
  gender text check (gender in ('MALE', 'FEMALE', 'OTHER')),
  profession text not null default '',
  industry text not null default '',
  work_area text,
  workplace_id text,
  bio text check (char_length(bio) <= 500),
  lifestyle text[] not null default '{}',
  languages text[] not null default '{}',
  hometown text,
  -- SearchPreference: { areas, budgetMin, budgetMax, bhk, moveIn, genderPreference }
  looking_for jsonb,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  type text not null check (type in ('PHONE', 'EMAIL', 'IDENTITY', 'WORKPLACE')),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED')),
  verified_at timestamptz,
  unique (user_id, type)
);

-- A profile row appears the moment someone signs up (phone or Google), and the phone
-- counts as verified once Supabase confirms it (which can happen after the insert).
create function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (user_id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''));
  end if;
  if new.phone is not null and new.phone_confirmed_at is not null then
    insert into public.verifications (user_id, type, status, verified_at)
    values (new.id, 'PHONE', 'VERIFIED', new.phone_confirmed_at)
    on conflict (user_id, type) do update set status = 'VERIFIED', verified_at = excluded.verified_at;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user();

create trigger on_auth_user_phone_confirmed
  after update of phone_confirmed_at on auth.users
  for each row when (new.phone_confirmed_at is distinct from old.phone_confirmed_at)
  execute function public.handle_auth_user();

-- ---------------------------------------------------------------------------
-- Photos (uploaded straight to Storage via presigned URLs)
-- ---------------------------------------------------------------------------

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Set for uploads to our bucket; null for photos hosted elsewhere (seed data, imports).
  storage_path text unique,
  url text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  lister_id uuid not null references public.profiles (user_id) on delete cascade,
  type text not null check (type in ('PRIVATE_ROOM', 'SHARED_ROOM', 'ENTIRE_FLAT', 'FLATMATE_VACANCY', 'PG')),
  source text not null default 'PLATFORM' check (source in ('PLATFORM', 'FACEBOOK_IMPORT', 'PARTNER')),
  -- STALE is derived from last_confirmed_at at read time, never stored.
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'EXPIRED', 'OCCUPIED')),
  title text not null check (char_length(title) <= 120),
  description text not null default '' check (char_length(description) <= 1000),

  -- Public, fuzzed point. The exact point lives in listing_private_locations.
  public_point extensions.geography(Point, 4326) not null,
  locality text,
  city text,
  location_precision_m integer not null default 350,

  -- Property (filterable columns)
  bhk text not null check (bhk in ('1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS')),
  building_type text not null check (building_type in ('GATED_SOCIETY', 'BUILDER_FLOOR', 'DDA_FLAT', 'INDEPENDENT_HOUSE', 'STANDALONE_APARTMENT', 'OTHER')),
  building_type_other text,
  bedrooms smallint not null,
  bathrooms smallint not null,
  furnishing text not null check (furnishing in ('FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED')),
  floor smallint,
  total_floors smallint,
  area_sqft integer,
  amenities text[] not null default '{}',
  room jsonb,

  -- Pricing (whole rupees)
  rent integer not null check (rent between 1000 and 1000000),
  maintenance integer not null default 0 check (maintenance >= 0),
  deposit integer not null default 0 check (deposit >= 0),
  brokerage integer not null default 0 check (brokerage >= 0),
  electricity_included boolean not null default false,

  -- People already living there (lightweight, not necessarily platform users)
  flatmates jsonb not null default '[]',

  -- Who the lister is looking for
  pref_gender text not null default 'ANY' check (pref_gender in ('MALE', 'FEMALE', 'ANY')),
  pref_age_min smallint,
  pref_age_max smallint,
  pref_occupation text not null default 'ANY' check (pref_occupation in ('WORKING', 'STUDENT', 'ANY')),
  pref_lifestyle text[] not null default '{}',

  available_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  view_count integer not null default 0
);
create index listings_point_idx on public.listings using gist (public_point);
create index listings_search_idx on public.listings (status, rent);
create index listings_lister_idx on public.listings (lister_id);

-- Restricted: used only for commute routing, moderation and the owner's editor.
create table public.listing_private_locations (
  listing_id uuid primary key references public.listings (id) on delete cascade,
  exact_point extensions.geography(Point, 4326) not null,
  address_line text check (char_length(address_line) <= 140)
);

create table public.listing_photos (
  listing_id uuid not null references public.listings (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete restrict,
  position smallint not null,
  primary key (listing_id, photo_id),
  unique (listing_id, position)
);

-- One in-progress "Have a Place" draft per user.
create table public.listing_drafts (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  values jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.saved_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  saved_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

-- ---------------------------------------------------------------------------
-- Find a Flatmate / Find Together
-- ---------------------------------------------------------------------------

-- Name, age, gender, profession and verification are read from profiles.
create table public.flatmate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (user_id) on delete cascade,
  bio text not null check (char_length(bio) between 1 and 500),
  budget_min integer not null,
  budget_max integer not null,
  preferred_areas text[] not null,
  looking_for text[] not null,
  move_in date not null,
  lifestyle text[] not null default '{}',
  gender_preference text not null default 'ANY' check (gender_preference in ('MALE', 'FEMALE', 'ANY')),
  has_place boolean not null default false,
  listing_id uuid references public.listings (id) on delete set null,
  languages text[] not null default '{}',
  work_area text not null default '',
  workplace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min <= budget_max)
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (user_id) on delete cascade,
  name text not null check (char_length(name) between 3 and 60),
  bhk text[] not null,
  areas text[] not null,
  total_budget integer not null,
  move_in date not null,
  people_needed smallint not null check (people_needed between 2 and 6),
  lifestyle text[] not null default '{}',
  note text check (char_length(note) <= 280),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Null for people added by name who haven't joined the platform yet.
  user_id uuid references public.profiles (user_id) on delete cascade,
  name text not null,
  profession text not null default '',
  budget integer not null,
  role text not null default 'MEMBER' check (role in ('OWNER', 'MEMBER')),
  status text not null default 'JOINED' check (status in ('JOINED', 'INVITED')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  context_type text not null check (context_type in ('LISTING', 'FLATMATE', 'GROUP')),
  context_id uuid not null,
  -- Snapshot shown in the thread header, so it survives the listing changing or going away.
  context jsonb not null,
  initiator_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role text not null check (role in ('SEEKER', 'LISTER', 'MEMBER')),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- Payments and the Contact Pass entitlement
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  amount integer not null,
  currency text not null default 'INR' check (currency = 'INR'),
  provider text not null check (provider in ('MOCK', 'RAZORPAY', 'STRIPE')),
  provider_order_id text not null unique,
  provider_payment_id text,
  method text check (method in ('UPI', 'CARD', 'NETBANKING')),
  status text not null default 'CREATED' check (status in ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED')),
  purpose text not null default 'CONTACT_PASS' check (purpose = 'CONTACT_PASS'),
  created_at timestamptz not null default now()
);

create table public.contact_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  payment_id uuid not null unique references public.payments (id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index contact_passes_user_idx on public.contact_passes (user_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (user_id) on delete cascade,
  target_type text not null check (target_type in ('LISTING', 'USER', 'GROUP')),
  target_id uuid not null,
  reason text not null check (reason in ('SCAM', 'WRONG_INFORMATION', 'ALREADY_RENTED', 'INAPPROPRIATE_CONTENT', 'SUSPICIOUS_BEHAVIOUR', 'OTHER')),
  details text check (char_length(details) <= 1000),
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWED', 'ACTIONED')),
  created_at timestamptz not null default now()
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (user_id) on delete cascade,
  blocked_user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

-- ---------------------------------------------------------------------------
-- Lock everything to the API: RLS on, no policies.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'localities', 'landmarks', 'profiles', 'verifications', 'photos', 'listings', 'listing_private_locations',
    'listing_photos', 'listing_drafts', 'saved_listings', 'flatmate_profiles', 'groups', 'group_members',
    'conversations', 'conversation_participants', 'messages', 'payments', 'contact_passes', 'reports', 'blocks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Listing photos are public to read (they're shown to everyone); writing only happens through
-- short-lived signed upload URLs that the API issues to the owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
