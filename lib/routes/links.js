// /api/links - private playbook link registry (trackers, forms, SOPs).
// URLs stay in Neon and are only returned to an authenticated dashboard owner.
const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const r = await getPool().query(
      "select id, title, short, category, url, description, frequency, pinned from links order by pinned desc, sort, title",
    );
    trackUsage("Task Dash API", "Load private quick links");
    return res.status(200).json({ links: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
