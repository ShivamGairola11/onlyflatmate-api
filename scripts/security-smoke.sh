#!/usr/bin/env bash
# Security smoke test: attacks a running API and prints PASS/FAIL per check (see docs/SECURITY.md in the web app).
# Run it against a TEST instance — it deliberately trips rate limits:
#   npm run build
#   PORT=4100 INTERNAL_API_KEY=<key> RAZORPAY_WEBHOOK_SECRET=<secret> node --env-file=.env dist/src/main.js
#   API=http://127.0.0.1:4100 INTERNAL_API_KEY=<key> WEBHOOK_SECRET=<secret> bash scripts/security-smoke.sh
API=${API:-http://127.0.0.1:4100}
KEY=${INTERNAL_API_KEY:?set INTERNAL_API_KEY to the instance\'s key}
K=(-H "x-internal-key: $KEY")
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

for i in $(seq 1 30); do [ "$(code $API/health)" = 200 ] && break; sleep 1; done

# 1. Only the BFF may call the API.
c=$(code $API/listings); [ "$c" = 404 ] && ok "no internal key -> $c" || bad "no internal key -> $c"
c=$(code -H "x-internal-key: wrong-key-0123456789abcdef0123456" $API/listings); [ "$c" = 404 ] && ok "wrong internal key -> $c" || bad "wrong key -> $c"
c=$(code "${K[@]}" $API/listings); [ "$c" = 200 ] && ok "correct key -> $c" || bad "correct key -> $c"
c=$(code $API/health); [ "$c" = 200 ] && ok "/health open for uptime checks -> $c" || bad "health -> $c"

# 2. No framework fingerprint.
h=$(curl -s -D - -o /dev/null "${K[@]}" $API/listings | grep -i '^x-powered-by'); [ -z "$h" ] && ok "no X-Powered-By header" || bad "X-Powered-By present: $h"

# 3. Bad cursor values don't 500.
for raw in -50 1e309 abc; do
  cur=$(printf '%s' "$raw" | base64)
  c=$(code "${K[@]}" -H "x-client-ip: 10.0.0.9" "$API/listings?cursor=$cur"); [ "$c" = 200 ] && ok "cursor '$raw' -> $c" || bad "cursor '$raw' -> $c"
done

# 4. Signed-out paging stops at 120.
r=$(curl -s "${K[@]}" -H "x-client-ip: 10.0.0.10" "$API/listings?cursor=$(printf 120 | base64)&limit=60")
echo "$r" | grep -q '"items":\[\]' && ! echo "$r" | grep -q nextCursor && ok "signed-out offset 120 -> empty, no nextCursor" || bad "offset 120 -> $(echo "$r" | head -c 120)"

# 5. includeInactive is ignored (no longer a public switch).
a=$(curl -s "${K[@]}" -H "x-client-ip: 10.0.0.11" "$API/listings?limit=1" | grep -o '"total":[0-9]*')
b=$(curl -s "${K[@]}" -H "x-client-ip: 10.0.0.11" "$API/listings?limit=1&includeInactive=true" | grep -o '"total":[0-9]*')
[ "$a" = "$b" ] && ok "includeInactive ignored ($a)" || bad "includeInactive changed totals: $a vs $b"

# 6. Validation errors don't dump the schema.
r=$(curl -s "${K[@]}" -H "x-client-ip: 10.0.0.12" "$API/listings?moveIn=CUSTOM&moveInDate=garbage")
echo "$r" | grep -q '"issues"' && bad "zod issue tree exposed: $r" || ok "422 message only: $(echo "$r" | head -c 90)"

# 7. Oversized bodies are refused with 413 before parsing.
big=$(mktemp); { printf '{"text":"'; head -c 200000 /dev/zero | tr '\0' 'a'; printf '"}'; } > "$big"
c=$(code "${K[@]}" -X POST -H 'content-type: application/json' --data-binary @"$big" $API/listings/import); rm -f "$big"
[ "$c" = 413 ] && ok "200 KB body -> $c" || bad "200 KB body -> $c"

# 8. Rate limit: 60/min on search per IP, then 429 with Retry-After; other IPs unaffected.
last=; for i in $(seq 1 61); do last=$(code "${K[@]}" -H "x-client-ip: 10.9.9.9" "$API/listings?limit=1"); done
[ "$last" = 429 ] && ok "61st search in a minute -> 429" || bad "61st search -> $last"
ra=$(curl -s -D - -o /dev/null "${K[@]}" -H "x-client-ip: 10.9.9.9" "$API/listings?limit=1" | grep -i '^retry-after')
[ -n "$ra" ] && ok "Retry-After sent ($(echo "$ra" | tr -d '\r'))" || bad "no Retry-After"
c=$(code "${K[@]}" -H "x-client-ip: 10.9.9.8" "$API/listings?limit=1"); [ "$c" = 200 ] && ok "other IP unaffected -> $c" || bad "other IP -> $c"

# 9. Geocoder: 30/min.
last=; for i in $(seq 1 31); do last=$(code "${K[@]}" -H "x-client-ip: 10.8.8.8" "$API/locations/geocode?q=sector%2052"); done
[ "$last" = 429 ] && ok "31st geocode in a minute -> 429" || bad "31st geocode -> $last"

# 10. Commute destinations outside the cities we serve are refused (no free routing through us).
c=$(code "${K[@]}" -H "x-client-ip: 10.7.7.7" "$API/listings/pins?workplaceId=geo:51.5,-0.12:London"); [ "$c" = 422 ] && ok "pin outside our cities -> $c" || bad "pin outside our cities -> $c"

# 11. Webhook: raw-body signature verified (WEBHOOK_SECRET = the instance's RAZORPAY_WEBHOOK_SECRET).
if [ -n "$WEBHOOK_SECRET" ]; then
  body='{"event":"ping"}'
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
  c=$(code "${K[@]}" -X POST -H 'content-type: application/json' -H "x-razorpay-signature: $sig" --data "$body" $API/webhooks/razorpay); [ "$c" = 200 ] && ok "webhook with valid signature -> $c" || bad "valid webhook -> $c"
  c=$(code "${K[@]}" -X POST -H 'content-type: application/json' -H "x-razorpay-signature: deadbeef" --data "$body" $API/webhooks/razorpay); [ "$c" = 401 ] && ok "webhook with bad signature -> $c" || bad "bad webhook -> $c"
  c=$(code "${K[@]}" -X POST -H 'content-type: application/json' -H "x-razorpay-signature: $sig" --data '{"event":"ping" }' $API/webhooks/razorpay); [ "$c" = 401 ] && ok "webhook body altered by 1 byte -> $c" || bad "altered webhook -> $c"
else
  echo "SKIP  webhook checks (set WEBHOOK_SECRET)"
fi

# 12. Protected routes need auth; forged tokens rejected.
c=$(code "${K[@]}" $API/users/me); [ "$c" = 401 ] && ok "no token on /users/me -> $c" || bad "/users/me -> $c"
c=$(code "${K[@]}" -H 'authorization: Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' $API/users/me); [ "$c" = 401 ] && ok "alg=none token -> $c" || bad "alg none -> $c"
c=$(code "${K[@]}" $API/admin/stats); [ "$c" = 401 ] && ok "admin without token -> $c" || bad "admin -> $c"

# 13. SQL injection probes return normal results or validation errors, never 500.
for q in "area=%27%20or%201%3D1--" "sort=PRICE_ASC%3Bdrop%20table%20listings" "amenities=WIFI%27%29--" "types=PG%27"; do
  c=$(code "${K[@]}" -H "x-client-ip: 10.6.6.6" "$API/listings?$q"); [ "$c" != 500 ] && ok "injection probe '$q' -> $c" || bad "injection '$q' -> 500"
done
