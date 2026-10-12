-- Moderation takedowns get their own status. Before this, a takedown set EXPIRED — the same as a
-- listing that simply lapsed — so the owner could press "Still available" and put it straight back up.
-- REMOVED is hidden from everyone but the owner and admins, and only an admin can lift it.
alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('ACTIVE', 'EXPIRED', 'OCCUPIED', 'REMOVED'));
