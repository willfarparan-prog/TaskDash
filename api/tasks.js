// /api/tasks — one-off tasks for a day, scheduled recurring tasks, and their
// completion checks. Schedules follow task-schedule.js; a recurring task's
// check is stored against the due date of the cycle it completes.

const crypto = require("crypto");
const { requireOwnerSession } = require("../lib/session");
const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { normalizeSchedule } = require("../task-schedule");

const clean = (value, max) =>
  String(value || "")
    .trim()
    .slice(0, max);
const isDayKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const RECUR_COLUMNS =
  "id, name, cadence, weekday, month_day, to_char(anchor_date,'YYYY-MM-DD') as anchor_date, lead_days, time_label, sort, link_label, link_url, source, to_char(created_at at time zone 'America/Los_Angeles','YYYY-MM-DD') as created_day";

function scheduleParams(body) {
  const r = normalizeSchedule(body);
  return [
    r.cadence,
    r.weekday,
    r.monthDay,
    r.anchorDate,
    r.leadDays,
    r.timeLabel || null,
  ];
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();

    if (req.method === "GET") {
      const dayKey = req.query.day;
      if (!isDayKey(dayKey))
        return res
          .status(400)
          .json({ error: "day query param required (YYYY-MM-DD)" });
      // One-off tasks stay on the list until they're checked off: today's,
      // plus unfinished ones from earlier days (and ones finished today).
      const daily = await db.query(
        `select id, name, done, day_key from daily_tasks
         where day_key = $1 or (day_key < $1 and (done = false or done_on = $1))
         order by day_key, id`,
        [dayKey],
      );
      // Monthly cycles look back at most ~2 months for their checks.
      const checks = await db.query(
        "select task_id, period_key, done from task_checks where period_key >= to_char(($1::date - 70),'YYYY-MM-DD')",
        [dayKey],
      );
      const recur = await db.query(
        `select ${RECUR_COLUMNS} from recur_tasks order by sort, created_at, id`,
      );
      return res
        .status(200)
        .json({ daily: daily.rows, checks: checks.rows, recur: recur.rows });
    }

    if (req.method === "POST") {
      const { type, dayKey } = req.body || {};
      const name = clean(req.body?.name, 200);
      if (type === "daily_task") {
        if (!isDayKey(dayKey) || !name)
          return res.status(400).json({ error: "dayKey and name required" });
        const r = await db.query(
          "insert into daily_tasks (day_key, name) values ($1,$2) returning id, name, done",
          [dayKey, name],
        );
        return res.status(201).json(r.rows[0]);
      }
      if (type === "recur_task") {
        if (!name) return res.status(400).json({ error: "name required" });
        const id =
          clean(req.body.id, 80) ||
          `custom-${crypto.randomBytes(6).toString("hex")}`;
        const r = await db.query(
          `insert into recur_tasks (id, name, cadence, weekday, month_day, anchor_date, lead_days, time_label, link_label, link_url, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'custom') returning ${RECUR_COLUMNS}`,
          [
            id,
            name,
            ...scheduleParams(req.body),
            clean(req.body.linkLabel, 80) || null,
            clean(req.body.linkUrl, 2000) || null,
          ],
        );
        return res.status(201).json(r.rows[0]);
      }
      if (type === "parse_task") {
        const text = clean(req.body?.text, 300);
        if (!text || !isDayKey(dayKey))
          return res.status(400).json({ error: "text and dayKey required" });
        if (!process.env.ANTHROPIC_API_KEY)
          return res
            .status(503)
            .json({
              error: "Smart add needs ANTHROPIC_API_KEY on the server.",
            });
        const { parseTask } = require("../lib/taskParse");
        const parsed = await parseTask(text, dayKey);
        trackUsage("Claude API", "Parse task schedule", "ok", parsed.usage);
        return res.status(200).json(parsed.task);
      }
      return res.status(400).json({ error: "unknown type" });
    }

    if (req.method === "PATCH") {
      const { kind, id, done, taskId, periodKey } = req.body || {};
      if (kind === "daily_task") {
        if (!id) return res.status(400).json({ error: "id required" });
        const name = clean(req.body.name, 200);
        const doneDay = isDayKey(req.body.dayKey)
          ? req.body.dayKey
          : new Date().toISOString().slice(0, 10);
        await db.query(
          `update daily_tasks set done=coalesce($1,done), name=coalesce($2,name),
             done_on = case when $1 is true then $4 when $1 is false then null else done_on end
           where id=$3`,
          [typeof done === "boolean" ? done : null, name || null, id, doneDay],
        );
        return res.status(200).json({ ok: true });
      }
      if (kind === "recur_task") {
        const name = clean(req.body.name, 200);
        if (!id || !name)
          return res.status(400).json({ error: "id and name required" });
        const r = await db.query(
          `update recur_tasks set name=$2, cadence=$3, weekday=$4, month_day=$5, anchor_date=$6, lead_days=$7, time_label=$8
           where id=$1 returning ${RECUR_COLUMNS}`,
          [id, name, ...scheduleParams(req.body)],
        );
        if (!r.rows.length)
          return res.status(404).json({ error: "Task not found" });
        return res.status(200).json(r.rows[0]);
      }
      if (kind === "recur_check") {
        if (!taskId || !isDayKey(periodKey))
          return res
            .status(400)
            .json({ error: "taskId and periodKey required" });
        if (done) {
          await db.query(
            `insert into task_checks (task_id, period_key, done) values ($1,$2,true)
             on conflict (task_id, period_key) do update set done=true, updated_at=now()`,
            [taskId, periodKey],
          );
        } else {
          // Unticking clears every check for this cycle, including ones
          // recorded under the old day-based keys.
          const start = req.body.windowStart;
          await db.query(
            "delete from task_checks where task_id=$1 and period_key >= $2 and period_key <= $3",
            [taskId, isDayKey(start) ? start : periodKey, periodKey],
          );
        }
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "unknown kind" });
    }

    if (req.method === "DELETE") {
      const { id, kind } = req.query;
      if (!id) return res.status(400).json({ error: "id required" });
      if (kind === "recur") {
        await db.query("delete from recur_tasks where id=$1", [id]);
        await db.query("delete from task_checks where task_id=$1", [id]);
      } else {
        await db.query("delete from daily_tasks where id=$1", [id]);
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
