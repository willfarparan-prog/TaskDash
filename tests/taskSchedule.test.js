const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../task-schedule");
const day = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
// Tasks default to being created on the day checked, so earlier cycles
// can't show as overdue unless a test says so.
const show = (rule, on, checks = [], created = on) =>
  S.occurrenceOn(rule, day(on), checks, created);

test("weekday tasks show Monday to Friday only", () => {
  const rule = { cadence: "Weekdays" };
  assert.equal(show(rule, "2026-10-07").periodKey, "2026-10-07"); // Wed
  assert.equal(show(rule, "2026-10-10"), null); // Sat
});

test("a monthly task stays hidden once its cycle is checked off", () => {
  const news = { cadence: "Monthly", monthDay: 15, leadDays: 3 };
  assert.equal(show(news, "2026-10-11"), null);
  const first = show(news, "2026-10-12");
  assert.equal(first.periodKey, "2026-10-15");
  assert.equal(first.done, false);
  // Checked on the 12th under the new due-date key…
  assert.equal(show(news, "2026-10-13", ["2026-10-15"]).done, true);
  assert.equal(show(news, "2026-10-13", ["2026-10-15"], "2026-10-01").done, true);
  // …or under an old day-based key: both count for the cycle.
  assert.equal(show(news, "2026-10-14", ["2026-10-12"]).done, true);
  assert.equal(show(news, "2026-10-20", ["2026-10-15"]), null);
});

test("a missed cycle carries over as overdue until it is done", () => {
  const news = { cadence: "Monthly", monthDay: 15, leadDays: 3 };
  const late = show(news, "2026-10-20", [], "2026-10-01");
  assert.equal(late.overdue, true);
  assert.equal(late.periodKey, "2026-10-15");
  // Cycles that ended before the task existed never show as overdue.
  assert.equal(show(news, "2026-10-20", [], "2026-10-18"), null);
});

test("every-2-weeks tasks follow their start date", () => {
  const rule = { cadence: "Biweekly", anchorDate: "2026-10-09", leadDays: 2 };
  assert.equal(S.normalizeSchedule(rule).weekday, 5);
  assert.equal(S.isDue(rule, day("2026-10-09")), true);
  assert.equal(S.isDue(rule, day("2026-10-16")), false);
  assert.equal(S.isDue(rule, day("2026-10-23")), true);
  assert.equal(S.isDue(rule, day("2026-09-25")), true);
  assert.equal(show(rule, "2026-10-14"), null);
  assert.equal(show(rule, "2026-10-14", [], "2026-10-01").overdue, true);
  assert.equal(show(rule, "2026-10-21").periodKey, "2026-10-23");
});

test("last-day-of-month and short months", () => {
  const eom = { cadence: "Monthly", monthDay: 0, leadDays: 6 };
  assert.equal(show(eom, "2026-02-22").periodKey, "2026-02-28");
  assert.equal(show(eom, "2026-02-21"), null);
  const the31st = { cadence: "Monthly", monthDay: 31 };
  assert.equal(S.isDue(the31st, day("2026-04-30")), true);
});

test("weekly tasks with a lead show across the window", () => {
  const lab = { cadence: "Weekly", weekday: 5, leadDays: 2 };
  assert.equal(show(lab, "2026-10-06"), null); // Tue
  assert.equal(show(lab, "2026-10-07").daysUntil, 2); // Wed
  assert.equal(S.dueLabel(show(lab, "2026-10-08")), "Due tomorrow");
  assert.equal(S.describe(lab), "Weekly on Fri · shows 2d early");
});

test("built-in duties keep their ids and old timing", () => {
  const ids = S.BUILTIN_TASKS.map((t) => t.id);
  assert.deepEqual(ids, [
    "wr-am", "inbox", "wr-pm", "workday", "board", "lab",
    "glove", "meeting", "news", "fdt", "class",
  ]);
  const fdt = S.BUILTIN_TASKS.find((t) => t.id === "fdt");
  // Old rule: from 6 days before month end through the last day.
  assert.equal(show(fdt, "2026-10-24"), null);
  assert.equal(show(fdt, "2026-10-25").periodKey, "2026-10-31");
});

test("bad input falls back to safe values", () => {
  const r = S.normalizeSchedule({ cadence: "Yearly", leadDays: 99 });
  assert.equal(r.cadence, "Daily");
  assert.equal(r.leadDays, 0);
  assert.equal(S.normalizeSchedule({ cadence: "Weekly", lead_days: "3", weekday: "2" }).leadDays, 3);
});

test("built-in duties are copied into the database only once", async () => {
  const { seedBuiltinTasks } = require("../lib/db");
  const meta = new Set(),
    rows = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes("into app_meta")) {
        if (meta.has("seed")) return { rows: [] };
        meta.add("seed");
        return { rows: [{ key: "seed" }] };
      }
      rows.push(params);
      return { rowCount: 1 };
    },
  };
  assert.equal(await seedBuiltinTasks(db), 11);
  assert.equal(await seedBuiltinTasks(db), 0);
  const fdt = rows.find((r) => r[0] === "fdt");
  // id, name, cadence, weekday, month_day, anchor_date, lead_days, time_label, sort
  assert.deepEqual(fdt.slice(2), ["Monthly", null, 0, null, 6, "Last week", 10]);
});
