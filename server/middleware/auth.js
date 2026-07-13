/**
 * Autenticação e autorização
 */

const crypto = require('crypto');

const AUTH_USER = process.env.POS_AUTH_USER;
const AUTH_PASS = process.env.POS_AUTH_PASS;
const AUTH_SECRET = process.env.POS_AUTH_SECRET || crypto.randomBytes(32).toString('base64url');

if (!AUTH_USER || !AUTH_PASS) {
  throw new Error('POS_AUTH_USER e POS_AUTH_PASS tem de estar definidos (variaveis de ambiente).');
}
const AUTH_COOKIE = 'pos_auth';
const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const PUBLIC_PATHS = [
  '/login',
  '/login.html',
  '/api/login',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/app.js',
  '/sw.js',
  '/styles.css'
];

function signAuth(expiry) {
  return crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${AUTH_USER}.${expiry}`)
    .digest('base64url');
}

function makeAuthToken() {
  const expiry = Date.now() + AUTH_MAX_AGE_SECONDS * 1000;
  return `${expiry}.${signAuth(expiry)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isAuthenticated(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  if (!token) return false;
  const [expiryText, signature] = String(token).split('.');
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || Date.now() > expiry || !signature) return false;
  const expected = signAuth(expiry);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function authCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE_SECONDS}${secure}`;
}

function clearAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isPublicPath(url) {
  return PUBLIC_PATHS.includes(url.pathname);
}

function requireAuth(req, res, url) {
  if (isAuthenticated(req) || isPublicPath(url)) {
    return true;
  }

  if (url.pathname.startsWith('/api/')) {
    return { ok: false, status: 401, error: 'Login necessario.' };
  }

  const next = encodeURIComponent(url.pathname + url.search);
  return { ok: false, redirect: `/login?next=${next}` };
}

function validateCredentials(username, password) {
  return username === AUTH_USER && password === AUTH_PASS;
}

module.exports = {
  AUTH_COOKIE,
  isAuthenticated,
  requireAuth,
  authCookie,
  clearAuthCookie,
  makeAuthToken,
  validateCredentials,
  PUBLIC_PATHS
};