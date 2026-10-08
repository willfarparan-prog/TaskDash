const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const MealIntake = require("../meal-intake");

test("the questionnaire keeps only known, valid answers", () => {
  const clean = MealIntake.cleanIntake({
    sex: "Man",
    age: "34",
    height: "70",
    weight: "",
    goals: [
      "Decrease Body Fat",
      "Made up",
      "Feel Better",
      "Tone Muscles",
      "Reduce Stress",
    ],
    skipMeals: "Maybe",
    proteinSources: "  chicken, steak, eggs ",
    hacker: "<script>",
  });
  assert.deepEqual(clean, {
    sex: "Man",
    age: 34,
    height: 70,
    goals: ["Decrease Body Fat", "Feel Better", "Tone Muscles"],
    proteinSources: "chicken, steak, eggs",
  });
});

test("answers reach the prompt under the APEX field names", () => {
  const profile = MealIntake.promptProfile(
    {
      sex: "Woman",
      weight: 140,
      proteinSources: "salmon",
      foodAllergiesList: "peanuts",
    },
    "Ana",
  );
  assert.deepEqual(profile, {
    first_name: "Ana",
    gender: "Woman",
    current_weight_lbs: 140,
    protein_sources: "salmon",
    allergy_details: "peanuts",
  });
});

test("the questionnaire covers the APEX nutrition questions plus the additions", () => {
  const keys = MealIntake.FIELDS.map((f) => f.key);
  for (const key of [
    "sex",
    "age",
    "height",
    "weight",
    "goals",
    "goalDirection",
    "trainingDays",
    "nutritionRating",
    "skipMeals",
    "mealsPerDay",
    "proteinSources",
    "fatSources",
    "carbSources",
    "lateNight",
    "whileEating",
    "pastFullness",
    "energyDrops",
    "energyDropsWhen",
    "knowCalories",
    "caloriesPerDay",
    "ownCooking",
    "workMeals",
    "otherReasons",
    "highFatSugar",
    "improvement1",
    "wantNutritionHelp",
    "foodAllergies",
    "foodAllergiesList",
  ])
    assert.ok(keys.includes(key), key);
});

test("the meal plan prompt is the APEX sports nutritionist prompt", () => {
  const {
    SPORTS_NUTRITIONIST_SYSTEM_PROMPT: p,
    userPrompt,
  } = require("../lib/mealPlan");
  assert.match(p, /^You are the world's most intelligent sports nutritionist/);
  assert.match(p, /Protein: 1\.3g per pound of bodyweight/);
  assert.match(p, /POST-WORKOUT snack/);
  assert.match(
    userPrompt({}, "Jo", "2026-10-07"),
    /week_start_date to 2026-10-05/,
  );
});

// Swap the API's database, session and generator modules for fakes.
function stub(rel, exports) {
  const file = require.resolve(path.join("..", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    handler({ headers: {}, query: {}, ...req }, res);
  });
}

test("generating a meal plan saves the answers, the plan and the checklist step", async () => {
  const queries = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.startsWith("select id, name from clients"))
          return { rows: [{ id: 7, name: "Jordan Lee" }] };
        if (sql.includes("insert into client_meal_plans"))
          return { rows: [{ id: 1, client_id: 7, plan: params[2] }] };
        return { rows: [], rowCount: 1 };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  let seen;
  stub("lib/mealPlan.js", {
    generateMealPlan: async (intake, firstName, dayKey) => {
      seen = { intake, firstName, dayKey };
      return {
        plan: { daily_calories: 2400, meals: [] },
        model: "test",
        usage: {},
      };
    },
  });
  process.env.ANTHROPIC_API_KEY = "test";
  delete require.cache[require.resolve("../lib/mealPlansApi.js")];
  const handler = require("../lib/mealPlansApi.js");
  const { code, body } = await call(handler, {
    method: "POST",
    body: {
      clientId: 7,
      dayKey: "2026-10-07",
      intake: { sex: "Man", age: "30", bogus: 1 },
    },
  });
  assert.equal(code, 201);
  assert.equal(body.plan.daily_calories, 2400);
  assert.deepEqual(seen, {
    intake: { sex: "Man", age: 30 },
    firstName: "Jordan",
    dayKey: "2026-10-07",
  });
  assert.ok(queries.some((q) => q.sql.includes("set nutrition_intake")));
  assert.ok(
    queries.some(
      (q) => q.sql.includes("'mealPlan'") && q.params[1] === "2026-10-07",
    ),
  );
});

test("new personal training clients start with the checklist", async () => {
  const inserts = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params) {
        if (sql.includes("insert into clients")) inserts.push(params);
        return { rows: [{ id: 1 }] };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve("../api/clients.js")];
  const handler = require("../api/clients.js");
  await call(handler, {
    method: "POST",
    body: {
      name: "A",
      serviceType: "Personal training",
      firstSession: "2026-10-12",
    },
  });
  await call(handler, {
    method: "POST",
    body: { name: "B", serviceType: "InBody scan" },
  });
  assert.deepEqual(inserts[0].slice(6), ["2026-10-12", {}]);
  assert.deepEqual(inserts[1].slice(6), [null, null]);
});

test("checklist steps are validated", async () => {
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      query: async () => ({
        rows: [{ id: 1, onboarding: { invoice: "2026-10-07" } }],
      }),
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve("../api/clients.js")];
  const handler = require("../api/clients.js");
  const bad = await call(handler, {
    method: "PATCH",
    query: { resource: "onboarding", id: "1" },
    body: { step: "hack", done: true },
  });
  assert.equal(bad.code, 400);
  const ok = await call(handler, {
    method: "PATCH",
    query: { resource: "onboarding", id: "1" },
    body: { step: "invoice", done: true },
  });
  assert.equal(ok.code, 200);
});
