const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

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

test("finishing a live session logs it to the client's history once", async () => {
  const log = {
    id: 5,
    client_id: 3,
    program_name: "Jordan · Program",
    day_index: 1,
    day_name: "Day 2",
    week_index: 0,
    status: "in_progress",
    started_at: new Date(Date.now() - 50 * 60000).toISOString(),
  };
  const sessions = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params) {
        if (sql.startsWith("update workout_logs set entries")) {
          log.entries = JSON.parse(params[1]);
          log.notes = params[2];
          return { rows: [{ ...log }] };
        }
        if (sql.includes("insert into client_sessions")) {
          sessions.push(params);
          return { rows: [{ id: 99 }] };
        }
        if (sql.includes("set status='finished'")) {
          log.status = "finished";
          log.session_id = params[1];
          return { rows: [{ ...log }] };
        }
        return { rows: [] };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve("../lib/workoutsApi.js")];
  const handler = require("../lib/workoutsApi.js");
  const entries = [
    { key: "A1", name: "Trap Bar Deadlift", sets: [{ weight: "185", reps: "6", done: true }, { weight: "", reps: "", done: false }] },
    { key: "A2", name: "Depth Drop to VJ", sets: [{ weight: "", reps: "", done: false }] },
  ];
  const first = await call(handler, {
    method: "PATCH",
    query: { id: "5" },
    body: { entries, notes: "Strong pulls", finish: true, dayKey: "2026-10-07" },
  });
  assert.equal(first.code, 200);
  assert.equal(first.body.status, "finished");
  assert.equal(sessions.length, 1);
  const [clientId, day, minutes, notes] = sessions[0];
  assert.equal(clientId, 3);
  assert.equal(day, "2026-10-07");
  assert.ok(minutes >= 49 && minutes <= 51);
  assert.match(notes, /Day 2 · Week 1 · 1 exercise logged\nStrong pulls/);
  // A second finish (double click) doesn't log another session.
  await call(handler, { method: "PATCH", query: { id: "5" }, body: { entries, finish: true } });
  assert.equal(sessions.length, 1);
});
