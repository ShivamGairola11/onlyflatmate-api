-- Extra charges on top of rent and maintenance (Wi-Fi, rented furniture, a one-time cleaning fee…).
-- Shape is validated by the API; the database keeps it an array of at most 10 entries.
alter table public.listings
  add column extras jsonb not null default '[]'::jsonb
  check (jsonb_typeof(extras) = 'array' and jsonb_array_length(extras) <= 10);
