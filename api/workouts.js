// /api/workouts — live training session logs. A log is one program day for
// one client: every set's weight and reps, saved as the session goes.
// Finishing a log also records the session on the client's history.

const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { requireOwnerSession } = require("../lib/session");

const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const int = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// Keeps the logged sets to a known shape and size.
function cleanEntries(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 60).map((e) => ({
    key: clean(e?.key, 20),
    name: clean(e?.name, 120),
    target: clean(e?.target, 60),
    note: clean(e?.note, 300),
    coachNote: clean(e?.coachNote, 300),
    sets: (Array.isArray(e?.sets) ? e.sets : []).slice(0, 12).map((s) => ({
      weight: clean(s?.weight, 20),
      reps: clean(s?.reps, 20),
      done: !!s?.done,
    })),
  }));
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const id = Number(req.query.id);

    if (req.method === "GET") {
      const clientId = Number(req.query.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0)
        return res.status(400).json({ error: "clientId is required" });
      const result = await db.query(
        "select * from workout_logs where client_id=$1 order by started_at desc limit 60",
        [clientId],
      );
      return res.status(200).json({ workouts: result.rows });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const clientId = Number(body.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0)
        return res.status(400).json({ error: "Choose a client" });
      const found = await db.query("select id from clients where id=$1", [
        clientId,
      ]);
      if (!found.rows[0])
        return res.status(404).json({ error: "Client not found" });
      const programId = Number(body.programId);
      const result = await db.query(
        `insert into workout_logs (client_id, program_id, program_name, day_index, day_name, week_index, entries)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
        [
          clientId,
          Number.isInteger(programId) && programId > 0 ? programId : null,
          clean(body.programName, 120) || null,
          int(body.dayIndex, 0, 6, 0),
          clean(body.dayName, 60) || null,
          int(body.weekIndex, 0, 7, 0),
          JSON.stringify(cleanEntries(body.entries)),
        ],
      );
      trackUsage("Task Dash API", "Start training session");
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === "PATCH") {
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Workout id is required" });
      const body = req.body || {};
      const saved = await db.query(
        `update workout_logs set entries=$2::jsonb, notes=$3, updated_at=now()
         where id=$1 returning *`,
        [id, JSON.stringify(cleanEntries(body.entries)), clean(body.notes, 2000) || null],
      );
      const log = saved.rows[0];
      if (!log) return res.status(404).json({ error: "Workout not found" });
      if (!body.finish || log.status === "finished")
        return res.status(200).json(log);

      // Finishing adds the session to the client's history (once).
      const minutes = Math.max(
        1,
        Math.min(240, Math.round((Date.now() - new Date(log.started_at)) / 60000)),
      );
      const day = /^\d{4}-\d{2}-\d{2}$/.test(body.dayKey || "")
        ? body.dayKey
        : new Date().toISOString().slice(0, 10);
      const done = cleanEntries(body.entries).filter((e) =>
        e.sets.some((s) => s.done || s.weight || s.reps),
      ).length;
      const session = await db.query(
        `insert into client_sessions (client_id, session_type, session_date, duration_minutes, notes)
         values ($1,'Personal training',$2,$3,$4) returning id`,
        [
          log.client_id,
          day,
          minutes,
          `${log.program_name || "Program"} · ${log.day_name || `Day ${log.day_index + 1}`} · Week ${log.week_index + 1} · ${done} exercise${done === 1 ? "" : "s"} logged${log.notes ? `\n${log.notes}` : ""}`,
        ],
      );
      const finished = await db.query(
        `update workout_logs set status='finished', finished_at=now(), session_id=$2
         where id=$1 returning *`,
        [id, session.rows[0].id],
      );
      trackUsage("Task Dash API", "Finish training session");
      return res.status(200).json(finished.rows[0]);
    }

    if (req.method === "DELETE") {
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Workout id is required" });
      await db.query("delete from workout_logs where id=$1", [id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
