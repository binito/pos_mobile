const test = require('node:test');
const assert = require('node:assert/strict');

process.env.POS_AUTH_USER = process.env.POS_AUTH_USER || 'testuser';
process.env.POS_AUTH_PASS = process.env.POS_AUTH_PASS || 'testpass';

const auth = require('../server/middleware/auth');

test('validateCredentials accepts correct user/pass', () => {
  assert.equal(auth.validateCredentials('testuser', 'testpass'), true);
});

test('validateCredentials rejects wrong password', () => {
  assert.equal(auth.validateCredentials('testuser', 'wrong'), false);
});

test('isAuthenticated is false without cookie', () => {
  assert.equal(auth.isAuthenticated({ headers: {} }), false);
});

test('a token minted by makeAuthToken authenticates', () => {
  const token = auth.makeAuthToken();
  const req = { headers: { cookie: `${auth.AUTH_COOKIE}=${encodeURIComponent(token)}` } };
  assert.equal(auth.isAuthenticated(req), true);
});

test('requireAuth allows public paths without auth', () => {
  const req = { headers: {} };
  const url = { pathname: '/login.html', search: '' };
  assert.equal(auth.requireAuth(req, {}, url), true);
});

test('requireAuth blocks api paths with 401 when unauthenticated', () => {
  const req = { headers: {} };
  const url = { pathname: '/api/orders', search: '' };
  const result = auth.requireAuth(req, {}, url);
  assert.equal(result.status, 401);
});

test('requireAuth redirects html paths to login when unauthenticated', () => {
  const req = { headers: {} };
  const url = { pathname: '/orders', search: '' };
  const result = auth.requireAuth(req, {}, url);
  assert.match(result.redirect, /^\/login\?next=/);
});
