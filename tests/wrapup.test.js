const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const W = require("../js/wrapup-core");

const client = { id: 4, name: "Derick Ngan", email: "derick@example.com", phone: "555-0100", package_size: 10, package_start: "2026-09-01" };
let n = 0;
const pt = (date, extra = {}) => ({ id: ++n, client_id: 4, session_type: "Personal training", session_date: date, wrapup: {}, ...extra });
// Nine sessions in this package, plus noise that must not count.
const sessions = [
  ...Array.from({ length: 9 }, (_, i) => pt(`2026-09-${String(i + 2).padStart(2, "0")}`)),
  pt("2026-08-20"), // before the package started
  { id: ++n, client_id: 4, session_type: "InBody scan", session_date: "2026-09-05" },
  { id: ++n, client_id: 9, session_type: "Personal training", session_date: "2026-09-05" },
];
const ninth = sessions[8];

test("the Workday text matches William's example exactly", () => {
  const ctx = W.context({ client, session: { ...ninth, length_minutes: 50 }, sessions, settings: {} });
  assert.equal(ctx.n, 9);
  assert.equal(ctx.session, "9/10");
  assert.equal(
    W.workdayText(ctx),
    "Derick Ngan: 10 sessions - 50min (9/10) - $44.65\n\nOverride Rate: 18.90",
  );
});

test("session numbers count only this client's PT sessions in the current package", () => {
  assert.equal(W.sessionNumber(client, sessions, sessions[0]), 1);
  assert.equal(W.sessionNumber(client, sessions, ninth), 9);
  assert.equal(W.sessionNumber(client, sessions, sessions[9]), null); // before the package
  assert.equal(W.sessionNumber(client, sessions, sessions[10]), null); // InBody, not PT
  assert.deepEqual(W.packageInfo(client, sessions), { size: 10, used: 9, left: 1 });
  // No start date: every PT session counts.
  assert.equal(W.packageInfo({ ...client, package_start: null }, sessions).used, 10);
  assert.deepEqual(W.packageInfo({ id: 4 }, sessions).size, null);
});

test("rows fill in the tokens and join with tabs for pasting into a sheet", () => {
  const ctx = W.context({ client, session: { ...ninth, length_minutes: 50 }, sessions, settings: {}, trainer: "William Farparan" });
  assert.equal(W.rowText(["{date}", "{client}", "{session}", "{length}"], ctx), "09/10/2026\tDerick Ngan\t9/10\t50");
  assert.equal(W.rowText(["{client}", "{email}", "{phone}", "{total}"], ctx), "Derick Ngan\tderick@example.com\t555-0100\t10");
  assert.equal(W.rowText(["Trainer: {trainer}", "{nope}", "{rate}"], ctx), "Trainer: William Farparan\t\t");
  assert.equal(W.usDate("2026-09-10T00:00:00.000Z"), "09/10/2026");
});

test("a missing package or rate shows a blank and says what to set", () => {
  const bare = W.context({ client: { id: 4, name: "New Person" }, session: { ...ninth, length_minutes: 30 }, sessions, settings: {} });
  assert.equal(bare.pay, "");
  assert.match(W.workdayText(bare), /^New Person: sessions - 30min - \$___\n\nOverride Rate: ___$/);
  const gaps = W.gaps(bare);
  assert.equal(gaps.length, 2);
  assert.match(gaps[0], /package size/);
  assert.match(gaps[1], /30-minute/);
  assert.deepEqual(W.gaps(W.context({ client, session: ninth, sessions, settings: {} })), []);
});

test("session length comes from the session, then the client, then the default", () => {
  const len = (c, s) => W.context({ client: c, session: s, sessions, settings: {} }).length;
  assert.equal(len(client, { ...ninth, length_minutes: 30 }), 30);
  assert.equal(len({ ...client, session_minutes: 60 }, ninth), 60);
  assert.equal(len(client, ninth), 50);
});

test("pending sessions are personal-training sessions with steps left", () => {
  const done = { sf: "2026-09-10", logger: "2026-09-10", workday: "2026-09-10", signed: "2026-09-10" };
  const list = [
    pt("2026-09-10", { wrapup: done }),
    pt("2026-09-11", { wrapup: { sf: "2026-09-11" } }),
    pt("2026-09-12"),
    { id: ++n, client_id: 4, session_type: "InBody scan", session_date: "2026-09-13", wrapup: {} },
  ];
  assert.equal(W.stepsDone(list[1]), 1);
  assert.equal(W.isWrapped(list[0]), true);
  assert.deepEqual(W.pending(list).map((s) => s.session_date), ["2026-09-12", "2026-09-11"]);
});

test("settings are cleaned: https links only, sane rates, known defaults", () => {
  const clean = W.cleanSettings({
    workdayUrl: "javascript:alert(1)",
    defaultMinutes: "45",
    rates: [{ minutes: "60", pay: "52.5", override: "21" }, { minutes: 60, pay: 1 }, { minutes: 2, pay: 1 }, { minutes: 30, pay: -5, override: "x" }],
    sf: { url: "http://insecure.example", columns: ["{date}", "  ", "{client}"] },
    logger: { columns: [] },
  });
  assert.equal(clean.workdayUrl, W.DEFAULTS.workdayUrl);
  assert.equal(clean.defaultMinutes, 45);
  assert.deepEqual(clean.rates, [
    { minutes: 30, pay: null, override: null },
    { minutes: 60, pay: 52.5, override: 21 },
  ]);
  assert.equal(clean.sf.url, W.DEFAULTS.sf.url);
  assert.deepEqual(clean.sf.columns, ["{date}", "{client}"]);
  assert.deepEqual(clean.logger.columns, W.DEFAULTS.logger.columns);
  assert.deepEqual(W.cleanSettings({}).rates, W.DEFAULTS.rates);
});

// ----- routes -----
function stub(rel, exports) {
  const file = require.resolve(path.join("..", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
function load(route, answer) {
  const queries = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params = []) {
        const q = sql.replace(/\s+/g, " ").trim();
        queries.push({ sql: q, params });
        return answer(q, params) || { rows: [] };
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
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        resolve({ code: this.statusCode, body: b });
      },
    };
    handler({ headers: {}, query: {}, ...req }, res);
  });
}

test("settings come back as defaults until saved, and saving cleans them", async () => {
  const { handler, queries } = load("settings", (sql) => (sql.startsWith("select key") ? { rows: [] } : null));
  const got = await call(handler, { method: "GET" });
  assert.equal(got.code, 200);
  assert.equal(got.body.settings.wrapup.rates[0].pay, 44.65);
  const put = await call(handler, {
    method: "PUT",
    body: { key: "wrapup", value: { rates: [{ minutes: 45, pay: 40, override: 17.5 }], workdayUrl: "https://example.com/x" } },
  });
  assert.equal(put.code, 200);
  const saved = JSON.parse(queries.find((q) => q.sql.startsWith("insert into app_settings")).params[1]);
  assert.deepEqual(saved.rates, [{ minutes: 45, pay: 40, override: 17.5 }]);
  assert.equal((await call(handler, { method: "PUT", body: { key: "bogus", value: {} } })).code, 400);
});

test("ticking a wrap-up step stamps the date; unticking removes it; length is separate", async () => {
  const { handler, queries } = load("clients", (sql) => (sql.startsWith("update client_sessions") ? { rows: [{ id: 5 }] } : null));
  const on = await call(handler, { method: "PATCH", query: { resource: "wrapup", id: "5" }, body: { step: "workday", done: true, dayKey: "2026-10-08" } });
  assert.equal(on.code, 200);
  assert.deepEqual(queries[0].params, [5, "workday", "2026-10-08"]);
  assert.match(queries[0].sql, /jsonb_build_object/);
  await call(handler, { method: "PATCH", query: { resource: "wrapup", id: "5" }, body: { step: "workday", done: false } });
  assert.match(queries[1].sql, /'\{\}'::jsonb\) - \$2::text/);
  await call(handler, { method: "PATCH", query: { resource: "wrapup", id: "5" }, body: { lengthMinutes: 45 } });
  assert.deepEqual(queries[2].params, [5, 45]);
  assert.equal((await call(handler, { method: "PATCH", query: { resource: "wrapup", id: "5" }, body: { step: "hack", done: true } })).code, 400);
  assert.equal((await call(handler, { method: "PATCH", query: { resource: "wrapup", id: "5" }, body: {} })).code, 400);
  assert.equal((await call(handler, { method: "PATCH", query: { resource: "wrapup" }, body: { step: "sf", done: true } })).code, 400);
});

test("a client's package size, start and session length are saved with the client", async () => {
  const { handler, queries } = load("clients", (sql) => (sql.startsWith("update clients") ? { rows: [{ id: 4 }] } : null));
  await call(handler, { method: "PATCH", query: { id: "4" }, body: { name: "Derick", packageSize: "10", packageStart: "2026-09-01", sessionMinutes: 50 } });
  const p = queries[0].params;
  assert.deepEqual(p.slice(-3), [10, "2026-09-01", 50]);
  await call(handler, { method: "PATCH", query: { id: "4" }, body: { name: "Derick", packageSize: "abc", packageStart: "soon" } });
  assert.deepEqual(queries[1].params.slice(-3), [null, null, null]);
});

test("a manually logged session can carry its length", async () => {
  const { handler, queries } = load("clients", (sql) => {
    if (sql.startsWith("select 1 from clients")) return { rows: [{}] };
    if (sql.startsWith("insert into client_sessions")) return { rows: [{ id: 1 }] };
  });
  await call(handler, { method: "POST", query: { resource: "sessions" }, body: { clientId: 4, sessionType: "Personal training", date: "2026-10-08", lengthMinutes: 45 } });
  assert.equal(queries.find((q) => q.sql.startsWith("insert into client_sessions")).params.at(-1), 45);
});

test("saying Yes after a consult records the package", async () => {
  const { handler, queries } = load("consults", (sql) => {
    if (sql.startsWith("select * from client_consults where id")) return { rows: [{ id: 9, client_id: 4, answers: {} }] };
    if (sql.startsWith("update client_consults")) return { rows: [{ id: 9 }] };
    if (sql.startsWith("update clients")) return { rows: [{ id: 4, package_size: 10 }] };
  });
  await call(handler, { method: "POST", query: { id: "9", action: "complete" }, body: { decision: "yes", daysPerWeek: 3, sessionMinutes: 50, firstSession: "2026-10-20", packageSize: 10, dayKey: "2026-10-08" } });
  const upd = queries.find((q) => q.sql.startsWith("update clients"));
  assert.deepEqual(upd.params, [4, "2026-10-20", 10, "2026-10-08", 50]);
  assert.match(upd.sql, /package_size = coalesce/);
});
