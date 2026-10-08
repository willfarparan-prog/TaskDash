const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../js/progress");

const set = (weight, reps, done = true) => ({ weight, reps, done });
let id = 0;
// Newest first, like GET /api/workouts.
const log = (over) => ({
  id: ++id,
  program_id: 7,
  day_index: 0,
  week_index: 0,
  status: "finished",
  started_at: "2026-10-01T17:00:00Z",
  entries: [],
  ...over,
});

const content = {
  days: [
    {
      name: "Day 1",
      blocks: [
        { letter: "A", exercises: [{ name: "Trap Bar Deadlift", sets: 4, reps: ["6", "6", "5", "5"], note: "" }, { name: "Push-up", sets: 3, reps: ["10", "10", "12", "12"], note: "" }] },
        { letter: "B", exercises: [{ name: "Split Squat", sets: 3, reps: ["8", "8", "8", "8"], note: "" }] },
      ],
    },
    { name: "Day 2", blocks: [{ letter: "A", exercises: [{ name: "Bench", sets: 3, reps: ["8", "8", "8", "8"], note: "" }] }] },
  ],
};

test("weights read numbers out of free text and ignore bodyweight", () => {
  assert.equal(P.weightOf("135"), 135);
  assert.equal(P.weightOf("62.5 kg"), 62.5);
  assert.equal(P.weightOf("1,200"), 1200);
  assert.equal(P.weightOf("BW"), null);
  assert.equal(P.weightOf(""), null);
  assert.equal(P.weightOf("0"), null);
});

test("next day follows the last finished session, then wraps by week", () => {
  assert.deepEqual(P.nextDay(2, 4, [], 7), { day: 0, week: 0, complete: false });
  assert.deepEqual(P.nextDay(2, 4, [log({ day_index: 0, week_index: 0 })], 7), { day: 1, week: 0, complete: false });
  assert.deepEqual(P.nextDay(2, 4, [log({ day_index: 1, week_index: 0 })], 7), { day: 0, week: 1, complete: false });
  // An unfinished session or another program's session doesn't move it.
  assert.deepEqual(P.nextDay(2, 4, [log({ status: "in_progress" }), log({ program_id: 9, day_index: 1 })], 7), { day: 0, week: 0, complete: false });
  // After the final day of the final week the program is complete.
  assert.deepEqual(P.nextDay(2, 4, [log({ day_index: 1, week_index: 3 })], 7), { day: 0, week: 3, complete: true });
});

test("the program grid counts finished and open sessions and finds what's next", () => {
  const logs = [
    log({ day_index: 0, week_index: 1 }),
    log({ day_index: 1, week_index: 0, status: "in_progress" }),
    log({ day_index: 1, week_index: 0 }),
    log({ day_index: 0, week_index: 0 }),
    log({ program_id: 99, day_index: 0, week_index: 2 }),
  ];
  const g = P.programProgress({ id: 7, weeks: 4 }, logs, content);
  assert.deepEqual(g.days, ["Day 1", "Day 2"]);
  assert.equal(g.total, 8);
  assert.equal(g.done, 3);
  assert.deepEqual(g.cells[0][0], { finished: 1, open: false });
  assert.deepEqual(g.cells[1][0], { finished: 1, open: true });
  assert.deepEqual(g.cells[0][2], { finished: 0, open: false }); // other program's log
  assert.deepEqual(g.next, { day: 1, week: 1, complete: false });
});

test("exercise history keeps each session's top set and flags a new best", () => {
  const logs = [
    log({ started_at: "2026-10-15T17:00:00Z", entries: [{ name: "Trap Bar Deadlift", sets: [set("225", "5"), set("245", "5"), set("", "", false)] }] }),
    log({ started_at: "2026-10-08T17:00:00Z", entries: [{ name: "trap bar deadlift", sets: [set("225", "5"), set("235", "4")] }] }),
    log({ started_at: "2026-10-01T17:00:00Z", entries: [{ name: "Trap Bar Deadlift", sets: [set("205", "6")] }, { name: "Push-up", sets: [set("", "12")] }] }),
    log({ started_at: "2026-10-20T17:00:00Z", status: "in_progress", entries: [{ name: "Trap Bar Deadlift", sets: [set("400", "1")] }] }),
  ];
  const [dl, pu] = P.exerciseHistory(logs);
  assert.equal(dl.sessions.length, 3); // unfinished session ignored
  assert.deepEqual(dl.trend, [205, 235, 245]);
  assert.equal(dl.best, 245);
  assert.equal(dl.pr, true);
  assert.deepEqual({ w: dl.last.weight, r: dl.last.reps, sets: dl.last.sets }, { w: 245, r: 5, sets: 2 });
  // Bodyweight work is tracked without a weight and never a PR.
  assert.equal(pu.sessions[0].weight, null);
  assert.equal(pu.sessions[0].reps, 12); // shows reps instead of a weight
  assert.equal(pu.pr, false);
});

test("a lower weight than before is not a PR", () => {
  const logs = [
    log({ entries: [{ name: "Bench", sets: [set("135", "8")] }] }),
    log({ started_at: "2026-09-24T17:00:00Z", entries: [{ name: "Bench", sets: [set("155", "5")] }] }),
  ];
  assert.equal(P.exerciseHistory(logs)[0].pr, false);
});

test("suggestions come from the latest earlier session with numbers", () => {
  const logs = [
    log({ id: 30, entries: [{ name: "Bench", sets: [set("", "", false)] }] }), // nothing logged
    log({ id: 20, entries: [{ name: "BENCH", sets: [set("135", "8"), set("145", "6")] }] }),
    log({ id: 10, entries: [{ name: "Bench", sets: [set("95", "10")] }] }),
  ];
  assert.deepEqual(P.suggestWeights("Bench", logs, 4), ["135", "145", "145", "145"]);
  assert.deepEqual(P.suggestWeights("Bench", logs, 1), ["135"]);
  // Resuming a session never suggests from itself.
  assert.deepEqual(P.suggestWeights("Bench", logs, 2, 20), ["95", "95"]);
  assert.deepEqual(P.suggestWeights("Squat", logs, 3), []);
  // Bodyweight-only history gives no suggestion.
  assert.deepEqual(P.suggestWeights("Pull-up", [log({ entries: [{ name: "Pull-up", sets: [set("", "8")] }] })], 3), []);
});

test("new entries get the next free key in their block", () => {
  const entries = [{ key: "A1" }, { key: "A2" }, { key: "B1" }];
  assert.equal(P.nextEntryKey(entries, "A"), "A3");
  assert.equal(P.nextEntryKey(entries, "B"), "B2");
  assert.equal(P.nextEntryKey(entries, "Z"), "C1"); // unknown block → next free letter
  assert.equal(P.nextEntryKey([], "A"), "A1");
});

test("swap, remove and add change a copy of the program and nothing else", () => {
  const before = JSON.stringify(content);
  const swapped = P.applyLiveEdit(content, 0, { type: "swap", key: "A2", name: "Incline Push-up" }, 4);
  assert.equal(swapped.days[0].blocks[0].exercises[1].name, "Incline Push-up");
  assert.deepEqual(swapped.days[0].blocks[0].exercises[1].reps, ["10", "10", "12", "12"]); // week cells kept

  const removed = P.applyLiveEdit(content, 0, { type: "remove", key: "B1" }, 4);
  assert.equal(removed.days[0].blocks.length, 1); // an emptied block goes too

  const added = P.applyLiveEdit(content, 1, { type: "add", name: "Face Pull", sets: 3, reps: "12", block: "A" }, 4);
  const ex = added.days[1].blocks[0].exercises.at(-1);
  assert.deepEqual({ ...ex }, { name: "Face Pull", sets: 3, reps: ["12", "12", "12", "12"], note: "" });

  // Found by name, so earlier removals that shifted positions don't misdirect it.
  const shifted = P.applyLiveEdit(
    P.applyLiveEdit(content, 0, { type: "remove", key: "A1", from: "Trap Bar Deadlift" }, 4),
    0,
    { type: "swap", key: "A2", from: "Push-up", name: "Ring Row" },
    4,
  );
  assert.deepEqual(shifted.days[0].blocks[0].exercises.map((x) => x.name), ["Ring Row"]);

  assert.equal(P.applyLiveEdit(content, 0, { type: "swap", key: "A9", name: "x" }), null);
  assert.equal(P.applyLiveEdit(content, 5, { type: "remove", key: "A1" }), null);
  assert.equal(P.applyLiveEdit(content, 0, { type: "add", name: "  " }), null);
  assert.equal(JSON.stringify(content), before, "the original content is never mutated");
});

test("trend line needs two points and stays inside its box", () => {
  assert.equal(P.sparkPoints([135]), "");
  const pts = P.sparkPoints([100, 150, 125], 72, 22).split(" ").map((p) => p.split(",").map(Number));
  assert.equal(pts.length, 3);
  assert.equal(pts[0][0], 0);
  assert.equal(pts[2][0], 72);
  for (const [, y] of pts) assert.ok(y >= 0 && y <= 22);
});
