const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { requireOwnerSession } = require("../lib/session");
const { DRAFT_KEYS, draftSpec, generateDraft } = require("../lib/eventDrafts");

const EVENT_COLUMNS = `id, name, event_date, pillar, needs_vendor, expected_attendance, pipeline_state, notes,
  start_time, end_time, location, description, equipment, catering_needed, catering_budget,
  menu_ideas, event_link, drafts, created_at`;

const text = (value, max) =>
  String(value || "")
    .trim()
    .slice(0, max) || null;
const time = (value) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? value : null;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    if (req.method === "GET") {
      const result = await db.query(
        `select ${EVENT_COLUMNS} from events order by event_date asc`,
      );
      trackUsage("Task Dash API", "Load events");
      return res.status(200).json({ events: result.rows });
    }

    // Generate one messaging draft with Claude and store it on the event.
    if (req.method === "POST" && req.query.action === "draft") {
      const id = Number(req.query.id);
      const key = String(req.query.key || "");
      if (!Number.isInteger(id) || !DRAFT_KEYS.includes(key))
        return res
          .status(400)
          .json({ error: "Event id and draft type are required" });
      if (!process.env.ANTHROPIC_API_KEY)
        return res.status(503).json({
          error:
            "Claude isn't connected. Add ANTHROPIC_API_KEY in Vercel to draft messages.",
        });
      const found = await db.query(
        `select ${EVENT_COLUMNS} from events where id=$1`,
        [id],
      );
      const event = found.rows[0];
      if (!event) return res.status(404).json({ error: "Event not found" });
      const spec = draftSpec(key);
      if (spec.needs && !spec.needs(event))
        return res
          .status(409)
          .json({ error: "This event doesn't need that message." });
      let generated;
      try {
        generated = await generateDraft(event, key);
      } catch (err) {
        trackUsage("Claude", "Event draft", "error");
        return res
          .status(502)
          .json({ error: err.message || "Claude could not write this draft" });
      }
      const draft = {
        text: generated.text,
        generatedAt: new Date().toISOString(),
        edited: false,
      };
      // `||` merges this key into the latest row, so parallel drafts don't overwrite each other.
      await db.query(
        `update events set drafts = coalesce(drafts, '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb) where id=$3`,
        [key, JSON.stringify(draft), id],
      );
      trackUsage("Claude", "Event draft", "ok", generated.usage);
      return res.status(200).json({ key, draft });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = text(body.name, 160);
      const date = String(body.date || "");
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return res
          .status(400)
          .json({ error: "Event name and date are required" });
      const startTime = time(body.startTime);
      const endTime = time(body.endTime);
      if (startTime && endTime && endTime <= startTime)
        return res
          .status(400)
          .json({ error: "End time must be after start time" });
      const attendance = Number(body.expectedAttendance);
      const result = await db.query(
        `insert into events (name, event_date, pillar, needs_vendor, expected_attendance, notes,
           start_time, end_time, location, description, equipment, catering_needed,
           catering_budget, menu_ideas, event_link)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning ${EVENT_COLUMNS}`,
        [
          name,
          date,
          text(body.pillar, 40),
          !!body.needsVendor,
          Number.isInteger(attendance) && attendance > 0 ? attendance : null,
          text(body.notes, 4000),
          startTime,
          endTime,
          text(body.location, 160),
          text(body.description, 2000),
          text(body.equipment, 500),
          !!body.cateringNeeded,
          text(body.cateringBudget, 60),
          text(body.menuIdeas, 1000),
          /^https?:\/\//i.test(String(body.eventLink || "").trim())
            ? text(body.eventLink, 1000)
            : null,
        ],
      );
      trackUsage("Task Dash API", "Create event");
      return res.status(201).json(result.rows[0]);
    }
    if (req.method === "PATCH") {
      const { id } = req.query;
      const { pipelineState, expectedAttendance, notes, draft } =
        req.body || {};
      if (!id) return res.status(400).json({ error: "Event id is required" });
      if (draft) {
        if (!DRAFT_KEYS.includes(draft.key))
          return res.status(400).json({ error: "Unknown draft type" });
        const saved = {
          text: String(draft.text || "").slice(0, 20000),
          generatedAt: draft.generatedAt || null,
          edited: true,
          editedAt: new Date().toISOString(),
        };
        const result = await db.query(
          `update events set drafts = coalesce(drafts, '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb) where id=$3 returning id`,
          [draft.key, JSON.stringify(saved), id],
        );
        if (!result.rows[0])
          return res.status(404).json({ error: "Event not found" });
        return res.status(200).json({ key: draft.key, draft: saved });
      }
      const result = await db.query(
        `update events set pipeline_state=coalesce($1::jsonb,pipeline_state), expected_attendance=coalesce($2,expected_attendance), notes=coalesce($3,notes) where id=$4 returning ${EVENT_COLUMNS}`,
        [
          pipelineState ? JSON.stringify(pipelineState) : null,
          expectedAttendance || null,
          notes || null,
          id,
        ],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Event not found" });
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
