const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSchedule,
  buildAvailability,
  pacificInstant,
  pacificToday,
} = require("../lib/scheduler");

test("pacificInstant handles daylight and standard time", () => {
  assert.equal(
    pacificInstant("2026-10-06", "09:00").toISOString(),
    "2026-10-06T16:00:00.000Z",
  );
  assert.equal(
    pacificInstant("2026-11-02", "09:00").toISOString(),
    "2026-11-02T17:00:00.000Z",
  );
  // Midnight Pacific is the start of the all-day window, not UTC midnight.
  assert.equal(
    pacificInstant("2026-10-07", "00:00").toISOString(),
    "2026-10-07T07:00:00.000Z",
  );
});

test("pacificToday follows Pacific time, not UTC", () => {
  // 03:00 UTC on Oct 7 is still the evening of Oct 6 in San Francisco.
  assert.equal(pacificToday(new Date("2026-10-07T03:00:00Z")), "2026-10-06");
});

test("normalizeSchedule survives bad closures and out-of-range values", () => {
  const s = normalizeSchedule({
    closures: [null, { date: "nope" }, { date: "2026-12-25", reason: "Holiday" }],
    sessionMinutes: 9999,
    bookAheadDays: 0,
    hours: { mon: { enabled: true, start: "17:00", end: "09:00" } },
  });
  assert.deepEqual(s.closures, [{ date: "2026-12-25", reason: "Holiday" }]);
  assert.equal(s.sessionMinutes, 240);
  assert.equal(s.bookAheadDays, 21); // 0 falls back to the default
  assert.equal(s.hours.mon.enabled, false); // end before start is closed
});

test("buildAvailability respects notice windows, busy times and closures", () => {
  const schedule = {
    sessionMinutes: 60,
    slotMinutes: 60,
    noticeMinutes: 120,
    bookAheadDays: 2,
    closures: [{ date: "2026-10-08", reason: "Offsite" }],
  };
  // Tue Oct 6 2026, 08:00 Pacific.
  const now = pacificInstant("2026-10-06", "08:00");
  const busy = [
    {
      start: pacificInstant("2026-10-06", "13:00").toISOString(),
      end: pacificInstant("2026-10-06", "14:00").toISOString(),
    },
  ];
  const days = buildAvailability(schedule, busy, now);
  const today = days.find((d) => d.date === "2026-10-06");
  const byLabel = Object.fromEntries(today.slots.map((s) => [s.label, s]));
  assert.equal(byLabel["9:00 AM"].open, false); // inside the 2h notice window
  assert.equal(byLabel["9:00 AM"].reason, "too soon");
  assert.equal(byLabel["10:00 AM"].open, true);
  assert.equal(byLabel["1:00 PM"].open, false);
  assert.equal(byLabel["1:00 PM"].reason, "booked");
  assert.equal(byLabel["2:00 PM"].open, true); // back-to-back is allowed
  const closed = days.find((d) => d.date === "2026-10-08");
  assert.equal(closed.closed, true);
  assert.equal(closed.closedReason, "Offsite");
});

test("an all-day busy event blocks only that Pacific day", () => {
  const now = pacificInstant("2026-10-05", "08:00");
  const busy = [
    {
      start: pacificInstant("2026-10-07", "00:00").toISOString(),
      end: pacificInstant("2026-10-08", "00:00").toISOString(),
    },
  ];
  const days = buildAvailability(
    { bookAheadDays: 3, noticeMinutes: 0 },
    busy,
    now,
  );
  const open = (date) =>
    days.find((d) => d.date === date).slots.filter((s) => s.open).length;
  assert.equal(open("2026-10-07"), 0);
  assert.ok(open("2026-10-06") > 0);
  assert.ok(open("2026-10-08") > 0);
});
