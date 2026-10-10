// Smoke check for the admin API. Start the API on PORT=4100 first (local Supabase, HS256 secret in .env), then:
//   node scripts/check-admin.mjs
// Temporarily makes one seeded user an admin; everything it changes is put back.
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import pg from 'pg';
process.loadEnvFile('.env');
const BASE = 'http://127.0.0.1:4100';
const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();
const { rows: [admin, other] } = await db.query('select user_id from profiles order by created_at limit 2');
const tokenFor = (sub) => new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setExpirationTime('10m').sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
const call = async (token, method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const created = [];
try {
  const nonAdmin = await tokenFor(other.user_id);
  assert.equal((await call(nonAdmin, 'GET', '/admin/stats')).status, 403, 'non-admins are refused');

  await db.query('update profiles set is_admin = true where user_id = $1', [admin.user_id]);
  const t = await tokenFor(admin.user_id);

  const stats = await call(t, 'GET', '/admin/stats');
  assert.equal(stats.status, 200);
  for (const k of ['users', 'newUsers7d', 'activePasses', 'revenueInr', 'revenue30dInr', 'messages7d']) assert.equal(typeof stats.body[k], 'number', `stats.${k}`);

  for (const days of [7, 30, 90]) {
    const o = await call(t, 'GET', `/admin/overview?days=${days}`);
    assert.equal(o.status, 200, `overview ${days}: ${JSON.stringify(o.body)}`);
    assert.equal(o.body.daily.length, days, `one row per day for ${days}d`);
    assert.equal(o.body.kpis.revenueInr.current, o.body.daily.reduce((s, d) => s + d.revenueInr, 0), 'daily revenue adds up to the KPI');
  }
  assert.equal((await call(t, 'GET', '/admin/overview?days=12')).status, 422, 'only 7/30/90');
  for (const list of ['users', 'payments', 'passes', 'listings', 'reports', 'verifications']) {
    const r = await call(t, 'GET', `/admin/${list}?page=1`);
    assert.equal(r.status, 200, `${list}: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.items) && typeof r.body.total === 'number', `${list} page shape`);
    console.log(`  ${list}: ${r.body.total}`);
  }
  assert.equal((await call(t, 'GET', '/admin/users?q=%25')).status, 200, 'search escapes LIKE wildcards');
  assert.equal((await call(t, 'GET', '/admin/listings?status=REPORTED')).status, 200);

  // Pass operations on the second user: grant → extend → revoke.
  assert.equal((await call(t, 'POST', '/admin/passes', { userId: other.user_id, days: 3 })).status, 204, 'grant');
  const { rows: [pass] } = await db.query(`select c.id, c.payment_id, c.expires_at from contact_passes c join payments p on p.id = c.payment_id where c.user_id = $1 and p.amount = 0 order by c.starts_at desc limit 1`, [other.user_id]);
  created.push(pass);
  const passes = await call(t, 'GET', `/admin/passes?q=${other.user_id}&status=ACTIVE`);
  assert.ok(passes.body.items.some((p) => p.id === pass.id && p.complimentary), 'complimentary pass listed');
  assert.equal((await call(t, 'POST', `/admin/passes/${pass.id}/extend`, { days: 2 })).status, 204, 'extend');
  const { rows: [ext] } = await db.query('select expires_at from contact_passes where id = $1', [pass.id]);
  assert.ok(Math.abs(new Date(ext.expires_at) - new Date(pass.expires_at) - 2 * 86_400_000) < 5000, 'extended by 2 days');
  assert.equal((await call(t, 'POST', `/admin/passes/${pass.id}/revoke`)).status, 204, 'revoke');
  assert.equal((await call(t, 'POST', `/admin/passes/${pass.id}/revoke`)).status, 422, 'revoking twice is refused');
  assert.equal((await call(t, 'POST', `/admin/payments/${pass.payment_id}/refund`)).status, 422, 'comp passes can’t be refunded');

  // Guard rails.
  assert.equal((await call(t, 'POST', `/admin/users/${admin.user_id}/admin`, { isAdmin: false })).status, 422, 'can’t demote yourself');
  assert.equal((await call(t, 'POST', `/admin/users/${admin.user_id}/ban`, { banned: true })).status, 422, 'can’t ban yourself');
  console.log('all admin checks passed');
} finally {
  for (const p of created) {
    await db.query('delete from contact_passes where id = $1', [p.id]);
    await db.query('delete from payments where id = $1', [p.payment_id]);
  }
  await db.query('update profiles set is_admin = false where user_id = $1', [admin.user_id]);
  await db.end();
}
