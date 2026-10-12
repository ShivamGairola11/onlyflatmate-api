-- When we emailed "your Contact Pass ends soon". Set in the same statement that claims the pass,
-- so each pass is reminded at most once even with several API instances.
alter table public.contact_passes add column reminder_sent_at timestamptz;
