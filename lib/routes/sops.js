// /api/sops — the SOP library on the Resource hub. Read-only here; the
// content is edited in the database.

const { getPool, ensureWorkspaceSchema } = require("../db");
const { requireOwnerSession } = require("../session");
const { TABS, fromRow } = require("../../js/sops-core");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "method not allowed" });
    }
    await ensureWorkspaceSchema();
    const result = await getPool().query(
      "select id, tab, title, summary, when_text, keywords, links, body, sort from sops",
    );
    const order = Object.fromEntries(TABS.map((t, i) => [t.key, i]));
    const sops = result.rows
      .map(fromRow)
      .map((sop, i) => ({ ...sop, _sort: result.rows[i].sort }))
      .sort(
        (a, b) =>
          (order[a.tab] ?? 99) - (order[b.tab] ?? 99) ||
          a._sort - b._sort ||
          a.title.localeCompare(b.title),
      )
      .map(({ _sort, ...sop }) => sop);
    return res.status(200).json({ tabs: TABS, sops });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
