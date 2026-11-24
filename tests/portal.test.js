// The client app API: a private key opens exactly one client's data.
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
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
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

const KEY = "a".repeat(32);
const CLIENT = {
  id: 7,
  name: "Jordan Lee",
  email: "jordan@example.com",
  portal_token: KEY,
  package_size: 10,
  package_start: "2026-11-01",
};

function setup(queries = []) {
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("from clients where portal_token"))
          return { rows: params[0] === KEY ? [CLIENT] : [] };
        if (sql.includes("from training_programs where id=$1 and client_id"))
          return {
            rows:
              params[0] === 11 && params[1] === 7
                ? [{ id: 11, name: "Jordan · Strength" }]
                : [],
          };
        if (sql.includes("from client_sessions"))
          return {
            rows: [
              {
                id: 1,
                client_id: 7,
                session_type: "Personal training",
                session_date: "2026-11-10",
              },
            ],
          };
        if (sql.startsWith("insert into workout_logs"))
          return { rows: [{ id: 50, source: "client" }] };
        if (sql.startsWith("delete from workout_logs"))
          return { rows: params[0] === 50 ? [{ id: 50 }] : [] };
        return { rows: [] };
      },
    }),
  });
  delete require.cache[require.resolve("../lib/routes/portal.js")];
  return require("../lib/routes/portal.js");
}

test("a missing, malformed or revoked key opens nothing", async () => {
  const handler = setup();
  for (const key of ["", "short", "b".repeat(32)]) {
    const r = await call(handler, {
      method: "GET",
      headers: { "x-client-key": key },
      query: { resource: "me" },
    });
    assert.equal(r.code, 401);
  }
});

test("the key opens that client's own data only", async () => {
  const queries = [];
  const handler = setup(queries);
  const r = await call(handler, {
    method: "GET",
    headers: { "x-client-key": KEY },
    query: { resource: "me" },
  });
  assert.equal(r.code, 200);
  assert.equal(r.body.client.firstName, "Jordan");
  assert.deepEqual(r.body.client.package, { size: 10, used: 1, left: 9 });
  // Never hands the key or coach-only fields back.
  assert.equal(JSON.stringify(r.body).includes(KEY), false);
  for (const q of queries.filter((q) =>
    /training_programs|workout_logs|client_sessions/.test(q.sql),
  ))
    assert.equal(q.params[0], 7);
  assert.match(
    queries.find((q) => q.sql.includes("training_programs")).sql,
    /not is_stock/,
  );
});

test("clients log workouts to their own programs only, marked as theirs", async () => {
  const queries = [];
  const handler = setup(queries);
  const entries = [
    {
      key: "A1",
      name: "Goblet Squat",
      sets: [{ weight: "45", reps: "10", done: true }],
    },
  ];
  const other = await call(handler, {
    method: "POST",
    headers: { "x-client-key": KEY },
    query: { resource: "workout" },
    body: { programId: 99, entries },
  });
  assert.equal(other.code, 404);
  const empty = await call(handler, {
    method: "POST",
    headers: { "x-client-key": KEY },
    query: { resource: "workout" },
    body: { programId: 11, entries: [{ name: "Row", sets: [{}] }] },
  });
  assert.equal(empty.code, 400);
  const ok = await call(handler, {
    method: "POST",
    headers: { "x-client-key": KEY },
    query: { resource: "workout" },
    body: { programId: 11, dayIndex: 1, weekIndex: 2, entries },
  });
  assert.equal(ok.code, 201);
  const insert = queries.find((q) =>
    q.sql.startsWith("insert into workout_logs"),
  );
  assert.match(insert.sql, /'finished','client'/);
  assert.equal(insert.params[0], 7);
  assert.equal(insert.params[2], "Jordan · Strength");
  // A client's own log never becomes a paid PT session.
  assert.equal(
    queries.some((q) => q.sql.includes("insert into client_sessions")),
    false,
  );
});

test("clients can delete only workouts they logged themselves", async () => {
  const queries = [];
  const handler = setup(queries);
  const r = await call(handler, {
    method: "DELETE",
    headers: { "x-client-key": KEY },
    query: { resource: "workout", id: "51" },
  });
  assert.equal(r.code, 404);
  const del = queries.find((q) => q.sql.startsWith("delete from workout_logs"));
  assert.match(del.sql, /client_id=\$2 and source='client'/);
  assert.deepEqual(del.params, [51, 7]);
});

test("cross-site writes are refused", async () => {
  const handler = setup();
  const r = await call(handler, {
    method: "POST",
    headers: { "x-client-key": KEY, "sec-fetch-site": "cross-site" },
    query: { resource: "workout" },
    body: {},
  });
  assert.equal(r.code, 403);
});

test("new client app keys are long, URL-safe and unique", () => {
  const { newPortalToken, KEY_PATTERN } = setup();
  const a = newPortalToken(),
    b = newPortalToken();
  assert.match(a, KEY_PATTERN);
  assert.equal(a.length, 32);
  assert.notEqual(a, b);
});
