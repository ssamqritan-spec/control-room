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
  PUBLIC_URL: `http://localhost:${ADMIN}`, ALLOW_INSECURE_LOCAL: 'true', ADMIN_PASSWORD: '' }, stdio: 'inherit' });
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

import puppeteer from 'puppeteer-core';
const names = [['Amina Wanjiku','Nairobi'],['Joseph Kiptoo','Nakuru'],['Grace Achieng','Kisumu'],['Peter Mwangi','Nyeri'],['Faith Naliaka','Kakamega'],['Hassan Omar','Mombasa']];
const refs = [];
for (const [i,[n,c]] of names.entries()) {
  const base = i % 2 ? kmtc : elimu;
  const x = (await site('submit_application', { p: { ...base, student: n, county: c, phone: '07' + String(10000000 + i * 1111111), email: n.split(' ')[0].toLowerCase() + '@example.com', band: String(1 + (i % 5)), story: 'Throw-away test story.' } })).data;
  refs.push(x.ref);
  if (i < 5) await site('submit_payment', { p_ref: x.ref, p_code: 'MP' + String(i).repeat(8), p_phone: '0700000000' });
}
let rr = await A('records', { params: { site: 'elimu', view: 'payments' } }); // verify one elimu payment
await (async()=>{ cookie=''; const p = rr.data.rows[0]; const res = await A('review',{method:'POST',body:{payment_id:p.payment_id,expected_status:'pending',new_status:'verified',note:'ok',amount_received:p.amount_reported}}); })();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'], headless: 'new' });
const pg = await browser.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type()==='error' && errs.push(m.text()));
await pg.setViewport({ width: 1440, height: 900 });
const shot = async (hash, name, after) => { await pg.goto(`http://localhost:${ADMIN}/#${hash}`); await pg.reload(); await new Promise(r=>setTimeout(r,900)); if (after) await after(); await new Promise(r=>setTimeout(r,500)); await pg.screenshot({ path: `/tmp/${name}.png` }); };
await shot('all/overview', 'overview');
await shot('elimu/applications', 'elimu-apps');
await shot('kmtc/payments', 'kmtc-pay');
await shot('elimu/payments', 'drawer', async () => { await pg.click('tbody tr'); await new Promise(r=>setTimeout(r,700)); });
await pg.setViewport({ width: 390, height: 844 });
await shot('all/overview', 'mobile');
console.log('page errors:', errs);
await browser.close(); admin.kill(); rest.close(); process.exit(0);
