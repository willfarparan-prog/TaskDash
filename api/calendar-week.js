const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const {
  OWNER_EMAIL,
  WORK_EMAIL,
  getVerifiedGoogleToken,
} = require("../lib/google");
const { requireOwnerSession } = require("../lib/session");
const { pacificToday, pacificInstant } = require("../lib/scheduler");

// Weeks run Monday–Sunday in Pacific time, whatever timezone the server uses.
function addDays(key, amount) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function mondayKey(key) {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, day === 0 ? -6 : 1 - day);
}

// Reads one Google account's primary calendar for the week. Never throws:
// a failed account just shows as not connected so the page still loads.
async function loadGoogleWeek(kind, scope, source, weekStart, weekEnd) {
  const label = kind === "work" ? "Load work week" : "Load week";
  try {
    const token = await getVerifiedGoogleToken(kind);
    if (!token || !String(token.scope || "").includes(scope))
      return { connected: false, events: [] };
    const params = new URLSearchParams({
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "read failed");
    trackUsage("Google Calendar", label, "ok", { calls: 1 });
    const events = (data.items || [])
      .filter(
        (e) =>
          e.status !== "cancelled" &&
          e.start &&
          (e.start.dateTime || e.start.date) &&
          // Booking events Task Dash created already show as bookings.
          !e.extendedProperties?.private?.taskDashBooking,
      )
      .map((e) => ({
        id: `${source}-${e.id}`,
        title: e.summary || "(untitled)",
        start: e.start.dateTime || e.start.date,
        end: e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date,
        allDay: !e.start.dateTime,
        source,
      }));
    return { connected: true, events };
  } catch (_) {
    trackUsage("Google Calendar", label, "error");
    return { connected: false, events: [] };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const requested = String(req.query.start || "");
    const startKey = mondayKey(
      /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : pacificToday(),
    );
    const endKey = addDays(startKey, 7);
    const weekStart = pacificInstant(startKey, "00:00");
    const weekEnd = pacificInstant(endKey, "00:00");
    const [personal, work] = await Promise.all([
      loadGoogleWeek("owner", "calendar.readonly", "personal", weekStart, weekEnd),
      loadGoogleWeek("work", "calendar", "exos", weekStart, weekEnd),
    ]);
    const googleEvents = personal.events;
    const workEvents = work.events;
    const token = personal.connected;
    const workToken = work.connected;

    const manualResult = await db.query(
      `select id, title, block_date, start_time, end_time, source from manual_blocks
       where block_date >= $1 and block_date < $2 order by block_date, start_time`,
      [startKey, endKey],
    );
    const manual = manualResult.rows.map((row) => {
      const date =
        row.block_date instanceof Date
          ? row.block_date.toISOString().slice(0, 10)
          : String(row.block_date).slice(0, 10);
      return {
        id: `m${row.id}`,
        title: row.title,
        start: `${date}T${row.start_time}:00`,
        end: `${date}T${row.end_time}:00`,
        allDay: false,
        source: row.source,
      };
    });
    const bookingResult = await db.query(
      `select id, visitor_name, reason, starts_at, ends_at from booking_requests
       where status in ('pending','confirmed') and starts_at >= $1 and starts_at < $2 order by starts_at`,
      [weekStart, weekEnd],
    );
    const bookings = bookingResult.rows.map((row) => ({
      id: `b${row.id}`,
      title: `${row.reason} · ${row.visitor_name}`,
      start: row.starts_at,
      end: row.ends_at,
      allDay: false,
      source: "booking",
    }));
    return res.status(200).json({
      connected: token,
      accountEmail: token ? OWNER_EMAIL : null,
      workConnected: workToken,
      workEmail: workToken ? WORK_EMAIL : null,
      weekStart: startKey,
      events: [...googleEvents, ...workEvents, ...manual, ...bookings],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
