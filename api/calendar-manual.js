// /api/calendar-manual — add manual time blocks (e.g. Adobe work meetings)
// that render on the week strip alongside live Google Calendar events.

const { Pool } = require('pg');
const { requireOwnerSession } = require('../lib/session');
let pool;
function getPool() {
    if (!pool) {
    if (!process.env.neon) throw new Error('neon env var is not set');
    pool = new Pool({ connectionString: process.env.neon, ssl: { rejectUnauthorized: false } });
}
  return pool;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!requireOwnerSession(req, res)) return;
  try {
    const db = getPool();

    if (req.method === 'POST') {
      const { title, date, start, end, source } = req.body || {};
      if (!title || !date || !start || !end) {
        return res.status(400).json({ error: 'title, date, start, end are required' });
      }
      const r = await db.query(
                `insert into manual_blocks (title, block_date, start_time, end_time, source)
         values ($1,$2,$3,$4,$5) returning id, title, block_date, start_time, end_time, source`,
        [title, date, start, end, source || 'adobe']
      );
      return res.status(201).json(r.rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.query(`delete from manual_blocks where id=$1`, [id]);
      return res.status(200).json({ ok: true });
  }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
} catch (err) {
      return res.status(500).json({ error: err.message });
}
};
