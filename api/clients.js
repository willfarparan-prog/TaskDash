const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { requireOwnerSession } = require("../lib/session");

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
        `insert into client_sessions (client_id, session_type, session_date, duration_minutes, notes, next_session)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [
          clientId,
          sessionType,
          date,
          durationMinutes || null,
          notes || null,
          nextSession || null,
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

    if (req.method === "POST") {
      const { email, phone, serviceType, nextFollowUp, notes } =
        req.body || {};
      const name = String(req.body?.name || "")
        .trim()
        .slice(0, 120);
      if (!name)
        return res.status(400).json({ error: "Client name is required" });
      const result = await db.query(
        `insert into clients (name, email, phone, service_type, next_follow_up, notes)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [
          name,
          email || null,
          phone || null,
          serviceType || "PT consult",
          nextFollowUp || null,
          notes || null,
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
           next_follow_up=$6, notes=$7, updated_at=now()
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
