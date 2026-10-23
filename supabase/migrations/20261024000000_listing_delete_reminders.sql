-- When we emailed "your listing will be deleted soon". Claimed in the same statement that selects the
-- listing, so it's sent at most once per confirmation cycle even with several API instances
-- (a reminder older than last_confirmed_at belongs to an earlier cycle).
alter table public.listings add column delete_reminder_sent_at timestamptz;
