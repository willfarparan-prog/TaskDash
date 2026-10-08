const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/survey-followup");

const none = { survey: false, "survey-2": false, "survey-3": false };

test("response rate needs both numbers and a positive send count", () => {
  assert.equal(S.responseRate({}), null);
  assert.equal(S.responseRate({ sent: 40 }), null);
  assert.equal(S.responseRate({ sent: 40, responses: "" }), null);
  assert.equal(S.responseRate({ sent: 0, responses: 3 }), null);
  assert.equal(S.responseRate({ sent: 40, responses: 10 }), 0.25);
  assert.equal(S.responseRate({ sent: "40", responses: "12" }), 0.3);
  assert.equal(S.responseRate({ sent: 10, responses: 15 }), 1); // capped
});

test("first send is due 1-3 days after the event", () => {
  assert.deepEqual(S.sendState("survey", none, {}, 0), { state: "upcoming", inDays: 1 });
  assert.deepEqual(S.sendState("survey", none, {}, 1), { state: "now" });
  assert.deepEqual(S.sendState("survey", none, {}, 3), { state: "now" });
  assert.deepEqual(S.sendState("survey", none, {}, 4), { state: "overdue" });
  assert.deepEqual(S.sendState("survey", { ...none, survey: true }, {}, 4), { state: "done" });
});

test("second send waits for the first, then needs the response count", () => {
  assert.equal(S.sendState("survey-2", none, {}, 6).state, "waiting");
  const sent1 = { ...none, survey: true };
  assert.deepEqual(S.sendState("survey-2", sent1, {}, 3), { state: "upcoming", inDays: 2 });
  assert.equal(S.sendState("survey-2", sent1, {}, 5).state, "log");
  assert.equal(S.sendState("survey-2", sent1, { sent: 40 }, 6).state, "log");
});

test("under 30% responded triggers the resend on its 5-7 day window", () => {
  const sent1 = { ...none, survey: true };
  const low = { sent: 40, responses: 11 }; // 27.5%
  assert.equal(S.resendNeeded("survey-2", sent1, low), "yes");
  assert.deepEqual(S.sendState("survey-2", sent1, low, 4), { state: "upcoming", inDays: 1 });
  assert.deepEqual(S.sendState("survey-2", sent1, low, 6), { state: "now" });
  assert.deepEqual(S.sendState("survey-2", sent1, low, 8), { state: "overdue" });
});

test("30% or more responded skips the remaining sends", () => {
  const sent1 = { ...none, survey: true };
  const ok = { sent: 40, responses: 12 }; // exactly 30%
  assert.equal(S.resendNeeded("survey-2", sent1, ok), "no");
  assert.deepEqual(S.sendState("survey-2", sent1, ok, 6), { state: "skipped", rate: 0.3 });
  // The final send isn't needed either, even though send 2 never went out.
  assert.equal(S.sendState("survey-3", sent1, ok, 14).state, "skipped");
  // Below 30% with send 2 still pending, the final send waits for it.
  assert.equal(S.sendState("survey-3", sent1, { sent: 40, responses: 5 }, 14).state, "waiting");
});

test("final send goes out around two weeks if still under 30%", () => {
  const sent2 = { ...none, survey: true, "survey-2": true };
  const low = { sent: 40, responses: 9 };
  assert.deepEqual(S.sendState("survey-3", sent2, low, 10), { state: "upcoming", inDays: 3 });
  assert.deepEqual(S.sendState("survey-3", sent2, low, 14), { state: "now" });
  assert.deepEqual(S.sendState("survey-3", sent2, low, 16), { state: "overdue" });
  // Responses picked up after the reminder: no final send needed.
  assert.equal(S.sendState("survey-3", sent2, { sent: 40, responses: 13 }, 14).state, "skipped");
});
