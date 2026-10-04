const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { requireOwnerSession } = require("../lib/session");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    if (req.method === "GET") {
      const result = await db.query(
        `select id, name, event_date, pillar, needs_vendor, expected_attendance, pipeline_state, notes, created_at from events order by event_date asc`,
      );
      trackUsage("Task Dash API", "Load events");
      return res.status(200).json({ events: result.rows });
    }
    if (req.method === "POST") {
      const { name, date, pillar, needsVendor, expectedAttendance, notes } =
        req.body || {};
      if (!name || !date)
        return res
          .status(400)
          .json({ error: "Event name and date are required" });
      const result = await db.query(
        `insert into events (name, event_date, pillar, needs_vendor, expected_attendance, notes)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [
          name,
          date,
          pillar || null,
          !!needsVendor,
          expectedAttendance || null,
          notes || null,
        ],
      );
      trackUsage("Task Dash API", "Create event");
      return res.status(201).json(result.rows[0]);
    }
    if (req.method === "PATCH") {
      const { id } = req.query;
      const { pipelineState, expectedAttendance, notes } = req.body || {};
      if (!id) return res.status(400).json({ error: "Event id is required" });
      const result = await db.query(
        `update events set pipeline_state=coalesce($1::jsonb,pipeline_state), expected_attendance=coalesce($2,expected_attendance), notes=coalesce($3,notes) where id=$4 returning *`,
        [
          pipelineState ? JSON.stringify(pipelineState) : null,
          expectedAttendance || null,
          notes || null,
          id,
        ],
      );
      trackUsage("Task Dash API", "Update event timeline");
      return res.status(200).json(result.rows[0]);
    }
    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Event id is required" });
      await db.query("delete from events where id=$1", [id]);
      trackUsage("Task Dash API", "Delete event");
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    trackUsage("Task Dash API", "Events error", "error");
    return res.status(500).json({ error: err.message });
  }
};
