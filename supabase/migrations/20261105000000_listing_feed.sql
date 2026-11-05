-- The feed: people can like a listing and comment on it, in public.
-- Both go when the listing or the person's profile goes (account deletion cascades through profiles).

create table public.listing_likes (
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create index listing_likes_user on public.listing_likes (user_id);

-- Short and plain: no phone numbers or emails (the API checks, like every other free-text field),
-- so contact details still only change hands through chat and the Contact Pass.
create table public.listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  author_id uuid not null references public.profiles (user_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index listing_comments_listing on public.listing_comments (listing_id, created_at);
create index listing_comments_author on public.listing_comments (author_id);

-- Only the API (privileged role) reads or writes them, like every other table.
alter table public.listing_likes enable row level security;
alter table public.listing_comments enable row level security;
