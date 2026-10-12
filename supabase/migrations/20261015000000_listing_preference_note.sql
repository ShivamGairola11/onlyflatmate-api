-- The lister's own words about who'd fit in ("Who you're looking for" in the builder).
alter table public.listings
  add column pref_note text check (char_length(pref_note) <= 300);
