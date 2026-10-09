// /api/consults — the personal-training consult form. A consult belongs to a
// client (a walk-up creates one) and holds the intake answers while William
// fills them in; finishing it records whether they're starting personal
// training and, on Yes, switches the client over and starts the new-client
// checklist. A custom program can be drafted from the answers (not saved).

const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");
const { clean, isDate, int } = require("../validate");
const { cleanConsult } = require("../../js/consult-intake");

const DECISIONS = ["yes", "not_now", "undecided"];

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const id = Number(req.query.id);
    const body = req.body || {};
    const action = req.query.action;

    if (req.method === "GET" && Number.isInteger(id) && id > 0) {
      const found = await db.query(
        "select * from client_consults where id=$1",
        [id],
      );
      const consult = found.rows[0];
      if (!consult) return res.status(404).json({ error: "Consult not found" });
      const client = (
        await db.query("select * from clients where id=$1", [consult.client_id])
      ).rows[0];
      return res.status(200).json({ consult, client });
    }

    if (req.method === "GET") {
      const clientId = Number(req.query.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0)
        return res.status(400).json({ error: "clientId is required" });
      const result = await db.query(
        "select * from client_consults where client_id=$1 order by created_at desc limit 50",
        [clientId],
      );
      return res.status(200).json({ consults: result.rows });
    }

    // Start (or resume) a consult. Returns the consult and its client.
    if (req.method === "POST" && !action) {
      let client;
      const clientId = Number(body.clientId);
      if (Number.isInteger(clientId) && clientId > 0) {
        client = (await db.query("select * from clients where id=$1", [clientId]))
          .rows[0];
        if (!client) return res.status(404).json({ error: "Client not found" });
      } else {
        const name = clean(body.name, 120);
        if (!name)
          return res.status(400).json({ error: "Enter the client's name" });
        const email = clean(body.email, 160).toLowerCase() || null;
        // A returning visitor (same email) reuses their client record.
        if (email)
          client = (
            await db.query(
              "select * from clients where lower(email)=$1 limit 1",
              [email],
            )
          ).rows[0];
        if (!client)
          client = (
            await db.query(
              `insert into clients (name, email, phone, service_type) values ($1,$2,$3,'PT consult') returning *`,
              [name, email, clean(body.phone, 40) || null],
            )
          ).rows[0];
      }
      const draft = (
        await db.query(
          "select * from client_consults where client_id=$1 and status='draft' order by created_at desc limit 1",
          [client.id],
        )
      ).rows[0];
      if (draft)
        return res.status(200).json({ consult: draft, client, resumed: true });
      const consult = (
        await db.query(
          `insert into client_consults (client_id, answers, booking_code) values ($1,$2::jsonb,$3) returning *`,
          [
            client.id,
            JSON.stringify(cleanConsult({ name: client.name })),
            clean(body.bookingCode, 40) || null,
          ],
        )
      ).rows[0];
      trackUsage("Task Dash API", "Start PT consult");
      return res.status(201).json({ consult, client, resumed: false });
    }

    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "Consult id is required" });

    if (req.method === "PATCH") {
      const programId = Number(body.programId);
      const sets = [],
        params = [id];
      if (body.answers) {
        params.push(JSON.stringify(cleanConsult(body.answers)));
        sets.push(`answers=$${params.length}::jsonb`);
      }
      if (Number.isInteger(programId) && programId > 0) {
        params.push(programId);
        sets.push(`program_id=$${params.length}`);
      }
      if (!sets.length)
        return res.status(400).json({ error: "Nothing to save" });
      const result = await db.query(
        `update client_consults set ${sets.join(", ")} where id=$1 returning *`,
        params,
      );
      if (!result.rows[0])
        return res.status(404).json({ error: "Consult not found" });
      return res.status(200).json(result.rows[0]);
    }

    // Finish: record the decision and, on Yes, set the client up.
    if (req.method === "POST" && action === "complete") {
      const decision = String(body.decision || "");
      if (!DECISIONS.includes(decision))
        return res
          .status(400)
          .json({ error: "Choose Yes, Not yet or Undecided" });
      const found = await db.query("select * from client_consults where id=$1", [
        id,
      ]);
      const consult = found.rows[0];
      if (!consult) return res.status(404).json({ error: "Consult not found" });
      const answers = body.answers
        ? cleanConsult(body.answers)
        : consult.answers;
      const days = int(body.daysPerWeek, 1, 7, null);
      const minutes = int(body.sessionMinutes, 15, 180, null);
      const first = isDate(body.firstSession) ? body.firstSession : null;
      const followUp = isDate(body.followUp) ? body.followUp : null;
      const saved = (
        await db.query(
          `update client_consults set answers=$2::jsonb, status='completed', decision=$3,
             follow_up=$4, days_per_week=$5, session_minutes=$6, first_session=$7,
             completed_at=now() where id=$1 returning *`,
          [
            id,
            JSON.stringify(answers),
            decision,
            decision === "yes" ? null : followUp,
            decision === "yes" ? days : null,
            decision === "yes" ? minutes : null,
            decision === "yes" ? first : null,
          ],
        )
      ).rows[0];
      let client;
      if (decision === "yes" && body.makePersonalTraining !== false) {
        // Same shape as a new personal-training client: checklist on, service switched.
        client = (
          await db.query(
            `update clients set service_type='Personal training',
               onboarding = coalesce(onboarding,'{}'::jsonb),
               first_session = coalesce($2::date, first_session),
               package_size = coalesce($3::int, package_size),
               package_start = case when $3::int is not null then coalesce($2::date, $4::date) else package_start end,
               session_minutes = coalesce($5::int, session_minutes),
               package_price = coalesce($6::numeric, package_price),
               updated_at=now() where id=$1 returning *`,
            [
              consult.client_id,
              first,
              int(body.packageSize, 1, 500, null),
              isDate(body.dayKey) ? body.dayKey : null,
              minutes,
              Number(body.packagePrice) >= 0 &&
              Number(body.packagePrice) < 100000 &&
              body.packagePrice !== "" &&
              body.packagePrice != null
                ? Math.round(Number(body.packagePrice) * 100) / 100
                : null,
            ],
          )
        ).rows[0];
      } else if (decision !== "yes" && followUp) {
        client = (
          await db.query(
            "update clients set next_follow_up=$2, updated_at=now() where id=$1 returning *",
            [consult.client_id, followUp],
          )
        ).rows[0];
      } else {
        client = (
          await db.query("select * from clients where id=$1", [
            consult.client_id,
          ])
        ).rows[0];
      }
      trackUsage("Task Dash API", "Finish PT consult");
      return res.status(200).json({ consult: saved, client });
    }

    // Draft a custom program from the answers. Nothing is saved.
    if (req.method === "POST" && action === "program") {
      if (!process.env.ANTHROPIC_API_KEY)
        return res.status(503).json({
          error:
            "Claude isn't connected. Add ANTHROPIC_API_KEY in Vercel to build programs.",
        });
      const found = await db.query(
        `select c.*, cl.name as client_name from client_consults c join clients cl on cl.id=c.client_id where c.id=$1`,
        [id],
      );
      const consult = found.rows[0];
      if (!consult) return res.status(404).json({ error: "Consult not found" });
      const days = int(body.daysPerWeek, 1, 7, consult.days_per_week || 3);
      const minutes = int(
        body.sessionMinutes,
        15,
        180,
        consult.session_minutes || null,
      );
      const answers = body.answers ? cleanConsult(body.answers) : consult.answers;
      const { generateConsultProgram } = require("../consultProgram");
      const { safeContent } = require("./programs");
      let generated;
      try {
        generated = await generateConsultProgram({
          answers,
          firstName: String(answers.name || consult.client_name).split(/\s+/)[0],
          daysPerWeek: days,
          sessionMinutes: minutes,
        });
      } catch (err) {
        trackUsage("Claude", "Consult program", "error");
        return res
          .status(502)
          .json({ error: err.message || "Claude could not build the program" });
      }
      trackUsage("Claude", "Consult program", "ok", generated.usage);
      return res.status(200).json({
        name: generated.name,
        goal: generated.goal,
        rationale: generated.rationale,
        cautions: generated.cautions,
        daysPerWeek: days,
        weeks: 4,
        content: safeContent(generated.content, days, 4),
      });
    }

    if (req.method === "DELETE") {
      await db.query("delete from client_consults where id=$1", [id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
