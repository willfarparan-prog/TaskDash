const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const card = require("../db/stock-programs-training-card.json");
const first = require("../db/stock-programs.json");

const day = (name, dayName) =>
  card
    .find((p) => p.name === name)
    .content.days.find((d) => d.name === dayName);
const ex = (name, dayName, key) => {
  const d = day(name, dayName),
    b = d.blocks.find((x) => x.letter === key[0]);
  return b.exercises[Number(key[1]) - 1];
};

test("each training card becomes stock programs with unique names", () => {
  assert.equal(card.length, 14);
  const names = [...card, ...first].map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  for (const p of card) {
    assert.equal(p.days_per_week, p.content.days.length);
    assert.ok(p.content.days.length <= 7);
    for (const d of p.content.days) {
      assert.ok(d.blocks.length <= 8 && d.warmup.length <= 14);
      for (const b of d.blocks)
        for (const x of b.exercises) {
          assert.ok(x.sets >= 1 && x.sets <= 10);
          assert.equal(x.reps.length, 4);
          // Logged weights and Excel date serials must not leak into reps.
          for (const r of x.reps) {
            assert.doesNotMatch(r, /^4\d{4}$/);
            assert.ok(
              !(/^\d+$/.test(r) && Number(r) >= 30),
              `${p.name} ${x.name} ${r}`,
            );
          }
        }
    }
  }
});

test("sets, weekly reps and coaching notes follow the sheet", () => {
  const a1 = ex("Alex G · 2-Day Program", "Day 1", "A1");
  assert.equal(a1.name, "Plate Counterbalance Pistol Squat to Box");
  assert.equal(a1.sets, 3);
  assert.deepEqual(a1.reps, ["8/side", "4 × 8/side", "10/side", "4 × 10/side"]);
  assert.equal(a1.note, "Squat to box or Bench");
  const b1 = ex("Margaret Lovallo · 3-Day Program", "Day 1", "B1");
  assert.match(b1.note, /Week 3: Seat Ham Curl; Week 4: KB\/Plate Hug RDL/);
  assert.equal(b1.reps[2], "12, 15, 15, 12-15");
  assert.deepEqual(
    day("Xingjian · 4-Day Program", "Day 3").blocks[0].exercises.map(
      (x) => x.name,
    ),
    ["Trap Bar Deadlift", "Alt. Deadbug w/ DB Pullover"],
  );
  assert.equal(
    day("Margaret Lovallo · 2-Day Program · Block 2", "Mobility menu").blocks
      .length,
    4,
  );
});

test("the second library is imported once under its own marker", async () => {
  const { seedStockPrograms } = require("../lib/db");
  const meta = new Set(),
    names = [];
  const client = {
    async query(sql, params = []) {
      if (/^(begin|commit|rollback)$/.test(sql)) return { rows: [] };
      if (sql.includes("into app_meta")) {
        if (meta.has(params[0])) return { rows: [] };
        meta.add(params[0]);
        return { rows: [{ key: params[0] }] };
      }
      names.push(params[0]);
      return { rowCount: 1 };
    },
    release() {},
  };
  const db = { connect: async () => client };
  assert.equal(await seedStockPrograms(db), first.length);
  assert.equal(
    await seedStockPrograms(db, card, "stock_seed_trainingcard_v1"),
    14,
  );
  assert.equal(
    await seedStockPrograms(db, card, "stock_seed_trainingcard_v1"),
    0,
  );
  assert.equal(names.length, first.length + 14);
});

test("unfinished one-off tasks carry over and finished ones stay for the day", async () => {
  const calls = [];
  const file = require.resolve(path.join("..", "lib/db.js"));
  const realDb = require.cache[file];
  require.cache[file] = {
    id: file,
    filename: file,
    loaded: true,
    exports: {
      ensureWorkspaceSchema: async () => {},
      trackUsage: () => {},
      getPool: () => ({
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [] };
        },
      }),
    },
  };
  const sfile = require.resolve(path.join("..", "lib/session.js"));
  require.cache[sfile] = {
    id: sfile,
    filename: sfile,
    loaded: true,
    exports: { requireOwnerSession: () => true },
  };
  delete require.cache[require.resolve("../api/tasks.js")];
  const handler = require("../api/tasks.js");
  const run = (req) =>
    new Promise((resolve) =>
      handler(
        { headers: {}, query: {}, ...req },
        {
          setHeader() {},
          status() {
            return this;
          },
          json: resolve,
        },
      ),
    );
  await run({ method: "GET", query: { day: "2026-10-08" } });
  const daily = calls.find((c) => c.sql.includes("from daily_tasks"));
  assert.match(
    daily.sql,
    /day_key < \$1 and \(done = false or done_on = \$1\)/,
  );
  assert.deepEqual(daily.params, ["2026-10-08"]);
  await run({
    method: "PATCH",
    body: { kind: "daily_task", id: 4, done: true, dayKey: "2026-10-08" },
  });
  const patch = calls.at(-1);
  assert.match(patch.sql, /done_on = case when \$1 is true then \$4/);
  assert.deepEqual(patch.params, [true, null, 4, "2026-10-08"]);
  require.cache[file] = realDb;
});
