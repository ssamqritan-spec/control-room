'use strict';
/* Bursary Control Room - front end. All data comes from /api/operations (server holds the DB key).
   Nothing here is placeholder data: an empty database shows zeros and "no records yet". */

const SITES = { elimu: { name: 'Elimu Kenya', short: 'ELIMU KENYA' }, kmtc: { name: 'KMTC Bursary', short: 'KMTC BURSARY' } };
const APP_STATUS = { pending_payment: 'Awaiting payment', payment_submitted: 'Payment submitted', verified: 'Verified', payment_rejected: 'Payment rejected' };
const PAY_STATUS = { pending: 'To verify', verified: 'Verified', rejected: 'Rejected' };
const EVENTS = { application_completed: 'Application completed', payment_submitted: 'Payment submitted', payment_verified: 'Payment verified', payment_rejected: 'Payment rejected', payment_pending: 'Payment reset to “to verify”' };
const PAGE = 25, POLL_MS = 10000;

const $ = s => document.querySelector(s);
const money = n => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
const when = v => v ? new Date(v).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
const shortDay = v => new Date(v + 'T00:00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

function el(tag, text, cls, attrs) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
function badge(kind, label) { return el('span', label, 'badge b-' + kind); }

/* ---------------- API ---------------- */
async function api(action, { method = 'GET', body, params = {} } = {}) {
  if (location.protocol === 'file:') throw Error('Deploy this folder to Vercel (or run npm run dev). Opening the HTML file directly cannot reach the database.');
  const r = await fetch('/api/operations?' + new URLSearchParams({ action, ...params }), {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let d; try { d = await r.json(); } catch { throw Error('The control-room server is unavailable. No records were loaded.'); }
  if (r.status === 401 && d.authRequired) { showGate(); throw Error('Sign in required.'); }
  if (!r.ok) throw Object.assign(Error(d.error || 'Request failed.'), { status: r.status });
  return d;
}

/* ---------------- state ---------------- */
const st = { site: 'all', view: 'overview', page: 0, total: 0, rows: [], overview: null, loadId: 0, timer: null, open: null };

/* ---------------- gate ---------------- */
function showGate() { $('#app').hidden = true; $('#gate').hidden = false; clearInterval(st.timer); $('#gatePassword').focus(); }
$('#gateForm').onsubmit = async e => {
  e.preventDefault(); $('#gateError').textContent = '';
  try { await api('login', { method: 'POST', body: { password: $('#gatePassword').value } }); $('#gatePassword').value = ''; start(); }
  catch (x) { $('#gateError').textContent = x.message; }
};
$('#logout').onclick = async () => { try { await api('logout', { method: 'POST', body: {} }); } catch {} location.reload(); };

/* ---------------- navigation ---------------- */
document.querySelectorAll('.nav').forEach(b => b.onclick = () => go(b.dataset.site, b.dataset.view));
function go(site, view) {
  st.site = site; st.view = view; st.page = 0; closeDrawer();
  ['search', 'status', 'band', 'from', 'to'].forEach(id => $('#' + id).value = '');
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.site === site && n.dataset.view === view));
  const crumb = $('#crumb'); crumb.className = 'crumb ' + (site === 'all' ? '' : site);
  crumb.textContent = site === 'all' ? 'ALL WEBSITES · SEPARATED BY SITE' : SITES[site].short;
  $('#title').textContent = { overview: 'Overview', applications: 'Applications', payments: 'Payments', activity: 'Activity log' }[view];
  $('#overview').hidden = view !== 'overview'; $('#records').hidden = view === 'overview';
  if (view !== 'overview') setupFilters();
  location.hash = site + '/' + view;
  load();
}
function setupFilters() {
  const s = $('#status'); s.replaceChildren(el('option', 'All statuses', null, { value: '' }));
  const set = st.view === 'payments' ? PAY_STATUS : APP_STATUS;
  if (st.view !== 'activity') for (const k in set) s.append(el('option', set[k], null, { value: k }));
  $('#statusWrap').hidden = st.view === 'activity'; $('#bandWrap').hidden = st.view === 'activity';
  $('#search').placeholder = st.view === 'activity' ? 'Event, reference or name' : 'Name, phone, email, reference or M-Pesa code';
}
let searchT;
$('#search').oninput = () => { clearTimeout(searchT); searchT = setTimeout(() => { st.page = 0; load(); }, 350); };
['status', 'band', 'from', 'to'].forEach(id => $('#' + id).onchange = () => { st.page = 0; load(); });
$('#prev').onclick = () => { if (st.page > 0) { st.page--; load(); } };
$('#next').onclick = () => { if ((st.page + 1) * PAGE < st.total) { st.page++; load(); } };
$('#refresh').onclick = () => load();
$('#export').onclick = () => { window.location.href = '/api/operations?' + new URLSearchParams({ action: 'export', ...filterParams() }); };

function filterParams() {
  const p = { site: st.site, view: st.view };
  for (const id of ['search', 'status', 'band', 'from', 'to']) if ($('#' + id).value) p[id] = $('#' + id).value;
  return p;
}

/* ---------------- loading ---------------- */
function notice(msg) { const n = $('#notice'); n.textContent = msg || ''; n.hidden = !msg; }
function conn(ok, text) { $('#connDot').className = 'pulse ' + (ok ? 'on' : 'off'); $('#connText').textContent = text; }

async function load() {
  const id = ++st.loadId;
  try {
    const ov = await api('overview');
    if (id !== st.loadId) return;
    st.overview = ov; updateCounts();
    if (st.view === 'overview') renderOverview();
    else {
      const d = await api('records', { params: { ...filterParams(), page: st.page } });
      if (id !== st.loadId) return;
      st.rows = d.rows; st.total = Number(d.total); renderTable();
    }
    notice(''); conn(true, 'Live · database connected');
    $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour12: false });
  } catch (e) {
    if (e.message === 'Sign in required.') return;
    notice(e.message); conn(false, 'Not connected');
  }
}
function updateCounts() {
  document.querySelectorAll('[data-count]').forEach(b => {
    const [s, k] = b.dataset.count.split('.'); const v = st.overview && st.overview[s] ? Number(st.overview[s][k]) : 0;
    b.textContent = v ? String(v) : '';
  });
}
function poll() { clearInterval(st.timer); st.timer = setInterval(() => { if (!document.hidden && !$('#app').hidden && !st.open) load(); }, POLL_MS); }

/* ---------------- overview ---------------- */
function tile(label, value, sub) { const t = el('div', null, 'tile'); t.append(el('span', label), el('strong', value), el('small', sub)); return t; }
function renderOverview() {
  const o = st.overview, E = o.elimu, K = o.kmtc, n = k => Number(E[k]) + Number(K[k]);
  const totals = $('#totals'); totals.replaceChildren(
    tile('Applications (both sites)', String(n('applications')), 'Elimu ' + E.applications + ' · KMTC ' + K.applications),
    tile('Payments to verify', String(n('payment_submitted')), 'Waiting for your M-Pesa check'),
    tile('Verified applicants', String(n('verified')), 'Elimu ' + E.verified + ' · KMTC ' + K.verified),
    tile('Fees received (verified)', money(n('fees_received')), 'Elimu ' + money(E.fees_received) + ' · KMTC ' + money(K.fees_received)));
  $('#siteCards').replaceChildren(siteCard('elimu', E), siteCard('kmtc', K));
}
function kpi(label, v, cls) { const d = el('div', null, 'kpi ' + (cls || '')); d.append(el('span', label), el('b', String(v))); return d; }
function mrow(label, v, cls) { const d = el('div', null, cls || ''); d.append(el('span', label), el('b', v)); return d; }
function siteCard(key, d) {
  const c = el('article', null, 'site ' + key);
  const head = el('div', null, 'site-head'); head.append(el('h2', SITES[key].name));
  const open = el('button', 'Open applications →', 'secondary'); open.onclick = () => go(key, 'applications'); head.append(open);
  const kp = el('div', null, 'kpis');
  kp.append(kpi('Applications', d.applications), kpi('Awaiting payment', d.awaiting_payment), kpi('To verify', d.payment_submitted, d.payment_submitted > 0 ? 'warn' : ''), kpi('Verified', d.verified));
  const m = el('div', null, 'money');
  m.append(
    mrow('Bursary to receive · all applicants', money(d.to_receive_all)),
    mrow('Bursary to receive · applicants who paid', money(d.to_receive_paid)),
    mrow('Fees awaiting verification', money(d.fees_pending)),
    mrow('Fees received · verified', money(d.fees_received), 'big'));
  const ch = el('div', null, 'chart');
  const days = d.daily || [], max = Math.max(1, ...days.map(x => x.applications));
  ch.append(el('h3', 'Last 14 days · today: ' + d.today_applications + ' applications, ' + d.today_payments + ' payments'));
  const bars = el('div', null, 'bars');
  days.forEach(x => {
    const col = el('div'); col.title = shortDay(x.d) + ': ' + x.applications + ' applications, ' + x.payments + ' payments';
    const a = el('i'); a.style.height = (x.applications / max * 100) + '%';
    const p = el('i', null, 'p'); p.style.height = (x.payments / max * 100) + '%';
    col.append(a, p); bars.append(col);
  });
  const xs = el('div', null, 'bars-x'); if (days.length) xs.append(el('span', shortDay(days[0].d)), el('span', shortDay(days[days.length - 1].d)));
  const lg = el('div', null, 'legend'); lg.innerHTML = '<span><i style="background:var(--cbg)"></i>Applications</span><span><i style="background:var(--c)"></i>Payments</span>';
  ch.append(bars, xs, lg);
  const bd = el('div', null, 'chart'); bd.append(el('h3', 'Applications by band'));
  const br = el('div', null, 'bandrow'); const bands = d.bands || {};
  if (!Object.keys(bands).length) br.append(el('span', 'No applications yet'));
  [1, 2, 3, 4, 5].forEach(b => { if (bands[b]) { const s = el('span', 'Band ' + b + ' · '); s.append(el('b', String(bands[b]))); br.append(s); } });
  bd.append(br);
  c.append(head, kp, m, ch, bd); return c;
}

/* ---------------- table ---------------- */
const COLS = {
  applications: [
    ['Completed', r => when(r.created_at)], ['Applicant', r => stack(r.student || '—', [r.phone, r.ref].filter(Boolean).join(' · '), 'name')],
    ['Studies', r => stack(r.institution, [r.course, r.year].filter(Boolean).join(' · '))],
    ['To receive', r => stack(money(r.amount), 'Band ' + r.band), 'num'], ['Fee due', r => money(r.fee), 'num'],
    ['Payment made', r => r.paid_at ? stack(when(r.paid_at), r.mpesa_code) : '—'],
    ['Fee received', r => Number(r.fee_received) ? money(r.fee_received) : '—', 'num'], ['Status', r => badge(r.status, APP_STATUS[r.status] || r.status)]
  ],
  payments: [
    ['Payment made', r => stack(when(r.paid_at), 'M-Pesa ' + r.mpesa_code)], ['Applicant', r => stack(r.student || '—', [r.phone, r.ref].filter(Boolean).join(' · '), 'name')],
    ['Application completed', r => when(r.applied_at)],
    ['Fee due', r => money(r.amount_reported), 'num'], ['Fee received', r => r.amount_received != null ? money(r.amount_received) : '—', 'num'],
    ['To receive', r => stack(money(r.amount), 'Band ' + r.band), 'num'], ['Status', r => badge(r.payment_status, PAY_STATUS[r.payment_status])]
  ],
  activity: [
    ['Time', r => when(r.created_at)], ['Event', r => EVENTS[r.event] || r.event], ['Applicant', r => r.student || '—'], ['Reference', r => r.ref || '—'], ['Detail', r => detail(r.detail)]
  ]
};
function stack(a, b, cls) { const s = el('span', null, cls); s.append(el('b', a || '—'), el('span', b || '', 'sub')); return s; }
function detail(d) {
  if (!d) return '';
  const p = [];
  if (d.mpesa_code) p.push(d.mpesa_code);
  if (d.amount_received != null) p.push('received ' + money(d.amount_received));
  else if (d.fee != null) p.push('fee ' + money(d.fee));
  if (d.amount != null) p.push('to receive ' + money(d.amount));
  if (d.note) p.push('“' + d.note + '”');
  return p.join(' · ');
}
function renderTable() {
  const cols = COLS[st.view], thead = $('#table thead'), tbody = $('#table tbody');
  const hr = el('tr'); cols.forEach(c => hr.append(el('th', c[0], c[2]))); thead.replaceChildren(hr);
  tbody.replaceChildren();
  st.rows.forEach(r => {
    const tr = el('tr');
    cols.forEach(c => { const td = el('td', null, c[2]); const v = c[1](r); v instanceof Node ? td.append(v) : (td.textContent = v); tr.append(td); });
    const id = r.application_id || r.id; if (st.view === 'activity' && !r.application_id) tr.style.cursor = 'default'; else tr.onclick = () => openDrawer(id);
    tbody.append(tr);
  });
  const filtered = ['search', 'status', 'band', 'from', 'to'].some(i => $('#' + i).value);
  const empty = $('#empty'); empty.hidden = st.rows.length > 0; empty.replaceChildren();
  if (!st.rows.length) {
    empty.append(el('b', filtered ? 'No records match these filters' : 'No records yet'),
      el('span', filtered ? 'Clear a filter to see more.' : 'Records from ' + SITES[st.site].name + ' will appear here the moment a student completes the ' + (st.view === 'payments' ? 'payment step.' : 'application.')));
  }
  $('#table').hidden = !st.rows.length;
  const a = st.total ? st.page * PAGE + 1 : 0, b = Math.min((st.page + 1) * PAGE, st.total);
  $('#range').textContent = st.total ? `Showing ${a}–${b} of ${st.total}` : '0 records';
  $('#prev').disabled = st.page === 0; $('#next').disabled = (st.page + 1) * PAGE >= st.total;
  $('#export').disabled = !st.total;
}

/* ---------------- detail drawer ---------------- */
function closeDrawer() { st.open = null; $('#drawer').hidden = true; $('#scrim').hidden = true; }
$('#dClose').onclick = closeDrawer; $('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

async function openDrawer(id) {
  st.open = id;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  $('#dBody').replaceChildren(el('p', 'Loading…', 'muted'));
  try { renderDrawer(await api('application', { params: { id } })); }
  catch (e) { $('#dBody').replaceChildren(el('p', e.message, 'form-error')); }
}
function kv(pairs) {
  const dl = el('dl', null, 'kv');
  pairs.forEach(([k, v]) => { if (v == null || v === '') return; dl.append(el('dt', k), el('dd', String(v))); });
  return dl;
}
function section(title, ...kids) { const s = el('section', null, 'sec'); s.append(el('h3', title), ...kids); return s; }

function renderDrawer(d) {
  const a = d.application, body = $('#dBody');
  const chip = $('#dSite'); chip.textContent = SITES[a.site].short; chip.className = 'site-chip ' + a.site;
  $('#dName').textContent = a.student || '—'; $('#dRef').textContent = a.ref;

  const mb = el('div', null, 'moneybox');
  const received = d.payments.filter(p => p.status === 'verified').reduce((s, p) => s + (p.amount_received || 0), 0);
  [['To receive', money(a.amount)], ['Fee due', money(a.fee)], ['Fee received (verified)', money(received)]].forEach(([k, v]) => { const x = el('div'); x.append(el('span', k), el('b', v)); mb.append(x); });
  const status = el('p', null); status.append(badge(a.status, APP_STATUS[a.status] || a.status), el('span', '  Application completed ' + when(a.created_at), 'muted small'));

  const pays = d.payments.length ? d.payments.map(payCard) : [el('p', 'This applicant has not submitted a payment yet.', 'muted')];

  const studies = SITES[a.site] && a.site === 'kmtc'
    ? [['KMTC campus', a.institution], ['Programme', a.course], ['Programme level', a.level], ['Year', a.year], ['Admission no.', a.adm_no], ['Other support', a.other_support]]
    : [['Institution type', a.inst_type], ['Institution', a.institution], ['Course', a.course], ['Year', a.year], ['HELB / HEF support', a.helb]];

  const tl = el('ol', null, 'timeline');
  if (!d.events.length) tl.append(el('li', 'No events recorded.'));
  d.events.forEach(e => { const li = el('li', EVENTS[e.event] || e.event, 'ev-' + e.event); li.append(el('small', when(e.created_at) + (detail(e.detail) ? ' · ' + detail(e.detail) : ''))); tl.append(li); });

  body.replaceChildren(
    status, mb,
    section('Payments', ...pays),
    section('Studies', kv(studies)),
    section('Applicant', kv([['Funding band', 'Band ' + a.band], ['Phone', a.phone], ['Email', a.email], ['Birth year', a.birth_year], ['Parent / guardian', a.guardian ? a.guardian + (a.relationship ? ' (' + a.relationship + ')' : '') : ''], ['Circumstances', a.condition]])),
    section('Home location', kv([['County', a.county], ['Sub-county', a.subcounty], ['Town', a.town], ['Location', a.location], ['Sub-location', a.sublocation]])),
    ...(a.story ? [section('Their story', el('div', a.story, 'story'))] : []),
    section('Timeline', tl));
}

function payCard(p) {
  const c = el('div', null, 'pay');
  const top = el('div', null, 'pay-top'); top.append(el('b', p.mpesa_code, 'mono'), badge(p.status, PAY_STATUS[p.status]));
  const meta = kv([['Payment made', when(p.created_at)], ['Paid from phone', p.phone], ['Fee due', money(p.amount_reported)],
    ['Fee received', p.amount_received != null ? money(p.amount_received) : ''], ['Reviewed', p.reviewed_at ? when(p.reviewed_at) : ''], ['Note', p.review_note]]);
  c.append(top, meta);

  const err = el('p', null, 'form-error'); const row = el('div', null, 'row');
  const amt = el('input', null, null, { type: 'number', min: '0', step: '1', inputmode: 'numeric' }); amt.value = p.amount_received != null ? p.amount_received : p.amount_reported;
  const note = el('input', null, null, { type: 'text', maxlength: '500', placeholder: p.status === 'pending' ? 'Note (required to reject)' : 'Note' });
  const l1 = el('label', 'Amount received (KSh)'); l1.append(amt); const l2 = el('label', 'Note'); l2.append(note);
  row.append(l1, l2); c.append(row);

  const act = el('div', null, 'row');
  const mk = (label, cls, next) => {
    const b = el('button', label, cls); b.onclick = async () => {
      err.textContent = ''; b.disabled = true;
      try {
        await api('review', { method: 'POST', body: { payment_id: p.id, expected_status: p.status, new_status: next, note: note.value, ...(next === 'verified' ? { amount_received: Number(amt.value) } : {}) } });
        renderDrawer(await api('application', { params: { id: st.open } })); load();
      } catch (e) { err.textContent = e.message; b.disabled = false; }
    }; return b;
  };
  if (p.status !== 'verified') act.append(mk('✓ Verify payment', 'good', 'verified'));
  if (p.status !== 'rejected') act.append(mk('✕ Reject', 'bad', 'rejected'));
  if (p.status !== 'pending') act.append(mk('Reset to “to verify”', 'secondary', 'pending'));
  c.append(act, err); return c;
}

/* ---------------- boot ---------------- */
async function start() {
  try {
    const s = await api('session');
    if (!s.authed) return showGate();
    $('#gate').hidden = true; $('#app').hidden = false; $('#logout').hidden = !!s.open;
    const [site, view] = (location.hash.slice(1) || 'all/overview').split('/');
    const ok = (site === 'all' && view === 'overview') || (SITES[site] && ['applications', 'payments', 'activity'].includes(view));
    go(ok ? site : 'all', ok ? view : 'overview'); poll();
  } catch (e) {
    $('#gate').hidden = true; $('#app').hidden = false; notice(e.message); conn(false, 'Not connected');
  }
}
start();
