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
      const { name, email, phone, serviceType, nextFollowUp, notes } =
        req.body || {};
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

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    trackUsage("Task Dash API", "Clients error", "error");
    return res.status(500).json({ error: err.message });
  }
};
