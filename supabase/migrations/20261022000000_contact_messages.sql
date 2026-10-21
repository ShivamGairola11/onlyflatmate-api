-- Messages sent from the /contact form. Kept even when the notification email fails, so none are lost.
-- Signed-out visitors can write too; user_id is set only when the sender was signed in.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (user_id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) <= 254),
  topic text not null check (topic in ('GENERAL', 'PAYMENTS', 'LISTING', 'ACCOUNT', 'GRIEVANCE')),
  message text not null check (char_length(message) between 10 and 2000),
  created_at timestamptz not null default now()
);

-- Reached only through the API's own connection; no client policies.
alter table public.contact_messages enable row level security;
