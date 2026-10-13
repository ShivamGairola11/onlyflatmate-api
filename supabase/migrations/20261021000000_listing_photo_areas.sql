-- Which part of the home each listing photo shows, so the listing can group them (room, bathroom, balcony…).
-- Null for photos added before areas existed.
alter table public.listing_photos
  add column area text check (area in ('BEDROOM', 'BATHROOM', 'BALCONY', 'KITCHEN', 'LIVING', 'BUILDING'));
