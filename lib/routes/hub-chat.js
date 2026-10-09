// /api/hub-chat — "Ask the hub": a small Haiku chat that points to the right
// SOP or link (lib/hubChat.js). Owner-only; capped per day to keep it cheap.

const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");
const { fromRow } = require("../../js/sops-core");
const { askHub, buildCatalog, cleanMessages } = require("../hubChat");

const DAILY_LIMIT = 300;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method not allowed" });
    }
    const messages = cleanMessages(req.body?.messages);
    if (!messages.length)
      return res.status(400).json({ error: "Ask a question first." });
    if (!process.env.ANTHROPIC_API_KEY)
      return res.status(503).json({
        error: "The hub guide needs ANTHROPIC_API_KEY on the server.",
      });
    await ensureWorkspaceSchema();
    const db = getPool();
    const used = await db.query(
      `select count(*)::int n from api_usage where operation='Hub chat' and created_at > now() - interval '1 day'`,
    );
    if (used.rows[0].n >= DAILY_LIMIT)
      return res.status(429).json({
        error: "That's the daily limit for the hub guide. Try again tomorrow.",
      });

    const [sopRows, linkRows] = await Promise.all([
      db.query(
        "select id, tab, title, summary, when_text, keywords, links, body from sops",
      ),
      db.query(
        "select id, title, category, description, url from links order by pinned desc, sort, title",
      ),
    ]);
    const catalog = buildCatalog(sopRows.rows.map(fromRow), linkRows.rows);
    let out;
    try {
      out = await askHub(messages, catalog);
    } catch (err) {
      trackUsage("Claude", "Hub chat", "error");
      return res.status(502).json({ error: err.message });
    }
    trackUsage("Claude", "Hub chat", "ok", out.usage);
    return res
      .status(200)
      .json({ answer: out.answer, sopIds: out.sopIds, linkIds: out.linkIds });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
