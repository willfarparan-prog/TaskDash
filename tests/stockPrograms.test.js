const test = require("node:test");
const assert = require("node:assert/strict");

const programs = require("../db/stock-programs.json");
const { seedStockPrograms } = require("../lib/db");

const exercises = (p) =>
  p.content.days.flatMap((d) => d.blocks.flatMap((b) => b.exercises));
const dayNames = (p, day) =>
  p.content.days[day].blocks.flatMap((b) => b.exercises.map((x) => x.name));
const byKey = (key) => programs.find((p) => p.key === key);

test("every spreadsheet row becomes one uniquely named stock program", () => {
  assert.equal(programs.length, 46);
  assert.equal(new Set(programs.map((p) => p.key)).size, programs.length);
  assert.equal(
    new Set(programs.map((p) => p.name.toLowerCase())).size,
    programs.length,
  );
});

test("programs fit the limits the programs API enforces", () => {
  for (const p of programs) {
    assert.ok(p.name.length && p.name.length <= 120, p.name);
    assert.equal(p.weeks, 4);
    assert.equal(p.days_per_week, p.content.days.length);
    assert.ok(p.content.days.length >= 1 && p.content.days.length <= 7);
    for (const day of p.content.days) {
      assert.ok(day.blocks.length && day.blocks.length <= 8);
      day.blocks.forEach((b, i) => {
        assert.equal(b.letter, String.fromCharCode(65 + i));
        assert.ok(b.exercises.length && b.exercises.length <= 8);
      });
    }
    for (const x of exercises(p)) {
      assert.ok(x.name && x.name.length <= 120);
      assert.ok(x.note.length <= 300);
      assert.ok(Number.isInteger(x.sets) && x.sets >= 1 && x.sets <= 10);
      assert.equal(x.reps.length, 4);
      for (const r of x.reps) {
        assert.ok(r.length <= 40);
        // Excel date serials (e.g. 45879 for "8-10") must have been converted.
        assert.doesNotMatch(r, /^4\d{4}$/);
      }
    }
  }
});

test("exercise order follows the sheet's A1, A2, A3, B1… columns", () => {
  assert.deepEqual(dayNames(byKey("tcnexus-row-37"), 1).slice(0, 3), [
    "Trap Bar Deadlift",
    "Depth Drop to VJ",
    "Band Assisted VJ",
  ]);
  // Row 98 Day 1 leaves slot D2 empty; D3 moves up to D2.
  const d = byKey("tcnexus-row-98").content.days[0].blocks[3].exercises;
  assert.deepEqual(
    d.map((x) => x.name),
    ["DB Goblet SL Squat to Bench", "2-DB Straight Leg Sit-up"],
  );
  assert.deepEqual(d[1].reps, ["10", "10", "12-15", "12-15"]);
});

test("weeks 3-4 show a changed set count next to the reps", () => {
  const press = byKey("tcnexus-row-37").content.days[0].blocks[1].exercises[0];
  assert.equal(press.name, "1-DB Bench Press");
  assert.equal(press.sets, 3);
  assert.deepEqual(press.reps, ["8/side", "8/side", "4 × 6/side", "4 × 6/side"]);
});

function fakeDb(existingNames = []) {
  const meta = new Set();
  const rows = existingNames.map((name) => ({ name, is_stock: true }));
  const client = {
    async query(sql, params = []) {
      if (/^(begin|commit|rollback)$/.test(sql)) return { rows: [] };
      if (sql.includes("into app_meta")) {
        if (meta.has(params[0])) return { rows: [], rowCount: 0 };
        meta.add(params[0]);
        return { rows: [{ key: params[0] }], rowCount: 1 };
      }
      if (sql.includes("into training_programs")) {
        const taken = rows.some(
          (r) => r.is_stock && r.name.toLowerCase() === params[0].toLowerCase(),
        );
        if (taken) return { rows: [], rowCount: 0 };
        rows.push({ name: params[0], is_stock: true });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    release() {},
  };
  return { rows, connect: async () => client };
}

test("the stock seed runs once and skips names already in the library", async () => {
  const db = fakeDb([programs[0].name.toUpperCase()]);
  assert.equal(await seedStockPrograms(db), programs.length - 1);
  assert.equal(db.rows.length, programs.length);
  assert.equal(await seedStockPrograms(db), 0);
  assert.equal(db.rows.length, programs.length);
});
