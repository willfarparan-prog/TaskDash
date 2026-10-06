const { getPool, ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { requireOwnerSession } = require("../lib/session");

const clamp = (value, min, max, fallback) =>
  Math.max(min, Math.min(Number(value) || fallback, max));
const clean = (value, max) =>
  String(value || "")
    .trim()
    .slice(0, max);
const status = (value, fallback = "draft") =>
  ["draft", "active", "archived"].includes(value) ? value : fallback;
function defaultContent(days, weeks) {
  const count = clamp(weeks, 1, 8, 4);
  return {
    days: Array.from({ length: clamp(days, 1, 7, 3) }, (_, i) => ({
      name: `Day ${i + 1}`,
      warmup: [{ name: "Mobility / activation", prescription: "2 rounds" }],
      blocks: [
        {
          letter: "A",
          exercises: [
            {
              name: "Primary movement",
              sets: 4,
              reps: Array(count).fill("6"),
              note: "",
            },
            {
              name: "Paired movement",
              sets: 4,
              reps: Array(count).fill("8"),
              note: "",
            },
          ],
        },
        {
          letter: "B",
          exercises: [
            {
              name: "Secondary movement",
              sets: 3,
              reps: Array(count).fill("10"),
              note: "",
            },
            {
              name: "Core / carry",
              sets: 3,
              reps: Array(count).fill("30 sec"),
              note: "",
            },
          ],
        },
      ],
    })),
  };
}

function safeContent(value, days, weeks) {
  if (!value || !Array.isArray(value.days)) return defaultContent(days, weeks);
  const count = clamp(weeks, 1, 8, 4);
  const safeDays = value.days.slice(0, 7).map((day, dayIndex) => ({
    name: clean(day?.name, 60) || `Day ${dayIndex + 1}`,
    warmup: Array.isArray(day?.warmup)
      ? day.warmup
          .slice(0, 14)
          .map((item) => ({
            name: clean(item?.name, 120),
            prescription: clean(item?.prescription, 40),
          }))
          .filter((item) => item.name)
      : [],
    blocks: Array.isArray(day?.blocks)
      ? day.blocks
          .slice(0, 8)
          .map((block, blockIndex) => ({
            letter: String.fromCharCode(65 + blockIndex),
            exercises: Array.isArray(block?.exercises)
              ? block.exercises
                  .slice(0, 8)
                  .map((exercise) => ({
                    name: clean(exercise?.name, 120),
                    note: clean(exercise?.note, 300),
                    sets: clamp(exercise?.sets, 1, 10, 3),
                    reps: Array.from({ length: count }, (_, index) =>
                      clean(exercise?.reps?.[index], 40),
                    ),
                  }))
                  .filter((exercise) => exercise.name)
              : [],
          }))
          .filter((block) => block.exercises.length)
      : [],
  }));
  return {
    days: safeDays.length ? safeDays : defaultContent(days, weeks).days,
  };
}
async function resolveClient(db, clientId, clientName) {
  if (clientId) {
    const found = await db.query(
      "select id,name from clients where id=$1 limit 1",
      [clientId],
    );
    if (found.rows[0]) return found.rows[0];
  }
  if (clientName) {
    const found = await db.query(
      "select id,name from clients where lower(name)=lower($1) limit 1",
      [clientName],
    );
    if (found.rows[0]) return found.rows[0];
  }
  return { id: null, name: clientName || null };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    if (req.method === "GET") {
      const result = await db.query(
        "select * from training_programs order by is_stock, updated_at desc, id desc",
      );
      trackUsage("Task Dash API", "Load programs");
      return res.status(200).json({ programs: result.rows });
    }
    if (req.method === "POST") {
      const body = req.body || {};
      if (body.action === "save_as_stock") {
        const source = await db.query(
          "select * from training_programs where id=$1 limit 1",
          [body.sourceId],
        );
        if (!source.rows[0])
          return res.status(404).json({ error: "Source program not found" });
        const title = clean(body.name || source.rows[0].name, 120);
        const duplicate = await db.query(
          "select id from training_programs where is_stock=true and lower(name)=lower($1) limit 1",
          [title],
        );
        if (duplicate.rows[0])
          return res
            .status(409)
            .json({ error: "A stock template with that name already exists" });
        const result = await db.query(
          `insert into training_programs (name,client_id,client_name,days_per_week,weeks,status,content,is_stock,source_program_id,goal,level,sport,emphasis) select $1,null,null,days_per_week,weeks,'active',content,true,id,goal,$2,$3,$4 from training_programs where id=$5 returning *`,
          [
            title,
            clean(body.level, 60) || null,
            clean(body.sport, 80) || null,
            clean(body.emphasis, 60) || null,
            body.sourceId,
          ],
        );
        trackUsage("Task Dash API", "Save program as stock");
        return res.status(201).json(result.rows[0]);
      }
      if (body.action === "use_template") {
        const source = await db.query(
          "select * from training_programs where id=$1 and is_stock=true limit 1",
          [body.sourceId],
        );
        if (!source.rows[0])
          return res.status(404).json({ error: "Stock template not found" });
        const client = await resolveClient(db, body.clientId, body.clientName);
        const title = clean(
          body.name || `${client.name || "Client"} — ${source.rows[0].name}`,
          120,
        );
        const result = await db.query(
          `insert into training_programs (name,client_id,client_name,days_per_week,weeks,status,content,is_stock,source_program_id,goal,level,sport,emphasis) select $1,$2,$3,days_per_week,weeks,'draft',content,false,id,goal,level,sport,emphasis from training_programs where id=$4 returning *`,
          [title, client.id, client.name, body.sourceId],
        );
        trackUsage("Task Dash API", "Copy stock program");
        return res.status(201).json(result.rows[0]);
      }
      if (!clean(body.name, 120))
        return res.status(400).json({ error: "Program name is required" });
      const days = clamp(body.daysPerWeek, 1, 7, 3),
        weeks = clamp(body.weeks, 1, 8, 4),
        client = await resolveClient(db, body.clientId, body.clientName);
      const result = await db.query(
        `insert into training_programs (name,client_id,client_name,days_per_week,weeks,status,content,is_stock,goal,level,sport,emphasis) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) returning *`,
        [
          clean(body.name, 120),
          client.id,
          client.name,
          days,
          weeks,
          status(body.status),
          JSON.stringify(safeContent(body.content, days, weeks)),
          !!body.isStock,
          clean(body.goal, 300) || null,
          clean(body.level, 60) || null,
          clean(body.sport, 80) || null,
          clean(body.emphasis, 60) || null,
        ],
      );
      trackUsage("Task Dash API", "Create program");
      return res.status(201).json(result.rows[0]);
    }
    if (req.method === "PATCH") {
      const { id } = req.query,
        body = req.body || {};
      if (!id) return res.status(400).json({ error: "Program id is required" });
      let client = null;
      if (
        Object.prototype.hasOwnProperty.call(body, "clientId") ||
        Object.prototype.hasOwnProperty.call(body, "clientName")
      )
        client = await resolveClient(db, body.clientId, body.clientName);
      const weeks = body.weeks ? clamp(body.weeks, 1, 8, 4) : null;
      const days = body.daysPerWeek ? clamp(body.daysPerWeek, 1, 7, 3) : null;
      const result = await db.query(
        `update training_programs set content=coalesce($1::jsonb,content),status=coalesce($2,status),name=coalesce($3,name),client_id=case when $4 then $5 else client_id end,client_name=case when $4 then $6 else client_name end,weeks=coalesce($7,weeks),days_per_week=coalesce($8,days_per_week),goal=coalesce($9,goal),level=coalesce($10,level),sport=coalesce($11,sport),emphasis=coalesce($12,emphasis),updated_at=now() where id=$13 returning *`,
        [
          body.content
            ? JSON.stringify(safeContent(body.content, days || 3, weeks || 4))
            : null,
          body.status ? status(body.status) : null,
          clean(body.name, 120) || null,
          !!client,
          client?.id || null,
          client?.name || null,
          weeks,
          days,
          body.goal == null ? null : clean(body.goal, 300),
          body.level == null ? null : clean(body.level, 60),
          body.sport == null ? null : clean(body.sport, 80),
          body.emphasis == null ? null : clean(body.emphasis, 60),
          id,
        ],
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Program not found" });
      trackUsage("Task Dash API", "Save program");
      return res.status(200).json(result.rows[0]);
    }
    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Program id is required" });
      await db.query("delete from training_programs where id=$1", [id]);
      trackUsage("Task Dash API", "Delete program");
      return res.status(200).json({ ok: true });
    }
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    trackUsage("Task Dash API", "Programs error", "error");
    return res.status(500).json({ error: err.message });
  }
};
