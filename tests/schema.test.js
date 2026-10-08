const test = require("node:test");
const assert = require("node:assert/strict");

// Loads lib/db.js against a fake Postgres that records every query.
function loadDb(markerExists) {
  const queries = [];
  const pgPath = require.resolve("pg");
  require.cache[pgPath] = {
    id: pgPath,
    filename: pgPath,
    loaded: true,
    exports: {
      Pool: class {
        async query(sql, params) {
          queries.push(String(sql).trim().slice(0, 40));
          if (/^select 1 from app_meta/.test(sql))
            return { rows: markerExists ? [{}] : [] };
          if (/into app_meta/.test(sql)) return { rows: [] }; // seeds already marked
          return { rows: [], rowCount: 0 };
        }
        async connect() {
          return { query: this.query.bind(this), release() {} };
        }
      },
    },
  };
  delete require.cache[require.resolve("../lib/db")];
  process.env.DATABASE_URL = "postgres://fake";
  return { db: require("../lib/db"), queries };
}

test("a cold start with an up-to-date schema runs one query", async () => {
  const { db, queries } = loadDb(true);
  await db.ensureWorkspaceSchema();
  await db.ensureWorkspaceSchema();
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^select 1 from app_meta/);
});

test("a new schema runs setup once and records its marker", async () => {
  const { db, queries } = loadDb(false);
  await db.ensureWorkspaceSchema();
  assert.ok(
    queries.some((q) => q.startsWith("create table if not exists clients")),
  );
  assert.match(queries.at(-1), /^insert into app_meta \(key\) values/);
  delete require.cache[require.resolve("pg")];
  delete require.cache[require.resolve("../lib/db")];
});
