// /api/calendar-week — returns this week's events: live from Google Calendar
// (auto-refreshing the token when needed) merged with manually-entered blocks
// (used for calendars that can't be OAuth-connected, e.g. an Adobe work account).

const { Pool } = require('pg');
let pool;
function getPool() {
    if (!pool) {
    if (!process.env.neon) throw new Error('neon env var is not set');
    pool = new Pool({ connectionString: process.env.neon, ssl: { rejectUnauthorized: false } });
}
  return pool;
}

async function refreshAccessToken(db, refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
}),
});
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.error || 'refresh failed');
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await db.query(
    `update oauth_tokens set access_token=$1, expires_at=$2, updated_at=now() where id='google'`,
    [data.access_token, expiresAt]
  );
  return data.access_token;
  }

function mondayOf(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const db = getPool();
  const now = new Date();
  const weekStart = mondayOf(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  let googleEvents = [];
  let connected = false;

  try {
    const tokRes = await db.query(`select * from oauth_tokens where id='google'`);
    if (tokRes.rows.length) {
      connected = true;
      let row = tokRes.rows[0];
      let accessToken = row.access_token;

      if (new Date(row.expires_at) <= new Date(Date.now() + 60000)) {
        if (!row.refresh_token) throw new Error('token expired and no refresh_token stored');
        accessToken = await refreshAccessToken(db, row.refresh_token);
}

      const params = new URLSearchParams({
                timeMin: weekStart.toISOString(),
                timeMax: weekEnd.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '100',
        });
      const evRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
{ headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const evData = await evRes.json();
      if (evRes.ok) {
        googleEvents = (evData.items || [])
                    .filter(e => e.start && (e.start.dateTime || e.start.date))
                    .map(e => ({
                      id: e.id,
                      title: e.summary || '(untitled)',
                      start: e.start.dateTime || e.start.date,
                      end: (e.end && (e.end.dateTime || e.end.date)) || e.start.dateTime || e.start.date,
                      allDay: !e.start.dateTime,
                      source: 'personal',
          }));
      }
      }
      } catch (err) {
            googleEvents = [];
    }

  let manual = [];
  try {
    const mRes = await db.query(
      `select id, title, block_date, start_time, end_time, source from manual_blocks
       where block_date >= $1 and block_date < $2 order by block_date, start_time`,
      [weekStart.toISOString().slice(0, 10), weekEnd.toISOString().slice(0, 10)]
    );
    manual = mRes.rows.map(r => ({
            id: 'm' + r.id,
            title: r.title,
            start: `${r.block_date.toISOString().slice(0, 10)}T${r.start_time}:00`,
            end: `${r.block_date.toISOString().slice(0, 10)}T${r.end_time}:00`,
            allDay: false,
            source: r.source,
      }));
  } catch (err) { /* db not migrated yet */ }

  res.status(200).json({
        connected,
        weekStart: weekStart.toISOString().slice(0, 10),
        events: googleEvents.concat(manual),
    });
  };
