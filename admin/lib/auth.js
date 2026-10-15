import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
const COOKIE = 'bcr_session', TTL = 8 * 3600; // 8 hours
const sha = s => createHash('sha256').update(s).digest();
const secret = c => sha('bcr:' + c.password + ':' + c.key);
const sign = (c, body) => createHmac('sha256', secret(c)).update(body).digest('base64url');

export function passwordOk(c, given) {
  return timingSafeEqual(sha(String(given || '')), sha(c.password));
}
export function makeCookie(c) {
  const body = 'v1.' + (Math.floor(Date.now() / 1000) + TTL);
  const secure = c.origin.startsWith('https:') ? ' Secure;' : '';
  return `${COOKIE}=${body}.${sign(c, body)}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${TTL}`;
}
export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
export function isAuthed(c, req) {
  if (c.open) return true;
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
  if (!m) return false;
  const v = m.slice(COOKIE.length + 1), i = v.lastIndexOf('.');
  if (i < 0) return false;
  const body = v.slice(0, i), mac = v.slice(i + 1);
  const exp = Number(body.split('.')[1]);
  if (!body.startsWith('v1.') || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(mac), b = Buffer.from(sign(c, body));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Best-effort brute-force brake (per server instance).
const fails = new Map();
export function throttled(ip) { const f = fails.get(ip); return !!f && f.n >= 6 && Date.now() - f.t < 15 * 60e3; }
export function noteFail(ip) { const f = fails.get(ip); fails.set(ip, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() }); }
export function clearFails(ip) { fails.delete(ip); }
