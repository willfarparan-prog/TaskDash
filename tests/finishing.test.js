const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, response } = require("./helpers");
const scheduler = require("../lib/scheduler");
const mockDate = class extends Date {
  constructor(...args) {
    super(...(args.length ? args : ["2026-10-08T14:00:00Z"]));
  }
  static now() {
    return new Date("2026-10-08T14:00:00Z").getTime();
  }
};
const token = {
  scope: "calendar.events calendar.readonly",
  access_token: "mock",
};
function handler(file, db, fetch, authorized = true, googleToken = token) {
  return load(
    file,
    {
      "../db": {
        getPool: () => db,
        ensureWorkspaceSchema: async () => {},
        trackUsage: () => {},
      },
      "../session": {
        requireOwnerSession: (_, res) =>
          authorized || (res.status(401).json({ error: "Locked" }), false),
      },
      "../google": {
        getVerifiedGoogleToken: async () => googleToken,
        WORK_EMAIL: "work",
        OWNER_EMAIL: "owner",
      },
      "../scheduler": {
        ...scheduler,
        buildAvailability: (settings, busy) =>
          scheduler.buildAvailability(settings, busy, new Date(mockDate.now())),
      },
    },
    { fetch, Date: mockDate },
  ).exports;
}
const request = (method, resource, body = {}) => ({
  method,
  headers: {},
  query: { resource },
  body,
});
test("private scheduler rejects unauthenticated access before touching the database", async () => {
  const api = handler(
    "lib/routes/calendar-manual.js",
    {
      query: () => {
        throw new Error("Must not query");
      },
    },
    null,
    false,
  );
  const res = response();
  await api(request("GET", "scheduler"), res);
  assert.equal(res.statusCode, 401);
});
test("availability reads all Google pages, Pacific all-day events, and manual blocks", async () => {
  const db = {
    query: async (sql) => ({
      rows: sql.includes("booking_settings")
        ? [{ settings: { bookAheadDays: 1, noticeMinutes: 0 } }]
        : sql.includes("manual_blocks")
          ? [
              {
                block_date: "2026-10-09",
                start_time: "09:00",
                end_time: "10:00",
              },
            ]
          : [],
    }),
  };
  let pages = 0;
  const api = handler("lib/routes/calendar-manual.js", db, async () => ({
    ok: true,
    json: async () =>
      ++pages === 1
        ? { items: [], nextPageToken: "more" }
        : {
            items: [
              { start: { date: "2026-10-08" }, end: { date: "2026-10-09" } },
            ],
          },
  }));
  const res = response();
  await api(request("GET", "availability"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(pages, 2);
  assert.equal(res.body.days[0].openCount, 0);
  assert.equal(res.body.days[1].slots[0].open, false);
  assert.equal(res.body.days[1].slots[2].open, true);
});
test("calendar API failure does not expose unverified available slots", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const api = handler("lib/routes/calendar-manual.js", db, async () => ({
    ok: false,
    json: async () => ({ error: { message: "Unavailable" } }),
  }));
  const res = response();
  await api(request("GET", "availability"), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /could not be verified/);
});
test("overlapping booking is rejected inside the transaction and releases its lock", async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: sql.includes("select id from booking_requests")
          ? [{ id: 1 }]
          : [],
      };
    },
    release() {
      queries.push("release");
    },
  };
  const db = { query: async () => ({ rows: [] }), connect: async () => client };
  const api = handler("lib/routes/calendar-manual.js", db, async () => ({
    ok: true,
    json: async () => ({ items: [] }),
  }));
  const res = response();
  await api(
    request("POST", "book", {
      name: "Test visitor",
      reason: "PT consultation",
      startsAt: "2026-10-08T16:00:00Z",
    }),
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.ok(queries.includes("SELECT pg_advisory_xact_lock(741092)"));
  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(queries.at(-1), "release");
});
test("booking errors are awaited and returned by the route error boundary", async () => {
  const db = {
    query: async () => {
      throw new Error("Unavailable");
    },
  };
  const res = response();
  await handler(
    "lib/routes/calendar-manual.js",
    db,
    null,
  )(
    request("POST", "book", {
      name: "Test visitor",
      reason: "PT consultation",
      startsAt: "2026-10-08T16:00:00Z",
    }),
    res,
  );
  assert.equal(res.statusCode, 500);
});
test("failed Google cancellation keeps the local booking reserved", async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ google_event_id: "test-id" }] };
    },
  };
  db.connect = async () => ({ query: db.query, release() {} });
  const api = handler("lib/routes/calendar-manual.js", db, async () => ({
    ok: false,
    status: 503,
  }));
  const res = response();
  const req = request("DELETE", "booking");
  req.query.id = 1;
  await api(req, res);
  assert.equal(res.statusCode, 502);
  assert.ok(!queries.some((sql) => sql.startsWith("update booking_requests")));
});
test("program content-only saves retain all existing weeks", async () => {
  let content;
  const db = {
    query: async (sql, values) => {
      if (sql.startsWith("select days_per_week"))
        return { rows: [{ days_per_week: 2, weeks: 8 }] };
      content = JSON.parse(values[0]);
      return { rows: [{ id: 1, content }] };
    },
  };
  const api = handler("lib/routes/programs.js", db, null);
  const res = response();
  await api(
    {
      method: "PATCH",
      query: { id: 1 },
      body: {
        content: {
          days: [
            {
              blocks: [
                { exercises: [{ name: "Squat", reps: Array(8).fill("5") }] },
              ],
            },
          ],
        },
      },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(content.days[0].blocks[0].exercises[0].reps.length, 8);
});

test("public booking pauses without a work calendar and permits an explicit local-only setting", async () => {
  for (const required of [true, false]) {
    const db = {
      query: async (sql) => ({
        rows: sql.includes("select settings")
          ? [
              {
                settings: {
                  ...scheduler.DEFAULT_SCHEDULE,
                  requireCalendar: required,
                },
              },
            ]
          : [],
      }),
    };
    const api = handler("lib/routes/calendar-manual.js", db, null, true, null);
    const res = response();
    await api(request("GET", "availability"), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paused, required);
    assert.equal(res.body.days.length === 0, required);
  }
});
test("booking rate limits reject excess attempts before calendar reads or reservation writes", async () => {
  const calls = [];
  const api = handler(
    "lib/routes/calendar-manual.js",
    {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [{ requests: 13 }] };
      },
    },
    () => {
      throw Error("Must not fetch");
    },
  );
  const res = response();
  await api(
    request("POST", "book", {
      name: "Test visitor",
      reason: "PT consultation",
      startsAt: "2026-10-08T16:00:00Z",
    }),
    res,
  );
  assert.equal(res.statusCode, 429);
  assert.equal(calls.length, 1);
  assert.equal(res.headers["Retry-After"], "3600");
});
test("workspace export uses a consistent snapshot and excludes credentials", async () => {
  const calls = [];
  let released = false;
  const db = {
    connect: async () => ({
      query: async (sql) => {
        calls.push(sql);
        return { rows: [{ id: 1 }] };
      },
      release() {
        released = true;
      },
    }),
  };
  const res = response();
  await handler("lib/routes/connections.js", db)(request("GET", "export"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.format, "taskdash-backup");
  assert.equal(Object.keys(res.body.records).length, 15);
  assert.ok(!calls.some((sql) => sql.includes("oauth_tokens")));
  assert.match(calls[0], /REPEATABLE READ READ ONLY/);
  assert.equal(calls.at(-1), "COMMIT");
  assert.ok(released);
});
test("stale program versions return a conflict instead of overwriting newer edits", async () => {
  const db = {
    query: async (sql) => ({
      rows: sql.startsWith("select days_per_week")
        ? [{ days_per_week: 1, weeks: 4, updated_at: "2026-10-08T10:00:00Z" }]
        : [],
    }),
  };
  const res = response();
  await handler("lib/routes/programs.js", db)(
    {
      method: "PATCH",
      query: { id: 1 },
      body: { name: "Test", updatedAt: "2026-10-07T10:00:00Z" },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
});
