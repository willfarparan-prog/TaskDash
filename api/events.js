// /api/events — event pipeline entries
const { Pool } = require('pg');
let pool;
function getPool() {
  if (!pool) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
          pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            }
              return pool;
              }

              module.exports = async (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                  try {
                      const db = getPool();

                          if (req.method === 'GET') {
                                const r = await db.query('select id, name, event_date, pillar from events order by event_date asc');
                                      return res.status(200).json({ events: r.rows });
                                          }

                                              if (req.method === 'POST') {
                                                    const { name, date, pillar } = req.body || {};
                                                          if (!name || !date) return res.status(400).json({ error: 'name and date required' });
                                                                const r = await db.query(
                                                                        'insert into events (name, event_date, pillar) values ($1,$2,$3) returning id, name, event_date, pillar',
                                                                                [name, date, pillar || null]
                                                                                      );
                                                                                            return res.status(201).json(r.rows[0]);
                                                                                                }

                                                                                                    res.setHeader('Allow', 'GET, POST');
                                                                                                        return res.status(405).json({ error: 'method not allowed' });
                                                                                                          } catch (err) {
                                                                                                              return res.status(500).json({ error: err.message });
                                                                                                                }
                                                                                                                };
                                                                                                                
