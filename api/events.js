// /api/events — event pipeline entries
const { Pool } = require('pg');
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
    try {
          const db = getPool();

      if (req.method === 'GET') {
              const r = await db.query('select id, name, event_date, pillar, needs_vendor from events order by event_date asc');
              return res.status(200).json({ events: r.rows });
      }

      if (req.method === 'POST') {
              const { name, date, pillar, needsVendor } = req.body || {};
              if (!name || !date) return res.status(400).json({ error: 'name and date required' });
              const r = await db.query(
                        'insert into events (name, event_date, pillar, needs_vendor) values ($1,$2,$3,$4) returning id, name, event_date, pillar, needs_vendor',
                        [name, date, pillar || null, !!needsVendor]
                      );
              return res.status(201).json(r.rows[0]);
      }

      if (req.method === 'DELETE') {
              const { id } = req.query;
              if (!id) return res.status(400).json({ error: 'id required' });
              await db.query('delete from events where id=$1', [id]);
              return res.status(200).json({ ok: true });
      }

      res.setHeader('Allow', 'GET, POST, DELETE');
          return res.status(405).json({ error: 'method not allowed' });
    } catch (err) {
          return res.status(500).json({ error: err.message });
    }
};
