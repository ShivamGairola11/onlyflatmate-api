-- Contact Pass plans (Mini 3 days, Pro 7, Max 30). Null = bought before plans existed, or complimentary.
alter table public.payments add column plan text check (plan in ('MINI', 'PRO', 'MAX'));
alter table public.contact_passes add column plan text check (plan in ('MINI', 'PRO', 'MAX'));
