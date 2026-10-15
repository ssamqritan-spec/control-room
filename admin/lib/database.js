// Server-side only. The service-role key never reaches the browser.
export function config() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, origin = process.env.PUBLIC_URL;
  if (!url || !key || !origin || url.includes('YOUR_') || key.includes('YOUR_')) throw Error('SETUP_REQUIRED');
  const u = new URL(url), o = new URL(origin);
  const local = process.env.ALLOW_INSECURE_LOCAL === 'true' && o.hostname === 'localhost';
  if (!local && (u.protocol !== 'https:' || o.protocol !== 'https:')) throw Error('SETUP_REQUIRED');
  const password = process.env.ADMIN_PASSWORD || '';
  if (!password && !local) throw Error('PASSWORD_REQUIRED');
  return { url: u.origin, key, origin: o.origin, password, open: !password && local };
}

export async function rpc(name, args, c) {
  const r = await fetch(c.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20000)
  });
  let d;
  try { d = await r.json(); } catch { throw Error('DATABASE_UNAVAILABLE'); }
  if (!r.ok) { const e = Error('DATABASE_UNAVAILABLE'); e.detail = d && d.message; throw e; }
  return d;
}
