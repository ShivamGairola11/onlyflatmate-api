-- Security fix: public listing points were offset by a PRNG seeded with the (public) listing id,
-- so anyone could reverse the offset and recover the exact address. Re-offset every listing from
-- its private exact point with server-side randomness (120–350 m, any bearing). New and moved
-- pins now use crypto randomness in the API (common/geo.ts fuzzedPointSql).
update public.listings l
set public_point = extensions.st_project(
  p.exact_point,
  (0.35 + random() * 0.65) * l.location_precision_m,
  random() * 2 * pi()
)
from public.listing_private_locations p
where p.listing_id = l.id;
