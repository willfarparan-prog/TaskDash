// /api/links - playbook link registry (trackers, forms, SOPs).
// URLs are stored in the Neon `links` table so they never live in the public repo.
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const r = await getPool().query(
      'select id, title, short, category, url, description, pinned from links order by category, sort, title'
    );
    return res.status(200).json({ links: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
