const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers");
const booking = {
  bookingCode: "abcd1234",
  visitorName: "Test",
  reason: "Consultation",
  startsAt: "2026-10-08T16:00:00Z",
  endsAt: "2026-10-08T16:30:00Z",
};
function sync(
  fetch,
  token = { access_token: "mock", scope: "calendar.events" },
) {
  return load(
    "lib/booking-sync.js",
    {
      "./google": { getVerifiedGoogleToken: async () => token },
      "./db": { trackUsage() {} },
    },
    { fetch },
  ).exports;
}
test("calendar retry reconciles an existing legacy event without creating another", async () => {
  let calls = 0;
  const api = sync(async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        items: [
          {
            id: "legacy",
            extendedProperties: {
              private: { taskDashBooking: booking.bookingCode },
            },
          },
        ],
      }),
    };
  });
  const result = await api.createCalendarEvent(booking);
  assert.equal(result.id, "legacy");
  assert.equal(calls, 1);
});
test("a repeated calendar insert uses a stable ID and reconciles a lost response", async () => {
  const calls = [];
  const api = sync(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1)
      return { ok: true, json: async () => ({ items: [] }) };
    if (calls.length === 2) return { ok: false, status: 409 };
    return {
      ok: true,
      json: async () => ({
        id: "tdabcd1234",
        extendedProperties: {
          private: { taskDashBooking: booking.bookingCode },
        },
      }),
    };
  });
  assert.equal((await api.createCalendarEvent(booking)).id, "tdabcd1234");
  assert.equal(JSON.parse(calls[1].options.body).id, "tdabcd1234");
  assert.ok(calls[2].url.endsWith("/tdabcd1234"));
});
test("missing calendar authorization records an awaiting connection status", async () => {
  const api = sync(() => {
    throw Error("Must not fetch");
  }, null);
  assert.equal(
    (await api.createCalendarEvent(booking)).status,
    "awaiting_connection",
  );
});
test("failed sync keeps the reservation, persists an error, and releases the transaction lock", async () => {
  const queries = [];
  let released = false;
  const row = {
    id: 1,
    booking_code: booking.bookingCode,
    status: "confirmed",
    starts_at: booking.startsAt,
    ends_at: booking.endsAt,
  };
  const client = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: sql.startsWith("select") ? [row] : [] };
    },
    release() {
      released = true;
    },
  };
  const api = sync(async () => {
    throw Error("Network interrupted");
  });
  const result = await api.syncBooking({ connect: async () => client }, 1, "");
  assert.equal(result.status, "error");
  assert.equal(
    queries.find((q) => q.sql.startsWith("update")).values[1],
    "error",
  );
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.ok(released);
  assert.ok(!queries.some((q) => q.sql.includes("status='cancelled'")));
});
test("cancelled reservations cannot be synced and release their lock", async () => {
  const queries = [];
  let released = false;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ status: "cancelled" }] };
    },
    release() {
      released = true;
    },
  };
  await assert.rejects(
    () =>
      sync(() => {
        throw Error("Must not fetch");
      }).syncBooking({ connect: async () => client }, 1, ""),
    /Active booking not found/,
  );
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(released);
});
