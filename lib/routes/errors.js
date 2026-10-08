// /api/errors — the error log. GET lists recent server and browser errors;
// POST records a browser error (signed-in dashboard only).
const { getPool, ensureWorkspaceSchema } = require("../db");
const { requireOwnerSession } = require("../session");
const { reportError } = require("../errors");
const { clean } = require("../validate");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  await ensureWorkspaceSchema();
  if (req.method === "GET") {
    const result = await getPool().query(
      "select id, source, message, created_at from app_errors order by created_at desc limit 30",
    );
    return res.status(200).json({ errors: result.rows });
  }
  if (req.method === "POST") {
    const b = req.body || {};
    await reportError(
      `browser:${clean(b.where, 60) || "app"}`,
      clean(b.message, 1000),
      clean(b.stack, 4000),
    );
    return res.status(201).json({ ok: true });
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
};
