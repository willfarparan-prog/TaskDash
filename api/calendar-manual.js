const crypto = require('crypto');
const { getPool, ensureWorkspaceSchema, trackUsage } = require('../lib/db');
const { requireOwnerSession } = require('../lib/session');
const { WORK_EMAIL, getVerifiedGoogleToken } = require('../lib/google');
const { DEFAULT_SCHEDULE, normalizeSchedule, buildAvailability, publicSettings } = require('../lib/scheduler');

const json = (res, status, value) => res.status(status).json(value);
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);

async function getSchedule(db) {
  const result = await db.query(`select settings, updated_at from booking_settings where id=1`);
  return { settings: normalizeSchedule(result.rows[0]?.settings || DEFAULT_SCHEDULE), updatedAt: result.rows[0]?.updated_at || null };
}

async function googleBusy(timeMin, timeMax) {
  const token = await getVerifiedGoogleToken('work');
  if (!token || !String(token.scope || '').includes('calendar.events')) return { connected: false, busy: [] };
  const params = new URLSearchParams({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Work calendar could not be read');
  trackUsage('Google Work Calendar', 'Check booking availability');
  return { connected: true, busy: (data.items || []).filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent' && event.start && (event.start.dateTime || event.start.date)).map(event => ({ start: event.start.dateTime || `${event.start.date}T00:00:00Z`, end: event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00Z` : event.start.dateTime) })) };
}

async function busyIntervals(db, schedule, now = new Date()) {
  const from = new Date(now.getTime() - 86400000);
  const to = new Date(now.getTime() + (schedule.bookAheadDays + 2) * 86400000);
  const local = await db.query(`select starts_at start, ends_at "end" from booking_requests where status in ('pending','confirmed') and starts_at >= $1 and starts_at < $2`, [from, to]);
  try {
    const google = await googleBusy(from, to);
    return { connected: google.connected, busy: [...local.rows, ...google.busy] };
  } catch (err) {
    trackUsage('Google Work Calendar', 'Check booking availability', 'error');
    return { connected: false, busy: local.rows, warning: err.message };
  }
}

async function publicAvailability(db) {
  const { settings } = await getSchedule(db);
  const source = await busyIntervals(db, settings);
  return { settings: publicSettings(settings), days: buildAvailability(settings, source.busy), calendarConnected: source.connected };
}

async function createCalendarEvent(booking) {
  const token = await getVerifiedGoogleToken('work');
  if (!token || !String(token.scope || '').includes('calendar.events')) return { status: 'awaiting_connection', id: null };
  const description = ['Booked through Task Dash', `Name: ${booking.visitorName}`, booking.visitorEmail ? `Email: ${booking.visitorEmail}` : '', `Reason: ${booking.reason}`, booking.notes ? `Notes: ${booking.notes}` : '', `Booking code: ${booking.bookingCode}`].filter(Boolean).join('\n');
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: `${booking.reason} - ${booking.visitorName}`, description, location: booking.location, start: { dateTime: booking.startsAt, timeZone: 'America/Los_Angeles' }, end: { dateTime: booking.endsAt, timeZone: 'America/Los_Angeles' }, extendedProperties: { private: { taskDashBooking: booking.bookingCode } } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Calendar event could not be created');
  trackUsage('Google Work Calendar', 'Create booking event');
  return { status: 'synced', id: data.id };
}

async function book(req, res, db) {
  const body = req.body || {};
  if (body.website) return json(res, 201, { ok: true });
  const visitorName = clean(body.name, 80);
  const visitorEmail = clean(body.email, 160).toLowerCase();
  const reason = clean(body.reason, 120);
  const notes = clean(body.notes, 1000);
  const requested = new Date(body.startsAt);
  if (visitorName.length < 2 || !reason || Number.isNaN(requested.getTime())) return json(res, 400, { error: 'Choose a listed time and enter your name and reason for visiting.' });
  if (visitorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail)) return json(res, 400, { error: 'Enter a valid email address or leave it blank.' });

  const availability = await publicAvailability(db);
  if (!availability.settings.reasons.includes(reason)) return json(res, 400, { error: 'Choose a reason from the booking form.' });
  const slot = availability.days.flatMap(day => day.slots).find(item => item.startsAt === requested.toISOString());
  if (!slot?.open) return json(res, 409, { error: 'That time is no longer available. Please choose another.' });
  const bookingCode = crypto.randomBytes(8).toString('hex');
  let row;
  try {
    const result = await db.query(`insert into booking_requests (booking_code, visitor_name, visitor_email, reason, notes, starts_at, ends_at, status, calendar_sync_status) values ($1,$2,$3,$4,$5,$6,$7,'confirmed','pending') returning *`, [bookingCode, visitorName, visitorEmail || null, reason, notes || null, slot.startsAt, slot.endsAt]);
    row = result.rows[0];
  } catch (err) {
    if (err.code === '23505') return json(res, 409, { error: 'That time was just booked. Please choose another.' });
    throw err;
  }

  let sync = { status: 'awaiting_connection', id: null };
  try {
    sync = await createCalendarEvent({ visitorName, visitorEmail, reason, notes, bookingCode, startsAt: slot.startsAt, endsAt: slot.endsAt, location: availability.settings.location });
  } catch (_) {
    sync = { status: 'error', id: null };
    trackUsage('Google Work Calendar', 'Create booking event', 'error');
  }
  await db.query(`update booking_requests set google_event_id=$1, calendar_sync_status=$2 where id=$3`, [sync.id, sync.status, row.id]);
  trackUsage('Task Dash Scheduler', 'Public booking');
  return json(res, 201, { ok: true, booking: { code: bookingCode, name: visitorName, reason, startsAt: slot.startsAt, endsAt: slot.endsAt, location: availability.settings.location, calendarSynced: sync.status === 'synced' } });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const resource = String(req.query.resource || req.body?.resource || 'block');

    if (req.method === 'GET' && resource === 'availability') return json(res, 200, await publicAvailability(db));
    if (req.method === 'POST' && resource === 'book') return book(req, res, db);
    if (!requireOwnerSession(req, res)) return;

    if (req.method === 'GET' && resource === 'scheduler') {
      const [{ settings, updatedAt }, bookings, token] = await Promise.all([
        getSchedule(db),
        db.query(`select id, booking_code, visitor_name, visitor_email, reason, notes, starts_at, ends_at, status, calendar_sync_status, created_at from booking_requests where starts_at >= now() - interval '14 days' order by starts_at limit 150`),
        getVerifiedGoogleToken('work').catch(() => null),
      ]);
      const workConnected = !!token && String(token.scope || '').includes('calendar.events');
      return json(res, 200, { settings, updatedAt, bookings: bookings.rows, workCalendar: { connected: workConnected, email: workConnected ? WORK_EMAIL : null }, publicUrl: 'https://task-dash-umber.vercel.app/book.html' });
    }

    if (req.method === 'PATCH' && resource === 'schedule') {
      const settings = normalizeSchedule(req.body?.settings || {});
      await db.query(`insert into booking_settings (id, settings, updated_at) values (1,$1,now()) on conflict (id) do update set settings=excluded.settings, updated_at=now()`, [settings]);
      trackUsage('Task Dash Scheduler', 'Update availability');
      return json(res, 200, { ok: true, settings });
    }

    if (req.method === 'POST' && resource === 'block') {
      const { title, date, start, end, source } = req.body || {};
      if (!title || !date || !start || !end) return json(res, 400, { error: 'title, date, start, end are required' });
      const result = await db.query(`insert into manual_blocks (title, block_date, start_time, end_time, source) values ($1,$2,$3,$4,$5) returning id, title, block_date, start_time, end_time, source`, [title, date, start, end, source || 'adobe']);
      return json(res, 201, result.rows[0]);
    }

    if (req.method === 'DELETE' && resource === 'booking') {
      const id = Number(req.query.id);
      if (!id) return json(res, 400, { error: 'booking id required' });
      const found = await db.query(`select google_event_id from booking_requests where id=$1`, [id]);
      await db.query(`update booking_requests set status='cancelled', calendar_sync_status='cancelled' where id=$1`, [id]);
      const eventId = found.rows[0]?.google_event_id;
      if (eventId) {
        try {
          const token = await getVerifiedGoogleToken('work');
          if (token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.access_token}` } });
        } catch (_) {}
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return json(res, 400, { error: 'id required' });
      await db.query(`delete from manual_blocks where id=$1`, [id]);
      return json(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
};
