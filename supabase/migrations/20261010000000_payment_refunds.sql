-- Admins can refund Contact Pass payments; a refunded payment keeps its row for the books.
alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'));
