// /api/auth/callback — Google redirects here with a ?code=. Exchange it for
// tokens and store them in Neon (single row, this is a personal single-user app).
// Never logs or returns the tokens to the browser.

const { Pool } = require('pg');
const OWNER_EMAIL = 'willfarparan@gmail.com';
const { sessionCookie } = require('../../lib/session');
let pool;
function getPool() {
  if (!pool) {
    if (!process.env.neon) throw new Error('neon env var is not set');
    pool = new Pool({ connectionString: process.env.neon, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

module.exports = async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google denied access: ${error}`);
  if (!code) return res.status(400).send('Missing ?code from Google.');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('Google OAuth env vars are not set in this deployment.');
  }

  // Fixed production origin — this app only ever runs at one URL, and trusting
  // request headers here caused a broken redirect_uri (getaddrinfo ENOTFOUND).
  const redirectUri = 'https://task-dash-umber.vercel.app/api/auth/callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).send(`Token exchange failed: ${tokens.error_description || tokens.error}`);
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || !profile.email_verified || String(profile.email).toLowerCase() !== OWNER_EMAIL) {
      return res.status(403).send(`Task Dash only accepts ${OWNER_EMAIL}. No tokens were saved.`);
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    const db = getPool();
    await db.query(`alter table oauth_tokens add column if not exists account_email text`);
    await db.query(
      `insert into oauth_tokens (id, access_token, refresh_token, expires_at, scope, account_email, updated_at)
       values ('google', $1, $2, $3, $4, $5, now())
       on conflict (id) do update set
         access_token = excluded.access_token,
         refresh_token = coalesce(excluded.refresh_token, oauth_tokens.refresh_token),
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         account_email = excluded.account_email,
         updated_at = now()`,
      [tokens.access_token, tokens.refresh_token || null, expiresAt, tokens.scope || null, OWNER_EMAIL]
    );

    // The signed, HTTP-only cookie protects private client, program, and inbox routes.
    res.setHeader('Set-Cookie', sessionCookie());
    res.writeHead(302, { Location: '/?calendar=connected' });
    res.end();
  } catch (err) {
    res.status(500).send(`Callback error: ${err.message}`);
  }
};
