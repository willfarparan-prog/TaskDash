// /api/settings — small settings that should follow William between his
// laptop and the gym tablet. Right now: the session wrap-up settings (Workday
// rates by session length, sheet links and column layouts).

const { getPool, ensureWorkspaceSchema } = require("../db");
const { requireOwnerSession } = require("../session");
const { cleanSettings } = require("../../js/wrapup-core");

// Each key a client may store, and how its value is cleaned.
const KEYS = { wrapup: cleanSettings };

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();

    if (req.method === "GET") {
      const result = await db.query("select key, value from app_settings");
      const settings = {};
      for (const row of result.rows)
        if (KEYS[row.key]) settings[row.key] = KEYS[row.key](row.value);
      // Anything never saved comes back as the defaults.
      for (const key of Object.keys(KEYS))
        settings[key] ||= KEYS[key]({});
      return res.status(200).json({ settings });
    }

    if (req.method === "PUT") {
      const key = String(req.body?.key || "");
      if (!KEYS[key])
        return res.status(400).json({ error: "Unknown setting" });
      const value = KEYS[key](req.body?.value);
      await db.query(
        `insert into app_settings (key, value) values ($1, $2::jsonb)
         on conflict (key) do update set value=excluded.value, updated_at=now()`,
        [key, JSON.stringify(value)],
      );
      return res.status(200).json({ key, value });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
