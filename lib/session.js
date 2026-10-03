const crypto = require('crypto');
const { OWNER_EMAIL } = require('./google');

function secret() {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
}

function signature(email) {
  if (!secret()) return '';
  return crypto.createHmac('sha256', secret()).update(email).digest('base64url');
}

function sessionCookie() {
  const value = `${OWNER_EMAIL}.${signature(OWNER_EMAIL)}`;
  return `taskdash_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function isOwnerSession(req) {
  const raw = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('taskdash_session='));
  if (!raw || !secret()) return false;
  const value = decodeURIComponent(raw.slice('taskdash_session='.length));
  const splitAt = value.lastIndexOf('.');
  if (splitAt < 0) return false;
  const email = value.slice(0, splitAt);
  const supplied = value.slice(splitAt + 1);
  const expected = signature(email);
  if (email !== OWNER_EMAIL || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function requireOwnerSession(req, res) {
  if (isOwnerSession(req)) return true;
  res.status(401).json({ error: `Connect Google as ${OWNER_EMAIL} to unlock private dashboard data.` });
  return false;
}

module.exports = { sessionCookie, isOwnerSession, requireOwnerSession };
