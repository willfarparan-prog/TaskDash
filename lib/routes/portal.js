// /api/portal — the client app (client.html). A client never signs in: the
// private link William sends them carries a long random key, and the app
// sends it back in the X-Client-Key header. The key opens that one client's
// programs, workout history and bookings, and nothing else. William can turn
// a link off (or replace it) from the client's profile at any time.

const crypto = require("crypto");
const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { clean, int } = require("../validate");
const { cleanEntries } = require("./workouts");
const Wrapup = require("../../js/wrapup-core");

const KEY_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const COACH = "William Farparan";

function newPortalToken() {
  return crypto.randomBytes(24).toString("base64url"); // 32 characters
}

async function clientForKey(db, key) {
  if (!KEY_PATTERN.test(key)) return null;
  const found = await db.query(
    "select * from clients where portal_token=$1 limit 1",
    [key],
  );
  return found.rows[0] || null;
}

// Only what a client should see about themselves.
function publicClient(c, sessions) {
  const pkg = Wrapup.packageInfo(c, sessions);
  return {
    id: c.id,
    name: c.name,
    firstName: String(c.name || "").split(/\s+/)[0],
    email: c.email || "",
    serviceType: c.service_type || "",
    package: pkg.size ? pkg : null,
    sessionCount: sessions.length,
    lastSession: sessions[0]?.session_date || null,
  };
}

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ""));

async function load(db, c) {
  const [programs, workouts, sessions, bookings] = await Promise.all([
    db.query(
      `select id, name, days_per_week, weeks, status, content, goal, updated_at
         from training_programs
        where client_id=$1 and not is_stock and status <> 'archived'
        order by (status='active') desc, updated_at desc`,
      [c.id],
    ),
    db.query(
      `select id, program_id, program_name, day_index, day_name, week_index, entries, notes, status, source, started_at, finished_at
         from workout_logs where client_id=$1 order by started_at desc limit 300`,
      [c.id],
    ),
    db.query(
      `select id, client_id, session_type, session_date from client_sessions
        where client_id=$1 order by session_date desc, id desc`,
      [c.id],
    ),
    db.query(
      `select booking_code, reason, starts_at, ends_at, status from booking_requests
        where status in ('pending','confirmed') and ends_at > now()
          and (client_id=$1 or ($2::text is not null and lower(visitor_email)=$2))
        order by starts_at limit 20`,
      [c.id, validEmail(c.email) ? String(c.email).toLowerCase() : null],
    ),
  ]);
  return {
    client: publicClient(c, sessions.rows),
    coach: COACH,
    programs: programs.rows,
    workouts: workouts.rows,
    bookings: bookings.rows.map((b) => ({
      code: b.booking_code,
      reason: b.reason,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
    })),
  };
}

async function saveWorkout(req, res, db, c) {
  const body = req.body || {};
  const entries = cleanEntries(body.entries).filter((e) => e.name);
  if (!entries.some((e) => e.sets.some((s) => s.weight || s.reps || s.done)))
    return res
      .status(400)
      .json({ error: "Log at least one set before saving." });
  let programId = Number(body.programId);
  let programName = clean(body.programName, 120) || "Workout";
  if (Number.isInteger(programId) && programId > 0) {
    const owned = await db.query(
      "select id, name from training_programs where id=$1 and client_id=$2",
      [programId, c.id],
    );
    if (!owned.rows[0])
      return res.status(404).json({ error: "That program isn't yours." });
    programName = owned.rows[0].name;
  } else programId = null;
  const requestKey = clean(body.requestKey, 64) || null;
  if (requestKey && !/^[a-zA-Z0-9-]{16,64}$/.test(requestKey))
    return res.status(400).json({ error: "Invalid save request." });
  // Started on this phone up to 12 hours ago; otherwise "now".
  const started = new Date(body.startedAt);
  const startedAt =
    !Number.isNaN(started.getTime()) &&
    started <= new Date() &&
    Date.now() - started < 12 * 3600000
      ? started
      : new Date();
  // A retried save (same request key) returns the log already saved.
  const result = await db.query(
    `insert into workout_logs (client_id, program_id, program_name, day_index, day_name, week_index, entries, notes, status, source, request_key, started_at, finished_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'finished','client',$9,$10,now(),now())
     on conflict (client_id, request_key) do update set request_key=excluded.request_key
     returning id, program_id, program_name, day_index, day_name, week_index, entries, notes, status, source, started_at, finished_at`,
    [
      c.id,
      programId,
      programName,
      int(body.dayIndex, 0, 6, 0),
      clean(body.dayName, 60) || null,
      int(body.weekIndex, 0, 7, 0),
      JSON.stringify(entries),
      clean(body.notes, 2000) || null,
      requestKey,
      startedAt,
    ],
  );
  trackUsage("Client app", "Log workout");
  return res.status(201).json({ workout: result.rows[0] });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  try {
    const method = String(req.method || "GET").toUpperCase();
    const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (method !== "GET" && fetchSite === "cross-site")
      return res
        .status(403)
        .json({ error: "Cross-site changes are not allowed." });
    const key = String(req.headers["x-client-key"] || "");
    if (!KEY_PATTERN.test(key))
      return res.status(401).json({ error: "This link isn't complete." });
    await ensureWorkspaceSchema();
    const db = getPool();
    const c = await clientForKey(db, key);
    if (!c)
      return res.status(401).json({
        error:
          "This link has been turned off or replaced. Ask William for your new link.",
      });
    const resource = String(req.query.resource || req.body?.resource || "me");

    if (method === "GET" && resource === "me") {
      trackUsage("Client app", "Open app");
      return res.status(200).json(await load(db, c));
    }

    if (method === "POST" && resource === "workout")
      return await saveWorkout(req, res, db, c);

    // Clients can delete a workout they logged themselves, never the coach's.
    if (method === "DELETE" && resource === "workout") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Choose a workout." });
      const gone = await db.query(
        "delete from workout_logs where id=$1 and client_id=$2 and source='client' returning id",
        [id, c.id],
      );
      if (!gone.rows[0])
        return res
          .status(404)
          .json({ error: "Only workouts you logged yourself can be deleted." });
      return res.status(200).json({ ok: true });
    }

    if (method === "POST" && resource === "book") {
      const calendar = require("./calendar-manual");
      return await calendar.book(req, res, db, {
        id: c.id,
        name: c.name,
        email: validEmail(c.email) ? c.email : "",
      });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports.newPortalToken = newPortalToken;
module.exports.KEY_PATTERN = KEY_PATTERN;
