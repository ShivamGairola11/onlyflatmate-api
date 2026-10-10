-- Profile photos. Google sign-ins start with their Google photo; anyone can upload their own, which the API
-- validates and re-encodes (src/users/avatar.ts) before publishing.

-- https only; plain http is allowed just for a local Supabase (127.0.0.1 / localhost).
alter table public.profiles add column avatar_url text check (avatar_url is null or avatar_url ~ '^(https://|http://(127\.0\.0\.1|localhost)[:/])');

-- The photo the sign-in provider gave us (Google's "avatar_url" / "picture"), https only.
create function public.provider_avatar(meta jsonb) returns text
language sql immutable set search_path = ''
as $$
  select case when url like 'https://%' then url end
  from (select coalesce(meta ->> 'avatar_url', meta ->> 'picture') as url) m
$$;

create or replace function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (user_id, display_name, avatar_url)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), public.provider_avatar(new.raw_user_meta_data));
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

-- Backfill existing Google users who don't have a photo yet.
update public.profiles p
set avatar_url = public.provider_avatar(u.raw_user_meta_data)
from auth.users u
where u.id = p.user_id and p.avatar_url is null and public.provider_avatar(u.raw_user_meta_data) is not null;

-- Raw uploads land here (private) and are deleted once processed; only the API's re-encoded copy is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatar-uploads', 'avatar-uploads', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 1048576, array['image/webp'])
on conflict (id) do nothing;
