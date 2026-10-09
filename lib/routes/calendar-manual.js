const { validDate, validId } = require("../validation");
const crypto = require("crypto");
const { syncBooking } = require("../booking-sync");
const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");
const { WORK_EMAIL, getVerifiedGoogleToken } = require("../google");
const {
  DEFAULT_SCHEDULE,
  normalizeSchedule,
  buildAvailability,
  publicSettings,
  pacificInstant,
} = require("../scheduler");

const json = (res, status, value) => res.status(status).json(value);
const clean = (value, max = 500) =>
  String(value || "")
    .trim()
    .slice(0, max);

async function getSchedule(db) {
  const result = await db.query(
    `select settings, updated_at from booking_settings where id=1`,
  );
  return {
    settings: normalizeSchedule(result.rows[0]?.settings || DEFAULT_SCHEDULE),
    updatedAt: result.rows[0]?.updated_at || null,
  };
}

async function googleBusy(timeMin, timeMax) {
  const token = await getVerifiedGoogleToken("work");
  if (!token || !String(token.scope || "").includes("calendar.events"))
    return { connected: false, busy: [] };
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const busy = [];
  do {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || "Work calendar could not be read");
    for (const event of data.items || []) {
      if (
        event.status === "cancelled" ||
        event.transparency === "transparent" ||
        !event.start
      )
        continue;
      const start =
        event.start.dateTime ||
        (event.start.date &&
          pacificInstant(event.start.date, "00:00").toISOString());
      const end =
        event.end?.dateTime ||
        (event.end?.date &&
          pacificInstant(event.end.date, "00:00").toISOString());
      if (start && end) busy.push({ start, end });
    }
    if (data.nextPageToken) params.set("pageToken", data.nextPageToken);
    else break;
  } while (true);
  trackUsage("Google Work Calendar", "Check booking availability");
  return { connected: true, busy };
}

async function busyIntervals(db, schedule, now = new Date()) {
  const from = new Date(now.getTime() - 86400000);
  const to = new Date(now.getTime() + (schedule.bookAheadDays + 2) * 86400000);
  const local = await db.query(
    `select starts_at start, ends_at "end" from booking_requests where status in ('pending','confirmed') and ends_at > $1 and starts_at < $2`,
    [from, to],
  );
  const blocks = await db.query(
    `select block_date, start_time, end_time from manual_blocks where block_date >= $1 and block_date <= $2`,
    [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );
  const manual = blocks.rows.map((row) => {
    const date =
      row.block_date instanceof Date
        ? row.block_date.toISOString().slice(0, 10)
        : String(row.block_date).slice(0, 10);
    return {
      start: pacificInstant(date, row.start_time.slice(0, 5)),
      end: pacificInstant(date, row.end_time.slice(0, 5)),
    };
  });
  const localBusy = [...local.rows, ...manual];
  try {
    const google = await googleBusy(from, to);
    return {
      connected: google.connected,
      busy: [...localBusy, ...google.busy],
    };
  } catch (err) {
    trackUsage("Google Work Calendar", "Check booking availability", "error");
    throw new Error(
      "Work calendar availability could not be verified. Please try again shortly.",
    );
  }
}

async function publicAvailability(db) {
  const { settings } = await getSchedule(db);
  const source = await busyIntervals(db, settings);
  return {
    settings: publicSettings(settings),
    days:
      settings.requireCalendar && !source.connected
        ? []
        : buildAvailability(settings, source.busy),
    paused: settings.requireCalendar && !source.connected,
    calendarConnected: source.connected,
  };
}

async function book(req, res, db) {
  const body = req.body || {};
  if (body.website) return json(res, 201, { ok: true });
  const visitorName = clean(body.name, 80);
  const visitorEmail = clean(body.email, 160).toLowerCase();
  const reason = clean(body.reason, 120);
  const notes = clean(body.notes, 1000);
  const requested = new Date(body.startsAt);
  if (visitorName.length < 2 || !reason || Number.isNaN(requested.getTime()))
    return json(res, 400, {
      error:
        "Choose a listed time and enter your name and reason for visiting.",
    });
  if (visitorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitorEmail))
    return json(res, 400, {
      error: "Enter a valid email address or leave it blank.",
    });

  // Durable per-IP buckets work across serverless instances; identifiers are hashed.
  const forwarded = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
  )
    .split(",")[0]
    .trim();
  const key = crypto
    .createHmac("sha256", process.env.DASHBOARD_SESSION_SECRET || "taskdash")
    .update(forwarded)
    .digest("hex");
  const rate = await db.query(
    `with pruned as (delete from booking_rate_limits where bucket < now() - interval '2 days') insert into booking_rate_limits (key, bucket, requests) values ($1,date_trunc('hour',now()),1) on conflict (key,bucket) do update set requests=booking_rate_limits.requests+1 returning requests`,
    [key],
  );
  if (Number(rate.rows[0]?.requests) > 12) {
    res.setHeader("Retry-After", "3600");
    return json(res, 429, {
      error: "Too many booking attempts. Please try again later.",
    });
  }
  const availability = await publicAvailability(db);
  if (availability.paused)
    return json(res, 503, {
      error:
        "Booking is temporarily paused while the work calendar reconnects. Please check back shortly.",
    });
  if (!availability.settings.reasons.includes(reason))
    return json(res, 400, { error: "Choose a reason from the booking form." });
  const slot = availability.days
    .flatMap((day) => day.slots)
    .find((item) => item.startsAt === requested.toISOString());
  if (!slot?.open)
    return json(res, 409, {
      error: "That time is no longer available. Please choose another.",
    });
  const bookingCode = crypto.randomBytes(8).toString("hex");
  let row;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize booking inserts so different start times cannot overlap.
    await client.query("SELECT pg_advisory_xact_lock(741092)");
    const conflict = await client.query(
      `select id from booking_requests where status in ('pending','confirmed') and starts_at < $2 and ends_at > $1 limit 1`,
      [slot.startsAt, slot.endsAt],
    );
    if (conflict.rows.length) {
      await client.query("ROLLBACK");
      return json(res, 409, {
        error: "That time was just booked. Please choose another.",
      });
    }
    const result = await client.query(
      `insert into booking_requests (booking_code, visitor_name, visitor_email, reason, notes, starts_at, ends_at, status, calendar_sync_status) values ($1,$2,$3,$4,$5,$6,$7,'confirmed','pending') returning *`,
      [
        bookingCode,
        visitorName,
        visitorEmail || null,
        reason,
        notes || null,
        slot.startsAt,
        slot.endsAt,
      ],
    );
    row = result.rows[0];
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505")
      return json(res, 409, {
        error: "That time was just booked. Please choose another.",
      });
    throw err;
  } finally {
    client.release();
  }

  let sync = { status: "pending", id: null };
  try {
    sync = await syncBooking(db, row.id, availability.settings.location);
  } catch (_) {
    trackUsage("Google Work Calendar", "Booking sync persistence", "error");
  }
  trackUsage("Task Dash Scheduler", "Public booking");
  return json(res, 201, {
    ok: true,
    booking: {
      code: bookingCode,
      name: visitorName,
      reason,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      location: availability.settings.location,
      calendarSynced: sync.status === "synced",
    },
  });
}

async function retryUnsyncedBookings(db) {
  const rows = await db.query(
    "select id from booking_requests where status='confirmed' and calendar_sync_status in ('pending','error','awaiting_connection') and ends_at > now() order by starts_at limit 3",
  );
  const { settings } = await getSchedule(db);
  for (const row of rows.rows) {
    const result = await syncBooking(db, row.id, settings.location);
    if (result.status !== "synced") break;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    const resource = String(
      req.query.resource || req.body?.resource || "block",
    );

    const isPublic =
      (req.method === "GET" && resource === "availability") ||
      (req.method === "POST" && resource === "book");
    if (!isPublic && !requireOwnerSession(req, res)) return;
    await ensureWorkspaceSchema();
    const db = getPool();
    if (req.method === "GET" && resource === "availability")
      return json(res, 200, await publicAvailability(db));
    if (req.method === "POST" && resource === "book")
      return await book(req, res, db);

    if (req.method === "GET" && resource === "scheduler") {
      await retryUnsyncedBookings(db).catch(() => {});
      const [{ settings, updatedAt }, bookings, token] = await Promise.all([
        getSchedule(db),
        db.query(
          `select id, booking_code, visitor_name, visitor_email, reason, notes, starts_at, ends_at, status, calendar_sync_status, created_at from booking_requests where starts_at >= now() - interval '14 days' order by starts_at limit 150`,
        ),
        getVerifiedGoogleToken("work").catch(() => null),
      ]);
      const workConnected =
        !!token && String(token.scope || "").includes("calendar.events");
      return json(res, 200, {
        settings,
        updatedAt,
        bookings: bookings.rows,
        workCalendar: {
          connected: workConnected,
          email: workConnected ? WORK_EMAIL : null,
        },
        publicUrl: "https://task-dash-umber.vercel.app/book.html",
      });
    }

    if (req.method === "POST" && resource === "sync") {
      if (!validId(req.body?.id))
        return json(res, 400, { error: "A valid booking is required" });
      const { settings } = await getSchedule(db);
      const sync = await syncBooking(db, req.body.id, settings.location);
      if (sync.status !== "synced")
        return json(res, 502, {
          error:
            sync.status === "awaiting_connection"
              ? "Connect the work calendar before retrying."
              : "Calendar sync failed. Your booking is still reserved; retry shortly.",
        });
      return json(res, 200, { ok: true });
    }
    if (req.method === "PATCH" && resource === "schedule") {
      const settings = normalizeSchedule(req.body?.settings || {});
      await db.query(
        `insert into booking_settings (id, settings, updated_at) values (1,$1,now()) on conflict (id) do update set settings=excluded.settings, updated_at=now()`,
        [settings],
      );
      trackUsage("Task Dash Scheduler", "Update availability");
      return json(res, 200, { ok: true, settings });
    }

    if (req.method === "POST" && resource === "block") {
      const { title, date, start, end, source } = req.body || {};
      if (
        !String(title || "").trim() ||
        !validDate(date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(start || "") ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(end || "") ||
        start >= end
      )
        return json(res, 400, {
          error: "Enter a title, date, and an end time after the start time",
        });
      const result = await db.query(
        `insert into manual_blocks (title, block_date, start_time, end_time, source) values ($1,$2,$3,$4,$5) returning id, title, block_date, start_time, end_time, source`,
        [title, date, start, end, source || "adobe"],
      );
      return json(res, 201, result.rows[0]);
    }

    if (req.method === "DELETE" && resource === "booking") {
      const id = Number(req.query.id);
      if (!validId(req.query.id))
        return json(res, 400, { error: "booking id required" });
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(741093, $1)", [
          id % 2147483647,
        ]);
        const found = await client.query(
          `select google_event_id, booking_code, status, calendar_sync_status from booking_requests where id=$1 for update`,
          [id],
        );
        if (!found.rows[0]) {
          await client.query("ROLLBACK");
          return json(res, 404, { error: "Booking not found" });
        }
        const booking = found.rows[0];
        if (
          booking.status === "cancelled" &&
          booking.calendar_sync_status !== "cancel_failed"
        ) {
          await client.query("COMMIT");
          return json(res, 200, { ok: true });
        }
        const token = await getVerifiedGoogleToken("work");
        let eventId = booking.google_event_id;
        if (
          !token &&
          !eventId &&
          booking.calendar_sync_status !== "awaiting_connection"
        )
          throw new Error(
            "Reconnect the work calendar to verify cancellation. The booking is still reserved.",
          );
        if (!eventId && token && booking.booking_code) {
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ privateExtendedProperty: `taskDashBooking=${booking.booking_code}` })}`,
            {
              headers: { Authorization: `Bearer ${token.access_token}` },
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!response.ok)
            throw new Error(
              "Calendar cancellation could not be verified. Please retry.",
            );
          const data = await response.json();
          eventId = data.items?.find(
            (event) => event.status !== "cancelled",
          )?.id;
        }
        if (eventId) {
          if (!token)
            throw new Error(
              "Reconnect the work calendar before cancelling this booking.",
            );
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token.access_token}` },
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!response.ok && ![404, 410].includes(response.status)) {
            await client.query("ROLLBACK");
            return json(res, 502, {
              error:
                "Calendar cancellation failed. The booking is still reserved; please retry.",
            });
          }
        }
        await client.query(
          `update booking_requests set status='cancelled', calendar_sync_status='cancelled' where id=$1`,
          [id],
        );
        await client.query("COMMIT");
        return json(res, 200, { ok: true });
      } catch (error) {
        await client.query("ROLLBACK");
        return json(res, 502, {
          error:
            error.message ||
            "Calendar cancellation failed. The booking is still reserved.",
        });
      } finally {
        client.release();
      }
    }

    if (req.method === "DELETE") {
      const id = req.query.id;
      if (!id) return json(res, 400, { error: "id required" });
      await db.query(`delete from manual_blocks where id=$1`, [id]);
      return json(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return json(res, 405, { error: "method not allowed" });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
};
