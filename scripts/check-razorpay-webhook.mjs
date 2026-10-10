// Usage: start the API with RAZORPAY_WEBHOOK_SECRET=whsec_local_test on PORT=4100, then: node scripts/check-razorpay-webhook.mjs
// Webhook check against the local API: signed capture grants exactly one pass; bad signature / wrong amount don't.
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
process.loadEnvFile('.env');
const db = new pg.Client(process.env.DATABASE_URL); await db.connect();
const SECRET = 'whsec_local_test', URL = 'http://127.0.0.1:4100/webhooks/razorpay';
const send = (body, sig) => fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig ?? createHmac('sha256', SECRET).update(body).digest('hex') }, body });
const event = (order, amount) => JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST1', order_id: order, amount, method: 'upi' } } } });
const passes = async (pid) => (await db.query('select count(*)::int n from contact_passes where payment_id=$1', [pid])).rows[0].n;

const { rows: [u] } = await db.query('select user_id from profiles limit 1');
const order = 'order_TEST_' + Date.now();
const { rows: [p] } = await db.query(`insert into payments (user_id, amount, provider, provider_order_id) values ($1, 59, 'RAZORPAY', $2) returning id`, [u.user_id, order]);
try {
  assert.equal((await send(event(order, 5900), 'bad')).status, 401, 'bad signature rejected');
  assert.equal(await passes(p.id), 0);
  assert.equal((await send(event(order, 100))).status, 200, 'wrong amount acked');
  assert.equal(await passes(p.id), 0, 'wrong amount grants nothing');
  assert.equal((await send(event(order, 5900))).status, 200);
  assert.equal(await passes(p.id), 1, 'signed capture grants a pass');
  const [a, b] = await Promise.all([send(event(order, 5900)), send(event(order, 5900))]);
  assert.deepEqual([a.status, b.status], [200, 200], 'retries succeed');
  assert.equal(await passes(p.id), 1, 'still exactly one pass');
  const { rows: [after] } = await db.query('select status, method, provider_payment_id from payments where id=$1', [p.id]);
  assert.deepEqual(after, { status: 'SUCCEEDED', method: 'UPI', provider_payment_id: 'pay_TEST1' });
  assert.equal((await send(JSON.stringify({ event: 'payment.failed', payload: {} }))).status, 200, 'other events acked');
  console.log('all webhook checks passed');
} finally {
  await db.query('delete from contact_passes where payment_id=$1', [p.id]);
  await db.query('delete from payments where id=$1', [p.id]);
  await db.end();
}
