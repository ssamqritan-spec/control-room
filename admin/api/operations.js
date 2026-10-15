import { config, rpc } from '../lib/database.js';
import { isAuthed, passwordOk, makeCookie, clearCookie, throttled, noteFail, clearFails } from '../lib/auth.js';

const SITES = ['elimu', 'kmtc'];
const VIEWS = ['applications', 'payments', 'activity'];
const hdr = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (d, status = 200, extra = {}) => Response.json(d, { status, headers: { ...hdr, ...extra } });
const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
const csvCell = v => {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function handle(req) {
  try {
    const c = config();
    const q = new URL(req.url).searchParams, action = q.get('action') || 'session';
    const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();

    // ---- access gate -------------------------------------------------
    if (action === 'session') return reply({ authed: isAuthed(c, req), open: c.open });
    if (req.method === 'POST' && req.headers.get('origin') !== c.origin)
      return reply({ error: 'Request origin does not match the control room. Check PUBLIC_URL.' }, 403);

    if (action === 'login' && req.method === 'POST') {
      if (throttled(ip)) return reply({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      let b; try { b = JSON.parse(await req.text()); } catch { return reply({ error: 'Invalid request.' }, 400); }
      if (!passwordOk(c, b && b.password)) { noteFail(ip); await new Promise(r => setTimeout(r, 900)); return reply({ error: 'Incorrect access password.' }, 401); }
      clearFails(ip);
      return reply({ authed: true }, 200, { 'Set-Cookie': makeCookie(c) });
    }
    if (action === 'logout' && req.method === 'POST') return reply({ authed: false }, 200, { 'Set-Cookie': clearCookie() });
    if (!isAuthed(c, req)) return reply({ error: 'Sign in required.', authRequired: true }, 401);

    // ---- reads ---------------------------------------------------------
    if (req.method === 'GET') {
      if (action === 'overview') return reply(await rpc('admin_overview', {}, c));

      if (action === 'records' || action === 'export') {
        const site = q.get('site'), view = q.get('view') || 'applications';
        const page = Number(q.get('page') || 0), band = q.get('band') ? Number(q.get('band')) : null;
        const from = q.get('from') || null, to = q.get('to') || null;
        if (!SITES.includes(site) || !VIEWS.includes(view) || !Number.isInteger(page) || page < 0 || page > 100000 ||
            (band !== null && (!Number.isInteger(band) || band < 1 || band > 5)) || (from && !day(from)) || (to && !day(to)))
          return reply({ error: 'Invalid filters.' }, 400);
        const args = {
          p_site: site, p_view: view, p_page: action === 'export' ? 0 : page, p_search: (q.get('search') || '').slice(0, 100),
          p_status: (q.get('status') || '').slice(0, 30), p_band: band,
          p_from: from ? from + 'T00:00:00+03:00' : null,
          p_to: to ? new Date(new Date(to + 'T00:00:00+03:00').getTime() + 86400000).toISOString() : null,
          p_size: action === 'export' ? 20000 : 25
        };
        const out = await rpc('admin_records', args, c);
        if (action === 'records') return reply(out);
        const rows = out.rows || [];
        const cols = rows.length ? Object.keys(rows[0]).filter(k => !['id', 'payment_id', 'application_id'].includes(k)) : [];
        const csv = '\ufeff' + [cols.join(','), ...rows.map(r => cols.map(k => csvCell(r[k])).join(','))].join('\r\n');
        return new Response(csv, { status: 200, headers: { ...hdr, 'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${site}-${view}-${new Date().toISOString().slice(0, 10)}.csv"` } });
      }
      if (action === 'application') {
        const id = q.get('id') || '';
        if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: 'Invalid id.' }, 400);
        try { return reply(await rpc('admin_application', { p_id: id }, c)); }
        catch (e) { if (/not found/i.test(e.detail || '')) return reply({ error: 'Application not found.' }, 404); throw e; }
      }
      return reply({ error: 'Not found.' }, 404);
    }

    // ---- writes --------------------------------------------------------
    if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    const text = await req.text();
    if (text.length > 8192) return reply({ error: 'Request too large.' }, 413);
    let b; try { b = JSON.parse(text); } catch { return reply({ error: 'Invalid request.' }, 400); }

    if (action === 'review') {
      const amt = b && b.amount_received;
      if (!b || !/^[0-9a-f-]{36}$/i.test(b.payment_id || '') ||
          !['pending', 'verified', 'rejected'].includes(b.expected_status) ||
          !['pending', 'verified', 'rejected'].includes(b.new_status) ||
          typeof b.note !== 'string' || b.note.length > 500 ||
          (amt != null && (!Number.isInteger(amt) || amt < 0 || amt > 1000000)))
        return reply({ error: 'Invalid review details.' }, 400);
      try {
        return reply(await rpc('admin_review_payment', {
          p_payment_id: b.payment_id, p_expected_status: b.expected_status, p_new_status: b.new_status,
          p_note: b.note, p_amount_received: amt ?? null }, c));
      } catch (e) {
        if (/Another session|Provide a reason|Invalid amount|Payment not found/.test(e.detail || '')) return reply({ error: e.detail }, 409);
        throw e;
      }
    }
    return reply({ error: 'Not found.' }, 404);
  } catch (e) {
    console.error('operations_error', e.message, e.detail || '');
    if (e.message === 'SETUP_REQUIRED') return reply({ error: 'Not connected. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PUBLIC_URL in the control-room project, then redeploy. No records were loaded.' }, 503);
    if (e.message === 'PASSWORD_REQUIRED') return reply({ error: 'Set ADMIN_PASSWORD in the control-room project settings, then redeploy.' }, 503);
    return reply({ error: 'The database could not be reached. Check that schema.sql was run and the keys are correct.' }, 503);
  }
}
export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
