// /api/meal-plans — client meal plans built from the nutrition questionnaire
// with the APEX Coach meal plan prompt (lib/mealPlan.js). Generating also
// saves the client's answers and ticks the meal plan step of the checklist.

const { getPool, ensureWorkspaceSchema, trackUsage } = require("../db");
const { requireOwnerSession } = require("../session");
const { cleanIntake } = require("../../meal-intake");
const { isDate } = require("../validate");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();

    if (req.method === "GET") {
      const clientId = Number(req.query.clientId);
      const result =
        Number.isInteger(clientId) && clientId > 0
          ? await db.query(
              "select * from client_meal_plans where client_id=$1 order by created_at desc",
              [clientId],
            )
          : await db.query(
              "select id, client_id, created_at from client_meal_plans order by created_at desc",
            );
      return res.status(200).json({ mealPlans: result.rows });
    }

    if (req.method === "POST") {
      const clientId = Number(req.body?.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0)
        return res.status(400).json({ error: "Choose a client first" });
      const found = await db.query("select id, name from clients where id=$1", [
        clientId,
      ]);
      if (!found.rows[0])
        return res.status(404).json({ error: "Client not found" });
      const intake = cleanIntake(req.body?.intake);
      // Answers are kept even if generation fails, so nothing is retyped.
      await db.query(
        "update clients set nutrition_intake=$2, updated_at=now() where id=$1",
        [clientId, intake],
      );
      if (!process.env.ANTHROPIC_API_KEY)
        return res
          .status(503)
          .json({ error: "Meal plans need ANTHROPIC_API_KEY on the server." });
      const dayKey = isDate(req.body?.dayKey)
        ? req.body.dayKey
        : new Date().toISOString().slice(0, 10);
      const { generateMealPlan } = require("../mealPlan");
      const firstName = String(found.rows[0].name).split(/\s+/)[0];
      let generated;
      try {
        generated = await generateMealPlan(intake, firstName, dayKey);
      } catch (err) {
        trackUsage("Claude API", "Generate meal plan", "error");
        throw err;
      }
      const saved = await db.query(
        `insert into client_meal_plans (client_id, intake, plan, model) values ($1,$2,$3,$4) returning *`,
        [clientId, intake, generated.plan, generated.model],
      );
      await db.query(
        `update clients set onboarding = onboarding || jsonb_build_object('mealPlan', $2::text)
         where id=$1 and onboarding is not null and not onboarding ? 'mealPlan'`,
        [clientId, dayKey],
      );
      trackUsage("Claude API", "Generate meal plan", "ok", generated.usage);
      return res.status(201).json(saved.rows[0]);
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Meal plan id is required" });
      await db.query("delete from client_meal_plans where id=$1", [id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
