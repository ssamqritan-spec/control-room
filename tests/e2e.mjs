// End-to-end test: real PostgreSQL engine (PGlite) running database/schema.sql,
// a Supabase-style REST layer in front of it (anon key vs service key roles),
// and the REAL control-room server talking to it. Uses throw-away in-memory data only.
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const ANON = 'anon-test-key', SERVICE = 'service-test-key', REST = 54321, ADMIN = 3456;
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8')); // re-runnable
console.log('✓ schema.sql runs, and is safe to run twice');

// ---- tiny PostgREST look-alike -------------------------------------------
const rest = http.createServer(async (req, res) => {
  const fn = new URL(req.url, 'http://x').pathname.split('/').pop();
  const key = (req.headers.authorization || '').replace('Bearer ', '');
  const role = key === SERVICE ? 'service_role' : key === ANON ? 'anon' : null;
  let body = ''; for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (!role) return send(401, { message: 'Invalid API key' });
  const args = JSON.parse(body || '{}'), names = Object.keys(args);
  try {
    const out = await db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      return tx.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) as r`,
        names.map(n => (args[n] !== null && typeof args[n] === 'object') ? JSON.stringify(args[n]) : args[n]));
    });
    send(200, out.rows[0].r ?? null);
  } catch (e) { send(400, { message: e.message }); }
}).listen(REST);

// ---- the real control-room server ---------------------------------------
const admin = spawn('node', ['dev-server.mjs'], { cwd: new URL('../admin/', import.meta.url), env: {
  ...process.env, PORT: ADMIN, SUPABASE_URL: `http://localhost:${REST}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  PUBLIC_URL: `http://localhost:${ADMIN}`, ALLOW_INSECURE_LOCAL: 'true', ADMIN_PASSWORD: 'correct horse battery' }, stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1200));

const base = `http://localhost:${ADMIN}/api/operations`;
let cookie = '';
const A = async (action, { method = 'GET', body, params = {} } = {}) => {
  const r = await fetch(`${base}?` + new URLSearchParams({ action, ...params }), { method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: `http://localhost:${ADMIN}`, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const sc = r.headers.get('set-cookie'); if (sc && /bcr_session=[^;]/.test(sc)) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
};
const site = async (fn, args) => { // what the public websites do (anon key)
  const r = await fetch(`http://localhost:${REST}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` }, body: JSON.stringify(args) });
  return { ok: r.ok, data: await r.json() };
};

const elimu = { site: 'elimu', instType: 'University', institution: 'University of Nairobi', year: 'Year 2', course: 'BSc Nursing', helb: 'HELB', band: '3', student: 'Amina Wanjiku', birthYear: '2003', phone: '0712345678', email: 'amina@example.com', county: 'Nairobi', subcounty: 'Westlands', town: 'Westlands', location: 'Parklands', sublocation: 'Highridge', guardian: 'Mary W', relationship: 'Parent', condition: 'Orphan', story: 'My story' };
const kmtc = { site: 'kmtc', instType: 'KMTC', institution: 'KMTC Nairobi', year: 'Year 1', course: 'Clinical Medicine', level: 'Diploma', admNo: 'KMTC/001/2026', otherSupport: 'None', band: '1', student: 'Brian Otieno', birthYear: '2002', phone: '0799888777', email: 'brian@example.com', county: 'Kisumu', subcounty: 'Kisumu East', town: 'Kisumu', location: 'Milimani', sublocation: 'Central', guardian: 'Paul O', relationship: 'Guardian', condition: 'Low income', story: '=HYPERLINK("http://evil")' };

// ---- 1. access gate --------------------------------------------------------
let r = await A('overview'); assert.equal(r.status, 401); console.log('✓ no session → data refused (401)');
r = await A('login', { method: 'POST', body: { password: 'wrong' } }); assert.equal(r.status, 401); console.log('✓ wrong password refused');
r = await A('login', { method: 'POST', body: { password: 'correct horse battery' } }); assert.equal(r.status, 200); assert.ok(cookie);
r = await fetch(`${base}?action=login`, { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{"password":"x"}' }); assert.equal(r.status, 403);
console.log('✓ correct password signs in; cross-origin POST blocked');

// ---- 2. brand-new database is EMPTY ---------------------------------------
r = await A('overview');
for (const s of ['elimu', 'kmtc']) { assert.equal(r.data[s].applications, 0); assert.equal(r.data[s].verified, 0); assert.equal(r.data[s].fees_received, 0); assert.equal(r.data[s].daily.length, 14); }
r = await A('records', { params: { site: 'elimu', view: 'applications' } }); assert.equal(r.data.total, 0); assert.deepEqual(r.data.rows, []);
console.log('✓ new database shows zero everywhere (no demo data)');

// ---- 3. permissions: public sites cannot reach admin functions --------------
r = await site('admin_overview', {}); assert.equal(r.ok, false); assert.match(r.data.message, /permission denied/i);
r = await site('admin_records', { p_site: 'elimu', p_view: 'applications' }); assert.equal(r.ok, false);
r = await site('admin_review_payment', { p_payment_id: '00000000-0000-0000-0000-000000000000', p_expected_status: 'pending', p_new_status: 'verified' }); assert.equal(r.ok, false);
await assert.rejects(() => db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select * from applications'); }), /permission denied/i);
console.log('✓ anon key cannot call admin functions or read tables');

// ---- 4. both websites submit ---------------------------------------------
r = await site('submit_application', { p: { ...elimu, band: '9' } }); assert.equal(r.ok, false);
r = await site('submit_application', { p: { ...elimu, site: 'other' } }); assert.equal(r.ok, false);
const e1 = (await site('submit_application', { p: elimu })).data; const k1 = (await site('submit_application', { p: kmtc })).data;
assert.match(e1.ref, /^EK-/); assert.match(k1.ref, /^KM-/);
assert.equal(e1.amount, 12500); assert.equal(e1.fee, 200); assert.equal(k1.amount, 20000); assert.equal(k1.fee, 300);
const e2 = (await site('submit_application', { p: { ...elimu, student: 'Second Elimu', phone: '0700000000', email: 'two@example.com', band: '5' } })).data;
console.log('✓ Elimu + KMTC applications stored with server-computed amounts and prefixes', e1.ref, k1.ref);

// ---- 5. partitioning -------------------------------------------------------
r = await A('records', { params: { site: 'elimu', view: 'applications' } });
assert.equal(r.data.total, 2); assert.ok(r.data.rows.every(x => x.site === 'elimu' && x.ref.startsWith('EK-')));
r = await A('records', { params: { site: 'kmtc', view: 'applications' } });
assert.equal(r.data.total, 1); assert.equal(r.data.rows[0].adm_no, 'KMTC/001/2026'); assert.equal(r.data.rows[0].student, 'Brian Otieno');
r = await A('records', { params: { site: 'kmtc', view: 'applications', search: 'amina' } }); assert.equal(r.data.total, 0);
console.log('✓ Elimu and KMTC users are never mixed (including in search)');

// ---- 6. payments -----------------------------------------------------------
r = await site('submit_payment', { p_ref: e1.ref, p_code: 'bad', p_phone: '0712345678' }); assert.equal(r.ok, false);
r = await site('submit_payment', { p_ref: 'EK-NOPE0000', p_code: 'ABCDE12345', p_phone: '0712345678' }); assert.equal(r.ok, false);
assert.equal((await site('submit_payment', { p_ref: e1.ref, p_code: 'abcde12345', p_phone: '0712345678' })).ok, true);
assert.equal((await site('submit_payment', { p_ref: k1.ref, p_code: 'KMTC123456', p_phone: '0799888777' })).ok, true);
r = await site('submit_payment', { p_ref: k1.ref, p_code: 'ABCDE12345', p_phone: '0799888777' }); assert.equal(r.ok, false, 'same M-Pesa code cannot be reused');
assert.equal((await site('application_status', { p_ref: e1.ref })).data, 'payment_submitted');
r = await A('overview'); assert.equal(r.data.elimu.payment_submitted, 1); assert.equal(r.data.elimu.awaiting_payment, 1); assert.equal(r.data.kmtc.payment_submitted, 1);
assert.equal(r.data.elimu.fees_pending, 200); assert.equal(r.data.kmtc.fees_pending, 300); assert.equal(r.data.elimu.fees_received, 0);
assert.equal(r.data.elimu.to_receive_all, 12500 + 5000); assert.equal(r.data.elimu.to_receive_paid, 12500);
r = await A('records', { params: { site: 'elimu', view: 'payments' } });
assert.equal(r.data.total, 1); const pay = r.data.rows[0];
assert.equal(pay.mpesa_code, 'ABCDE12345'); assert.equal(pay.student, 'Amina Wanjiku'); assert.equal(pay.amount, 12500); assert.equal(pay.amount_reported, 200);
assert.ok(pay.paid_at && pay.applied_at && new Date(pay.paid_at) >= new Date(pay.applied_at));
console.log('✓ payments recorded with code, fee due, bursary amount and both timestamps');

// ---- 7. admin review flow ---------------------------------------------------
r = await A('review', { method: 'POST', body: { payment_id: pay.payment_id, expected_status: 'pending', new_status: 'rejected', note: '' } }); assert.equal(r.status, 409);
r = await A('review', { method: 'POST', body: { payment_id: pay.payment_id, expected_status: 'verified', new_status: 'rejected', note: 'x y z' } }); assert.equal(r.status, 409);
r = await A('review', { method: 'POST', body: { payment_id: pay.payment_id, expected_status: 'pending', new_status: 'rejected', note: 'Code not found in statement' } }); assert.equal(r.status, 200);
assert.equal((await site('application_status', { p_ref: e1.ref })).data, 'payment_rejected');
assert.equal((await site('submit_payment', { p_ref: e1.ref, p_code: 'ABCDE12345', p_phone: '0712345678' })).ok, true, 'rejected code may be retried');
assert.equal((await site('application_status', { p_ref: e1.ref })).data, 'payment_submitted');
r = await A('records', { params: { site: 'elimu', view: 'payments', status: 'pending' } }); const pay2 = r.data.rows[0];
r = await A('review', { method: 'POST', body: { payment_id: pay2.payment_id, expected_status: 'pending', new_status: 'verified', note: 'Matched SMS', amount_received: 200 } }); assert.equal(r.status, 200);
assert.equal((await site('application_status', { p_ref: e1.ref })).data, 'verified');
r = await site('submit_payment', { p_ref: e1.ref, p_code: 'ZZZZZ99999', p_phone: '0712345678' }); assert.equal(r.ok, false, 'no new payment after verification');
r = await A('overview'); assert.equal(r.data.elimu.verified, 1); assert.equal(r.data.elimu.fees_received, 200); assert.equal(r.data.elimu.fees_pending, 0); assert.equal(r.data.kmtc.fees_received, 0);
r = await A('records', { params: { site: 'elimu', view: 'applications', status: 'verified' } });
assert.equal(r.data.total, 1); assert.equal(Number(r.data.rows[0].fee_received), 200); assert.equal(r.data.rows[0].mpesa_code, 'ABCDE12345');
console.log('✓ reject → resubmit → verify works; totals and statuses follow');

// ---- 8. detail, activity, export, search by code ----------------------------
r = await A('records', { params: { site: 'elimu', view: 'applications', search: 'ABCDE12345' } }); assert.equal(r.data.total, 1);
r = await A('application', { params: { id: r.data.rows[0].id } });
assert.equal(r.data.payments.length, 2); assert.deepEqual(r.data.events.map(e => e.event).reverse(), ['application_completed', 'payment_submitted', 'payment_rejected', 'payment_submitted', 'payment_verified']);
assert.equal(r.data.application.story, 'My story');
r = await A('records', { params: { site: 'kmtc', view: 'activity' } }); assert.equal(r.data.total, 2);
r = await A('export', { params: { site: 'kmtc', view: 'applications' } });
assert.match(r.headers.get('content-disposition'), /kmtc-applications-/); assert.ok(r.data.includes("'=HYPERLINK") && !r.data.includes(',=HYPERLINK'), 'formula injection neutralised'); assert.ok(!r.data.includes('Amina'), 'export is per-site');
console.log('✓ detail timeline, activity, per-site CSV export (formula-safe)');

// ---- 9. logout ------------------------------------------------------------------
r = await A('logout', { method: 'POST', body: {} }); cookie = ''; r = await A('overview'); assert.equal(r.status, 401);
console.log('\nALL CHECKS PASSED');
admin.kill(); rest.close(); process.exit(0);
