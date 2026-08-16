// /api/tasks — daily one-off tasks + recurring-task completion state
// Reads/writes Postgres via the neon env var (set in Vercel Project Settings → Environment Variables).
// Never hardcode the connection string here — Vercel injects it at runtime.

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
                  const dayKey = req.query.day;
                  if (!dayKey) return res.status(400).json({ error: 'day query param required (YYYY-MM-DD)' });
                  const daily = await db.query('select id, name, done from daily_tasks where day_key = $1 order by id', [dayKey]);
                  const checks = await db.query('select task_id, period_key, done from task_checks');
                  const recur = await db.query('select id, name, cadence, weekday, link_label, link_url, source from recur_tasks order by id');
                  return res.status(200).json({ daily: daily.rows, checks: checks.rows, recur: recur.rows });
        }

        if (req.method === 'POST') {
                  const { type, dayKey, name } = req.body || {};
                  if (type === 'daily_task') {
                              if (!dayKey || !name) return res.status(400).json({ error: 'dayKey and name required' });
                              const r = await db.query(
                                            'insert into daily_tasks (day_key, name) values ($1,$2) returning id, name, done',
                                            [dayKey, name]
                                          );
                              return res.status(201).json(r.rows[0]);
                  }
                  if (type === 'recur_task') {
                              const { id, cadence, weekday, linkLabel, linkUrl } = req.body;
                              if (!id || !name || !cadence) return res.status(400).json({ error: 'id, name, cadence required' });
                              await db.query(
                                            `insert into recur_tasks (id, name, cadence, weekday, link_label, link_url, source)
                                                       values ($1,$2,$3,$4,$5,$6,'custom')
                                                                  on conflict (id) do update set name=excluded.name, cadence=excluded.cadence, weekday=excluded.weekday`,
                                            [id, name, cadence, weekday ?? null, linkLabel ?? null, linkUrl ?? null]
                                          );
                              return res.status(201).json({ ok: true });
                  }
                  return res.status(400).json({ error: 'unknown type' });
        }

        if (req.method === 'PATCH') {
                  const { kind, id, done, taskId, periodKey } = req.body || {};
                  if (kind === 'daily_task') {
                              await db.query('update daily_tasks set done=$1 where id=$2', [done, id]);
                              return res.status(200).json({ ok: true });
                  }
                  if (kind === 'recur_check') {
                              if (!taskId || !periodKey) return res.status(400).json({ error: 'taskId and periodKey required' });
                              if (done) {
                                            await db.query(
                                                            `insert into task_checks (task_id, period_key, done) values ($1,$2,true)
                                                                         on conflict (task_id, period_key) do update set done=true, updated_at=now()`,
                                                            [taskId, periodKey]
                                                          );
                              } else {
                                            await db.query('delete from task_checks where task_id=$1 and period_key=$2', [taskId, periodKey]);
                              }
                              return res.status(200).json({ ok: true });
                  }
                  return res.status(400).json({ error: 'unknown kind' });
        }

        if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.query('delete from daily_tasks where id=$1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
              return res.status(405).json({ error: 'method not allowed' });
      } catch (err) {
              return res.status(500).json({ error: err.message });
      }
};
