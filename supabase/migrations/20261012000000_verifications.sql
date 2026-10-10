-- Self-serve verification: phone and email are confirmed by Supabase Auth; identity is an uploaded ID that an
-- admin reviews (the document is deleted once decided); workplace is a code sent to a work email.

-- What was submitted, for the admin queue and the profile page.
alter table public.verifications
  add column document_type text check (document_type in ('AADHAAR', 'PAN', 'DRIVING_LICENCE', 'PASSPORT', 'VOTER_ID')),
  -- Path in the private `id-documents` bucket while awaiting review; cleared (and the file deleted) on decision.
  add column document_path text,
  -- Workplace: the verified company domain, e.g. "infosys.com". Never the full work email.
  add column detail text,
  add column submitted_at timestamptz,
  -- Shown to the user when a submission is rejected ("Photo too blurry").
  add column review_note text;

-- Email counts as verified once Supabase confirms it (Google sign-ins arrive confirmed); phone as before.
create or replace function public.handle_auth_user() returns trigger
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
  if new.email is not null and new.email_confirmed_at is not null then
    insert into public.verifications (user_id, type, status, verified_at)
    values (new.id, 'EMAIL', 'VERIFIED', new.email_confirmed_at)
    on conflict (user_id, type) do update set status = 'VERIFIED', verified_at = excluded.verified_at;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at, email on auth.users
  for each row when (new.email_confirmed_at is distinct from old.email_confirmed_at or new.email is distinct from old.email)
  execute function public.handle_auth_user();

-- Backfill: everyone who already has a confirmed email.
insert into public.verifications (user_id, type, status, verified_at)
select u.id, 'EMAIL', 'VERIFIED', u.email_confirmed_at
from auth.users u
join public.profiles p on p.user_id = u.id
where u.email is not null and u.email_confirmed_at is not null
on conflict (user_id, type) do update set status = 'VERIFIED', verified_at = excluded.verified_at;

-- Private bucket for ID photos: no public URLs; only the API (service role) reads or writes, via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-documents', 'id-documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Pending work-email codes (one per user). Only a hash of the code is stored.
create table public.work_email_codes (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  domain text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);
alter table public.work_email_codes enable row level security;
