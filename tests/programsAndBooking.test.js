const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function stub(rel, exports) {
  const file = require.resolve(path.join("..", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
// Loads a route handler against a fake database that answers by SQL prefix.
function load(route, answer) {
  const queries = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params = []) {
        queries.push({ sql, params });
        return answer(sql, params) || { rows: [], rowCount: 0 };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve(`../lib/routes/${route}.js`)];
  return { handler: require(`../lib/routes/${route}.js`), queries };
}
function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ code: this.statusCode, body });
      },
    };
    handler({ headers: {}, query: {}, ...req }, res);
  });
}

test("saving a stock template refuses a name that's already taken", async () => {
  const { handler } = load("programs", (sql) => {
    if (sql.startsWith("select * from training_programs where id"))
      return { rows: [{ id: 5, name: "Jordan block" }] };
    if (sql.includes("lower(name)=lower($1)")) return { rows: [{ id: 9 }] };
  });
  const { code, body } = await call(handler, {
    method: "POST",
    body: {
      action: "save_as_stock",
      sourceId: 5,
      name: "ALEX G · 2-day program",
    },
  });
  assert.equal(code, 409);
  assert.match(body.error, /already exists/);
});

test("using a template makes a draft copy named for the client", async () => {
  const { handler, queries } = load("programs", (sql) => {
    if (sql.startsWith("select * from training_programs where id"))
      return { rows: [{ id: 11, name: "Vivian Le · 3-Day Program" }] };
    if (sql.startsWith("select id,name from clients where id"))
      return { rows: [{ id: 3, name: "Priya Shah" }] };
    if (sql.startsWith("insert into training_programs"))
      return { rows: [{ id: 99 }] };
  });
  const { code } = await call(handler, {
    method: "POST",
    body: { action: "use_template", sourceId: 11, clientId: 3 },
  });
  assert.equal(code, 201);
  // The source is only read, and only if it really is a stock template.
  const read = queries.find((q) => q.sql.startsWith("select * from training"));
  assert.deepEqual(read.params, [11, true]);
  const insert = queries.find((q) => q.sql.startsWith("insert into"));
  assert.deepEqual(insert.params, [
    "Priya Shah — Vivian Le · 3-Day Program",
    3,
    "Priya Shah",
    11,
    "draft",
  ]);
  assert.match(insert.sql, /content,false,id/);
  assert.equal(
    queries.filter((q) => /^(update|delete)/.test(q.sql)).length,
    0,
    "the template is never modified",
  );
});

test("attaching from a client profile can start the copy as active", async () => {
  const { handler, queries } = load("programs", (sql) => {
    if (sql.startsWith("select * from training_programs where id"))
      return { rows: [{ id: 11, name: "Foundation" }] };
    if (sql.startsWith("select id,name from clients where id"))
      return { rows: [{ id: 3, name: "Priya Shah" }] };
    if (sql.startsWith("insert into training_programs"))
      return { rows: [{ id: 99 }] };
  });
  await call(handler, {
    method: "POST",
    body: { action: "use_template", sourceId: 11, clientId: 3, status: "active" },
  });
  assert.equal(queries.find((q) => q.sql.startsWith("insert into")).params[4], "active");
  // An unknown status falls back to draft instead of being stored.
  await call(handler, {
    method: "POST",
    body: { action: "use_template", sourceId: 11, clientId: 3, status: "weird" },
  });
  assert.equal(queries.filter((q) => q.sql.startsWith("insert into")).at(-1).params[4], "draft");
});

test("copying a client's program to another client links the copy to the original", async () => {
  const { handler, queries } = load("programs", (sql) => {
    if (sql.startsWith("select * from training_programs where id"))
      return { rows: [{ id: 21, name: "Jordan block" }] };
    if (sql.startsWith("select id,name from clients where id"))
      return { rows: [{ id: 8, name: "Sam Ortiz" }] };
    if (sql.startsWith("insert into training_programs"))
      return { rows: [{ id: 100 }] };
  });
  const { code } = await call(handler, {
    method: "POST",
    body: { action: "copy_program", sourceId: 21, clientId: 8, status: "active" },
  });
  assert.equal(code, 201);
  assert.deepEqual(queries[0].params, [21, false]); // client programs only, not stock
  const insert = queries.find((q) => q.sql.startsWith("insert into"));
  assert.deepEqual(insert.params, ["Sam Ortiz — Jordan block", 8, "Sam Ortiz", 21, "active"]);
  assert.match(insert.sql, /false,id/); // source_program_id = the original
  assert.equal(queries.filter((q) => /^(update|delete)/.test(q.sql)).length, 0);
});

test("a copy needs a real client and an existing source", async () => {
  const noClient = load("programs", (sql) => {
    if (sql.startsWith("select * from training_programs where id"))
      return { rows: [{ id: 11, name: "Foundation" }] };
  });
  const a = await call(noClient.handler, {
    method: "POST",
    body: { action: "use_template", sourceId: 11 },
  });
  assert.equal(a.code, 400);
  const noSource = load("programs", () => ({ rows: [] }));
  const b = await call(noSource.handler, {
    method: "POST",
    body: { action: "copy_program", sourceId: 404, clientId: 3 },
  });
  assert.equal(b.code, 404);
});

test("new programs need a name and get sane days, weeks and content", async () => {
  const { handler, queries } = load("programs", (sql) => {
    if (sql.startsWith("insert into")) return { rows: [{ id: 7 }] };
  });
  const missing = await call(handler, { method: "POST", body: { name: "  " } });
  assert.equal(missing.code, 400);
  const ok = await call(handler, {
    method: "POST",
    body: { name: "Block", daysPerWeek: 12, weeks: 0 },
  });
  assert.equal(ok.code, 201);
  const params = queries.find((q) => q.sql.startsWith("insert into")).params;
  assert.equal(params[3], 7); // days clamped to 7
  assert.equal(params[4], 4); // blank weeks fall back to 4
  const content = JSON.parse(params[6]);
  assert.equal(content.days.length, 7);
  assert.equal(content.days[0].blocks[0].exercises[0].reps.length, 4);
});

test("public booking: name required, email optional, bad email rejected", async () => {
  const { handler, queries } = load("calendar-manual", (sql) => {
    // The flood guard answers "busy", which proves validation passed.
    if (sql.includes("count(*)::int n from booking_requests"))
      return { rows: [{ n: 15 }] };
  });
  const book = (fields) =>
    call(handler, {
      method: "POST",
      body: {
        resource: "book",
        startsAt: "2026-10-20T17:00:00Z",
        reason: "PT consultation",
        ...fields,
      },
    });
  assert.equal((await book({ name: "A" })).code, 400);
  assert.equal(
    (await book({ name: "Sam Rivera", email: "not-an-email" })).code,
    400,
  );
  assert.equal((await book({ name: "Sam Rivera", reason: "" })).code, 400);
  assert.equal((await book({ name: "Sam Rivera", email: "" })).code, 429);
  // The hidden "website" field catches bots: they get a success and nothing is saved.
  const before = queries.length;
  assert.equal(
    (await book({ name: "Bot", website: "spam.example" })).code,
    201,
  );
  assert.equal(queries.length, before);
});
