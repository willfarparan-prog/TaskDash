const { getVerifiedGoogleToken } = require("./google");
const { trackUsage } = require("./db");

async function createCalendarEvent(booking) {
  const token = await getVerifiedGoogleToken("work");
  if (!token || !String(token.scope || "").includes("calendar.events"))
    return { status: "awaiting_connection", id: null };
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const base =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  // Discover legacy events too: an earlier write may have succeeded before its response was lost.
  const existingResponse = await fetch(
    `${base}?${new URLSearchParams({ privateExtendedProperty: `taskDashBooking=${booking.bookingCode}`, maxResults: "10" })}`,
    { headers, signal: AbortSignal.timeout(10000) },
  );
  const existing = await existingResponse.json();
  if (!existingResponse.ok)
    throw new Error("Calendar sync could not be verified. Retry shortly.");
  const event = (existing.items || []).find(
    (item) =>
      item.status !== "cancelled" &&
      item.extendedProperties?.private?.taskDashBooking === booking.bookingCode,
  );
  if (event) return { status: "synced", id: event.id };
  const id = `td${booking.bookingCode}`;
  const response = await fetch(base, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      id,
      summary: `${booking.reason} - ${booking.visitorName}`,
      description: [
        "Booked through Task Dash",
        `Name: ${booking.visitorName}`,
        booking.visitorEmail ? `Email: ${booking.visitorEmail}` : "",
        `Reason: ${booking.reason}`,
        booking.notes ? `Notes: ${booking.notes}` : "",
        `Booking code: ${booking.bookingCode}`,
      ]
        .filter(Boolean)
        .join("\n"),
      location: booking.location,
      start: { dateTime: booking.startsAt, timeZone: "America/Los_Angeles" },
      end: { dateTime: booking.endsAt, timeZone: "America/Los_Angeles" },
      extendedProperties: { private: { taskDashBooking: booking.bookingCode } },
    }),
  });
  if (response.status === 409) {
    const found = await fetch(`${base}/${id}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    const value = await found.json();
    if (
      found.ok &&
      value.status !== "cancelled" &&
      value.extendedProperties?.private?.taskDashBooking === booking.bookingCode
    )
      return { status: "synced", id: value.id };
    throw new Error("Calendar event could not be reconciled. Retry shortly.");
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error("Calendar event could not be created. Retry shortly.");
  trackUsage("Google Work Calendar", "Create booking event");
  return { status: "synced", id: data.id };
}

async function syncBooking(db, bookingId, location) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(741093, $1)", [
      Number(bookingId) % 2147483647,
    ]);
    const result = await client.query(
      "select * from booking_requests where id=$1 for update",
      [bookingId],
    );
    const row = result.rows[0];
    if (!row || row.status === "cancelled")
      throw new Error("Active booking not found");
    if (row.calendar_sync_status === "synced") {
      await client.query("COMMIT");
      return { status: "synced", id: row.google_event_id };
    }
    let sync;
    try {
      sync = await createCalendarEvent({
        visitorName: row.visitor_name,
        visitorEmail: row.visitor_email,
        reason: row.reason,
        notes: row.notes,
        bookingCode: row.booking_code,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        location,
      });
    } catch (_) {
      sync = { status: "error", id: row.google_event_id || null };
      trackUsage("Google Work Calendar", "Booking sync", "error");
    }
    await client.query(
      "update booking_requests set google_event_id=$1, calendar_sync_status=$2 where id=$3",
      [sync.id, sync.status, row.id],
    );
    await client.query("COMMIT");
    return sync;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { createCalendarEvent, syncBooking };
