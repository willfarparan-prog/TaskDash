const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { OWNER_EMAIL, WORK_EMAIL } = require("../lib/google");
const { requireOwnerSession } = require("../lib/session");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: "method not allowed" });
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const token = await db.query(
      `select id, account_email, scope, updated_at from oauth_tokens where id in ('google','google-work')`,
    );
    const google = token.rows.find((row) => row.id === "google");
    const workGoogle = token.rows.find((row) => row.id === "google-work");
    const verified =
      (google?.account_email || "").toLowerCase() === OWNER_EMAIL;
    const workVerified =
      (workGoogle?.account_email || "").toLowerCase() === WORK_EMAIL;
    const scope = google?.scope || "";
    const connections = [
      {
        name: "Neon database",
        initials: "N",
        status: "connected",
        detail: "Tasks, clients, programs, and events",
      },
      {
        name: "Google Calendar",
        initials: "GC",
        status:
          verified && scope.includes("calendar.readonly")
            ? "connected"
            : "attention",
        detail: verified
          ? `${OWNER_EMAIL} · read only`
          : `Reconnect as ${OWNER_EMAIL}`,
      },
      {
        name: "Work Scheduler Calendar",
        initials: "WC",
        status:
          workVerified &&
          String(workGoogle?.scope || "").includes("calendar.events")
            ? "connected"
            : "attention",
        detail: workVerified
          ? `${WORK_EMAIL} · booking sync`
          : `Connect ${WORK_EMAIL} from Scheduler`,
      },
      {
        name: "Google Inbox",
        initials: "GM",
        status:
          verified && scope.includes("gmail.readonly")
            ? "connected"
            : "attention",
        detail: "Important and starred unread messages only",
      },
      {
        name: "Exos Work Inbox",
        initials: "EX",
        status:
          workVerified &&
          String(workGoogle?.scope || "").includes("gmail.readonly")
            ? "connected"
            : "attention",
        detail:
          workVerified &&
          String(workGoogle?.scope || "").includes("gmail.readonly")
            ? `${WORK_EMAIL} · important and starred unread`
            : `Reconnect ${WORK_EMAIL} from Inbox to add Gmail`,
      },
      {
        name: "Adobe Microsoft",
        initials: "MS",
        status: process.env.MICROSOFT_CLIENT_ID ? "attention" : "queued",
        detail: "Work inbox · authorization has not been completed",
      },
      {
        name: "Claude assistant",
        initials: "C",
        status: process.env.ANTHROPIC_API_KEY ? "connected" : "queued",
        detail: "Daily overview and drafting assistant",
      },
      {
        name: "GitHub",
        initials: "GH",
        status: "connected",
        detail: "willfarparan-prog/TaskDash",
      },
      {
        name: "Vercel",
        initials: "V",
        status: "connected",
        detail: "task-dash production and previews",
      },
    ];
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const [totals, runs] = await Promise.all([
      db.query(
        `select coalesce(sum(calls),0)::int calls, coalesce(sum(input_tokens+output_tokens),0)::int tokens, sum(credits) credits from api_usage where created_at >= $1`,
        [month],
      ),
      db.query(
        `select service, operation, status, sum(calls)::int calls, max(created_at) last_run from api_usage group by service, operation, status order by last_run desc limit 20`,
      ),
    ]);
    trackUsage("Task Dash API", "Load connection status");
    return res
      .status(200)
      .json({ connections, usage: { ...totals.rows[0], runs: runs.rows } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
