/**
 * Autenticacao dos pedidos recebidos da ZSROI (Zone Soft)
 */

const crypto = require('crypto');

const ZSROI_APP_KEY = process.env.ZSROI_APP_KEY;
const ZSROI_APP_SECRET = process.env.ZSROI_APP_SECRET;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const tokens = new Map();

function issueToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  tokens.set(token, Date.now() + TOKEN_TTL_SECONDS * 1000);
  return token;
}

function validateAppCredentials(username, secret) {
  return Boolean(ZSROI_APP_KEY) && Boolean(ZSROI_APP_SECRET) &&
    username === ZSROI_APP_KEY && secret === ZSROI_APP_SECRET;
}

function isValidToken(token) {
  if (!token) return false;
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    tokens.delete(token);
    return false;
  }
  return true;
}

module.exports = { issueToken, validateAppCredentials, isValidToken, TOKEN_TTL_SECONDS };
