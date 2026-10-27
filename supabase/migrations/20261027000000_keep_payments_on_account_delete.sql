-- Deleting an account deletes the profile and everything under it, but payment records are kept for the
-- books (privacy policy): the row stays, detached from the person.
alter table public.payments alter column user_id drop not null;
alter table public.payments drop constraint payments_user_id_fkey;
alter table public.payments add constraint payments_user_id_fkey foreign key (user_id) references public.profiles (user_id) on delete set null;
