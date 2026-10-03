const { getPool } = require('./db');

const OWNER_EMAIL = 'willfarparan@gmail.com';
const WORK_EMAIL = 'william.farparan@teamexos.com';

async function getVerifiedGoogleToken(kind = 'owner') {
  const id = kind === 'work' ? 'google-work' : 'google';
  const expectedEmail = kind === 'work' ? WORK_EMAIL : OWNER_EMAIL;
  const db = getPool();
  const result = await db.query(`select * from oauth_tokens where id=$1`, [id]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if ((row.account_email || '').toLowerCase() !== expectedEmail) return null;

  if (new Date(row.expires_at) > new Date(Date.now() + 60000)) return row;
  if (!row.refresh_token) return null;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google token refresh failed');
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await db.query(`update oauth_tokens set access_token=$1, expires_at=$2, updated_at=now() where id=$3`, [data.access_token, expiresAt, id]);
  return { ...row, access_token: data.access_token, expires_at: expiresAt };
}

module.exports = { OWNER_EMAIL, WORK_EMAIL, getVerifiedGoogleToken };
