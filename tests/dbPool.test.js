const test = require("node:test");
const assert = require("node:assert/strict");

// Load lib/db.js against a fake pg so the pool's error handling can be
// exercised without a database.
function loadWithFakePg(FakePool) {
  const pgPath = require.resolve("pg");
  const dbPath = require.resolve("../lib/db");
  const saved = require.cache[pgPath];
  require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: FakePool } };
  delete require.cache[dbPath];
  process.env.neon = "postgres://fake";
  try {
    return require("../lib/db");
  } finally {
    if (saved) require.cache[pgPath] = saved;
    else delete require.cache[pgPath];
    delete require.cache[dbPath];
  }
}

test("a dropped idle connection is retried once on a fresh one", async () => {
  let calls = 0;
  class FakePool {
    constructor(options) {
      this.options = options;
      this.listeners = {};
    }
    on(event, fn) {
      this.listeners[event] = fn;
    }
    async query() {
      calls += 1;
      if (calls === 1) throw new Error("Connection terminated unexpectedly");
      return { rows: [{ ok: true }] };
    }
  }
  const db = loadWithFakePg(FakePool);
  const pool = db.getPool();
  const result = await pool.query("select 1");
  assert.deepEqual(result.rows, [{ ok: true }]);
  assert.equal(calls, 2);
  // Idle connections are retired before Neon closes them…
  assert.ok(pool.options.idleTimeoutMillis <= 30000);
  // …and an idle-connection error no longer crashes the process.
  assert.equal(typeof pool.listeners.error, "function");
  assert.doesNotThrow(() => pool.listeners.error(new Error("terminated")));
});

test("ordinary query errors are not retried", async () => {
  let calls = 0;
  class FakePool {
    on() {}
    async query() {
      calls += 1;
      const err = new Error('relation "nope" does not exist');
      err.code = "42P01";
      throw err;
    }
  }
  const db = loadWithFakePg(FakePool);
  await assert.rejects(db.getPool().query("select * from nope"), /does not exist/);
  assert.equal(calls, 1);
});

test("dropped-connection detection", () => {
  const { isDroppedConnection } = loadWithFakePg(class { on() {} });
  assert.equal(isDroppedConnection(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isDroppedConnection(Object.assign(new Error("x"), { code: "57P01" })), true);
  assert.equal(isDroppedConnection(Object.assign(new Error("x"), { code: "23505" })), false);
});
