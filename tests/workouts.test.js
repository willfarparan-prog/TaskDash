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
      async connect() {
        return this;
      },
      release() {},
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
  delete require.cache[require.resolve("../lib/routes/workouts.js")];
  const handler = require("../lib/routes/workouts.js");
  const entries = [
    {
      key: "A1",
      name: "Trap Bar Deadlift",
      sets: [
        { weight: "185", reps: "6", done: true },
        { weight: "", reps: "", done: false },
      ],
    },
    {
      key: "A2",
      name: "Depth Drop to VJ",
      sets: [{ weight: "", reps: "", done: false }],
    },
  ];
  const first = await call(handler, {
    method: "PATCH",
    query: { id: "5" },
    body: {
      entries,
      notes: "Strong pulls",
      finish: true,
      dayKey: "2026-10-07",
    },
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
  await call(handler, {
    method: "PATCH",
    query: { id: "5" },
    body: { entries, finish: true },
  });
  assert.equal(sessions.length, 1);
});

test("suggested weights are kept with each set, and history is deep enough", async () => {
  let listSql = "";
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async connect() {
        return this;
      },
      release() {},
      async query(sql, params) {
        if (sql.startsWith("select * from workout_logs")) {
          listSql = sql;
          return { rows: [] };
        }
        if (sql.startsWith("select id from clients"))
          return { rows: [{ id: 3 }] };
        if (sql.startsWith("insert into workout_logs"))
          return { rows: [{ id: 1, entries: JSON.parse(params[6]) }] };
        return { rows: [] };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve("../lib/routes/workouts.js")];
  const handler = require("../lib/routes/workouts.js");
  const created = await call(handler, {
    method: "POST",
    body: {
      clientId: 3,
      entries: [
        {
          key: "A1",
          name: "Bench",
          sets: [{ weight: "", reps: "", suggest: "135", done: false }],
        },
      ],
    },
  });
  assert.equal(created.code, 201);
  assert.equal(created.body.entries[0].sets[0].suggest, "135");
  assert.equal(created.body.entries[0].sets[0].weight, ""); // a suggestion is not a logged weight
  await call(handler, { method: "GET", query: { clientId: "3" } });
  assert.match(listSql, /limit 200/);
});

test("a failed finish rolls back both history and log changes", async () => {
  const { load, response } = require("./helpers");
  const statements = [];
  let released = false;
  const tx = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith("update workout_logs set entries"))
        return {
          rows: [
            {
              id: 5,
              client_id: 3,
              status: "in_progress",
              started_at: new Date().toISOString(),
            },
          ],
        };
      if (sql.includes("insert into client_sessions"))
        return { rows: [{ id: 99 }] };
      if (sql.includes("set status='finished'"))
        throw Error("Storage interrupted");
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const { exports: handler } = load("lib/routes/workouts.js", {
    "../db": {
      ensureWorkspaceSchema: async () => {},
      getPool: () => ({ connect: async () => tx }),
      trackUsage() {},
    },
    "../session": { requireOwnerSession: () => true },
  });
  const res = response();
  await handler(
    {
      method: "PATCH",
      query: { id: "5" },
      body: { entries: [], finish: true },
    },
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
  assert.ok(released);
});

test("concurrent finish requests hold the log lock until history commits", async () => {
  const { load, response } = require("./helpers");
  let log = {
      id: 5,
      client_id: 3,
      status: "in_progress",
      started_at: new Date().toISOString(),
    },
    sessions = 0;
  let lock = Promise.resolve();
  const pool = {
    async connect() {
      let active = false,
        unlock;
      return {
        async query(sql, params) {
          if (sql === "BEGIN") {
            active = true;
            return { rows: [] };
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            active = false;
            unlock?.();
            return { rows: [] };
          }
          assert.ok(active, "writes must be inside the transaction");
          if (sql.startsWith("update workout_logs set entries")) {
            const previous = lock;
            lock = new Promise((r) => (unlock = r));
            await previous;
            return { rows: [{ ...log }] };
          }
          if (sql.includes("insert into client_sessions")) {
            sessions++;
            await new Promise((r) => setImmediate(r));
            return { rows: [{ id: 99 }] };
          }
          if (sql.includes("set status='finished'")) {
            log = { ...log, status: "finished", session_id: params[1] };
            return { rows: [{ ...log }] };
          }
          return { rows: [] };
        },
        release() {
          assert.equal(active, false);
        },
      };
    },
  };
  const { exports: handler } = load("lib/routes/workouts.js", {
    "../db": {
      ensureWorkspaceSchema: async () => {},
      getPool: () => pool,
      trackUsage() {},
    },
    "../session": { requireOwnerSession: () => true },
  });
  const one = response(),
    two = response(),
    req = {
      method: "PATCH",
      query: { id: "5" },
      body: { entries: [], finish: true },
    };
  await Promise.all([handler(req, one), handler(req, two)]);
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200);
  assert.equal(sessions, 1);
  assert.equal(two.body.session_id, 99);
});
