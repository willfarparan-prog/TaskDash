const { getPool, ensureWorkspaceSchema, trackUsage } = require('../lib/db');
const { requireOwnerSession } = require('../lib/session');

function defaultContent(days) {
  return Array.from({ length: Math.max(1, Math.min(Number(days) || 3, 7)) }, (_, i) => ({
    name: `Day ${i + 1}`,
    exercises: 'WARM-UP\n1. Mobility / activation — 2 rounds\n\nLIFTS\nA1. Primary movement — 4 × 6\nA2. Paired movement — 4 × 8\nB1. Secondary movement — 3 × 10\nB2. Core / carry — 3 rounds\n\nCOOLDOWN\nBreathing + recovery — 5 min',
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    if (req.method === 'GET') {
      const result = await db.query(`select * from training_programs order by updated_at desc, id desc`);
      trackUsage('Task Dash API', 'Load programs');
      return res.status(200).json({ programs: result.rows });
    }
    if (req.method === 'POST') {
      const { name, clientName, daysPerWeek, weeks, status } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Program name is required' });
      const client = clientName ? await db.query(`select id from clients where lower(name)=lower($1) limit 1`, [clientName]) : { rows: [] };
      const result = await db.query(
        `insert into training_programs (name, client_id, client_name, days_per_week, weeks, status, content)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
        [name, client.rows[0]?.id || null, clientName || null, daysPerWeek || 3, weeks || 4, status || 'draft', JSON.stringify(defaultContent(daysPerWeek))]
      );
      trackUsage('Task Dash API', 'Create program');
      return res.status(201).json(result.rows[0]);
    }
    if (req.method === 'PATCH') {
      const { id } = req.query;
      const { content, status, name } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Program id is required' });
      const result = await db.query(
        `update training_programs set content=coalesce($1::jsonb,content), status=coalesce($2,status), name=coalesce($3,name), updated_at=now() where id=$4 returning *`,
        [content ? JSON.stringify(content) : null, status || null, name || null, id]
      );
      trackUsage('Task Dash API', 'Save program');
      return res.status(200).json(result.rows[0]);
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    trackUsage('Task Dash API', 'Programs error', 'error');
    return res.status(500).json({ error: err.message });
  }
};
