const { getPool, ensureWorkspaceSchema, trackUsage } = require('../lib/db');
const { OWNER_EMAIL, getVerifiedGoogleToken } = require('../lib/google');
const { requireOwnerSession } = require('../lib/session');

function mondayOf(date) {
  const day = date.getDay();
  const result = new Date(date);
  result.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  result.setHours(0, 0, 0, 0);
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const weekStart = mondayOf(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    let googleEvents = [];
    let token = null;

    try {
      token = await getVerifiedGoogleToken();
      if (token && String(token.scope || '').includes('calendar.readonly')) {
        const params = new URLSearchParams({
          timeMin: weekStart.toISOString(),
          timeMax: weekEnd.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        });
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
        const data = await response.json();
        if (response.ok) {
          googleEvents = (data.items || []).filter(e => e.start && (e.start.dateTime || e.start.date)).map(e => ({
            id: e.id,
            title: e.summary || '(untitled)',
            start: e.start.dateTime || e.start.date,
            end: e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date,
            allDay: !e.start.dateTime,
            source: 'personal',
          }));
          trackUsage('Google Calendar', 'Load week', 'ok', { calls: 1 });
        }
      }
    } catch (_) {
      token = null;
      trackUsage('Google Calendar', 'Load week', 'error');
    }

    const manualResult = await db.query(
      `select id, title, block_date, start_time, end_time, source from manual_blocks
       where block_date >= $1 and block_date < $2 order by block_date, start_time`,
      [weekStart.toISOString().slice(0, 10), weekEnd.toISOString().slice(0, 10)]
    );
    const manual = manualResult.rows.map(row => {
      const date = row.block_date instanceof Date ? row.block_date.toISOString().slice(0, 10) : String(row.block_date).slice(0, 10);
      return {
        id: `m${row.id}`,
        title: row.title,
        start: `${date}T${row.start_time}:00`,
        end: `${date}T${row.end_time}:00`,
        allDay: false,
        source: row.source,
      };
    });
    return res.status(200).json({
      connected: !!token,
      accountEmail: token ? OWNER_EMAIL : null,
      weekStart: weekStart.toISOString().slice(0, 10),
      events: [...googleEvents, ...manual],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
