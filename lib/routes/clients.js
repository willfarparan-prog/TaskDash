const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");
const { isDate, int } = require("../validate");

// New-client checklist steps; `onboarding` maps a step to the date it was done.
const WRAPUP_STEPS = ["sf", "logger", "workday", "signed"];
const ONBOARDING_STEPS = [
  "invoice",
  "schedule",
  "program",
  "programPrinted",
  "mealPlan",
  "ptLogger",
];

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const resource = req.query.resource;

    if (req.method === "GET") {
      const [clients, sessions] = await Promise.all([
        db.query(`select * from clients order by status='active' desc, name`),
        db.query(
          `select * from client_sessions order by session_date desc, id desc`,
        ),
      ]);
      trackUsage("Task Dash API", "Load clients");
      return res
        .status(200)
        .json({ clients: clients.rows, sessions: sessions.rows });
    }

    if (req.method === "POST" && resource === "sessions") {
      const {
        clientId,
        sessionType,
        date,
        durationMinutes,
        lengthMinutes,
        notes,
        nextSession,
      } = req.body || {};
      if (!clientId || !sessionType || !date)
        return res
          .status(400)
          .json({ error: "Client, session type, and date are required" });
      if (!Number.isInteger(Number(clientId)))
        return res.status(400).json({ error: "Choose a valid client" });
      const exists = await db.query("select 1 from clients where id=$1", [
        clientId,
      ]);
      if (!exists.rows.length)
        return res.status(404).json({ error: "Client not found" });
      const result = await db.query(
        `insert into client_sessions (client_id, session_type, session_date, duration_minutes, notes, next_session, length_minutes)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          clientId,
          sessionType,
          date,
          durationMinutes || null,
          notes || null,
          nextSession || null,
          int(lengthMinutes, 5, 240, null),
        ],
      );
      if (nextSession)
        await db.query(
          `update clients set next_follow_up=$1, updated_at=now() where id=$2`,
          [nextSession, clientId],
        );
      trackUsage("Task Dash API", "Log client session");
      return res.status(201).json(result.rows[0]);
    }

    // Tick (or untick) a wrap-up step on a session, or set its length.
    if (req.method === "PATCH" && resource === "wrapup") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Session id is required" });
      const { step, done } = req.body || {};
      const length = int(req.body?.lengthMinutes, 5, 240, null);
      let result;
      if (step) {
        if (!WRAPUP_STEPS.includes(step))
          return res.status(400).json({ error: "Unknown wrap-up step" });
        const day = isDate(req.body?.dayKey) ? req.body.dayKey : null;
        result = done
          ? await db.query(
              `update client_sessions set wrapup = coalesce(wrapup,'{}'::jsonb) ||
                 jsonb_build_object($2::text, coalesce($3::text, to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD')))
               where id=$1 returning *`,
              [id, step, day],
            )
          : await db.query(
              `update client_sessions set wrapup = coalesce(wrapup,'{}'::jsonb) - $2::text where id=$1 returning *`,
              [id, step],
            );
      } else if (length) {
        result = await db.query(
          "update client_sessions set length_minutes=$2 where id=$1 returning *",
          [id, length],
        );
      } else return res.status(400).json({ error: "Nothing to save" });
      if (!result.rows[0])
        return res.status(404).json({ error: "Session not found" });
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === "PATCH" && resource === "onboarding") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Client id is required" });
      const { step, done, track } = req.body || {};
      const day = isDate(req.body?.dayKey) ? req.body.dayKey : null;
      let result;
      if (typeof track === "boolean") {
        result = await db.query(
          `update clients set onboarding = case when $2 then coalesce(onboarding,'{}'::jsonb) else null end,
             updated_at=now() where id=$1 returning *`,
          [id, track],
        );
      } else {
        if (!ONBOARDING_STEPS.includes(step))
          return res.status(400).json({ error: "Unknown checklist step" });
        result = done
          ? await db.query(
              `update clients set onboarding = coalesce(onboarding,'{}'::jsonb) ||
                 jsonb_build_object($2::text, coalesce($3::text, to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD'))),
                 updated_at=now() where id=$1 returning *`,
              [id, step, day],
            )
          : await db.query(
              `update clients set onboarding = onboarding - $2::text, updated_at=now()
                 where id=$1 returning *`,
              [id, step],
            );
      }
      if (!result.rows[0])
        return res.status(404).json({ error: "Client not found" });
      trackUsage("Task Dash API", "Update client checklist");
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === "POST") {
      const { email, phone, serviceType, nextFollowUp, notes } = req.body || {};
      const name = String(req.body?.name || "")
        .trim()
        .slice(0, 120);
      if (!name)
        return res.status(400).json({ error: "Client name is required" });
      const result = await db.query(
        `insert into clients (name, email, phone, service_type, next_follow_up, notes, first_session, onboarding)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          name,
          email || null,
          phone || null,
          serviceType || "PT consult",
          nextFollowUp || null,
          notes || null,
          isDate(req.body?.firstSession) ? req.body.firstSession : null,
          // Personal training clients start with the new-client checklist.
          (serviceType || "PT consult") === "Personal training" ? {} : null,
        ],
      );
      trackUsage("Task Dash API", "Create client");
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === "PATCH") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Client id is required" });
      const body = req.body || {};
      const name = String(body.name || "")
        .trim()
        .slice(0, 120);
      if (!name)
        return res.status(400).json({ error: "Client name is required" });
      const optional = (value, max) =>
        String(value || "")
          .trim()
          .slice(0, max) || null;
      const result = await db.query(
        `update clients set name=$1, email=$2, phone=$3, service_type=$4, status=$5,
           next_follow_up=$6, notes=$7, first_session=$9,
           package_size=$10, package_start=$11, session_minutes=$12, package_price=$13, updated_at=now()
         where id=$8 returning *`,
        [
          name,
          optional(body.email, 160),
          optional(body.phone, 40),
          optional(body.serviceType, 60) || "PT consult",
          ["active", "inactive"].includes(body.status) ? body.status : "active",
          /^\d{4}-\d{2}-\d{2}$/.test(body.nextFollowUp || "")
            ? body.nextFollowUp
            : null,
          optional(body.notes, 4000),
          id,
          isDate(body.firstSession) ? body.firstSession : null,
          int(body.packageSize, 1, 500, null),
          isDate(body.packageStart) ? body.packageStart : null,
          int(body.sessionMinutes, 5, 240, null),
          Number.isFinite(Number(body.packagePrice)) &&
          body.packagePrice !== "" &&
          body.packagePrice != null &&
          Number(body.packagePrice) >= 0 &&
          Number(body.packagePrice) < 100000
            ? Math.round(Number(body.packagePrice) * 100) / 100
            : null,
        ],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Client not found" });
      trackUsage("Task Dash API", "Update client");
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Client id is required" });
      // Sessions cascade with the client; linked programs keep the client's
      // name but lose the link (on delete set null).
      const result = await db.query(
        "delete from clients where id=$1 returning id",
        [id],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Client not found" });
      trackUsage("Task Dash API", "Delete client");
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    trackUsage("Task Dash API", "Clients error", "error");
    return res.status(500).json({ error: err.message });
  }
};
