const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/consult-intake");
const P = require("../js/consult-program-core");

test("the form covers William's 14 questions plus the added ones", () => {
  const keys = C.FIELDS.map((f) => f.key);
  for (const k of [
    "name", "dob", "height", "weight", "injuries", "gymInjuries", "averageDay",
    "supplements", "weightProgram", "workedBest", "likeMost", "likeLeast",
    "conditioning", "goal", "motivation",
  ])
    assert.ok(keys.includes(k), `missing ${k}`);
  for (const k of ["experience", "barbell", "avoid", "targetDate", "measurableGoal", "successIn3"])
    assert.ok(keys.includes(k), `missing added ${k}`);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  const sections = C.SECTIONS.map((s) => s.key);
  for (const f of C.FIELDS) assert.ok(sections.includes(f.section), `${f.key} has no section`);
});

test("answers are cleaned: known keys only, trimmed, capped, choices checked", () => {
  const out = C.cleanConsult({
    name: "  Jordan Lee ",
    height: "70",
    weight: "-5",
    dob: "1990-05-17",
    sex: "Robot",
    experience: "1 to 3 years",
    goal: "x".repeat(5000),
    injuries: "   ",
    evil: "<script>",
  });
  assert.equal(out.name, "Jordan Lee");
  assert.equal(out.height, 70);
  assert.equal(out.weight, undefined);
  assert.equal(out.dob, "1990-05-17");
  assert.equal(out.sex, undefined);
  assert.equal(out.experience, "1 to 3 years");
  assert.equal(out.goal.length, 1500);
  assert.equal("injuries" in out, false);
  assert.equal("evil" in out, false);
  assert.equal(C.cleanConsult({ dob: "May 17" }).dob, undefined);
});

test("age comes from the birth date and the meal questionnaire is pre-filled", () => {
  const today = new Date(2026, 9, 8); // Oct 8, 2026
  assert.equal(C.ageFrom("1990-10-08", today), 36);
  assert.equal(C.ageFrom("1990-10-09", today), 35);
  assert.equal(C.ageFrom("nope", today), null);
  assert.equal(C.ageFrom("2030-01-01", today), null);
  const meal = C.mealIntakeFrom(
    { dob: "1990-01-01", height: 68, weight: 190, sex: "Man", averageDay: "Desk job" },
    4,
  );
  assert.equal(meal.height, 68);
  assert.equal(meal.weight, 190);
  assert.equal(meal.sex, "Man");
  assert.equal(meal.trainingDays, "4");
  assert.equal(meal.averageDay, "Desk job");
  assert.equal(C.mealIntakeFrom({}, null).trainingDays, undefined);
});

test("the prompt profile leaves out the birth date but keeps the age", () => {
  const p = C.promptProfile({ name: "Jo", dob: "1990-01-01", goal: "Get strong" });
  assert.equal(p.date_of_birth, undefined);
  assert.ok(p.age > 0);
  assert.equal(p.ultimate_goal, "Get strong");
});

const stock = (name, days, emphasis, extra = {}) => ({
  id: name,
  name,
  is_stock: true,
  days_per_week: days,
  emphasis,
  goal: "",
  ...extra,
});
const library = [
  stock("Strength 3-day", 3, "Strength"),
  stock("Strength 4-day", 4, "Strength"),
  stock("Size 4-day", 4, "Hypertrophy"),
  stock("Power 4-day", 4, "Power"),
  stock("Movement 3-day", 3, "Movement quality"),
  stock("3-Day Pattern Template", 3, "Strength", { goal: "Movement-pattern outline — fill in exercises" }),
  { ...stock("Client copy", 3, "Strength"), is_stock: false },
];

test("matches follow the days asked for and the goal's wording", () => {
  const top = P.rankStockPrograms(
    { goal: "I want to build muscle and get bigger", experience: "1 to 3 years" },
    library,
    4,
  );
  assert.equal(top[0].program.name, "Size 4-day");
  assert.match(top[0].reason, /4 days a week, as requested/);
  assert.match(top[0].reason, /hypertrophy focus fits/);
  assert.equal(top.length, 3);
});

test("outlines and client programs are never suggested", () => {
  const names = P.rankStockPrograms({ goal: "get strong" }, library, 3, 10).map((m) => m.program.name);
  assert.equal(names.includes("3-Day Pattern Template"), false);
  assert.equal(names.includes("Client copy"), false);
});

test("newer lifters and injury history steer away from power work", () => {
  const top = P.rankStockPrograms(
    { goal: "feel better and stay healthy", experience: "New to training", injuries: "Left knee, 2022" },
    library,
    4,
  );
  assert.notEqual(top[0].program.emphasis, "Power");
  const power = P.rankStockPrograms({ goal: "feel better", experience: "New to training" }, library, 4, 10).find(
    (m) => m.program.emphasis === "Power",
  );
  assert.ok(power.score < top[0].score);
});

test("with no goal wording or days the order is still stable", () => {
  const a = P.rankStockPrograms({}, library, null).map((m) => m.program.name);
  const b = P.rankStockPrograms({}, [...library].reverse(), null).map((m) => m.program.name);
  assert.deepEqual(a, b);
  assert.ok(P.rankStockPrograms({}, library, null)[0].reason.length > 0);
});
