const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DASHBOARD_SESSION_SECRET = "test-secret-for-session-tests";
const { sessionCookie, isOwnerSession } = require("../lib/session");
const { OWNER_EMAIL, WORK_EMAIL } = require("../lib/google");

const reqWith = (cookie) => ({ headers: { cookie } });
const valueOf = (setCookie) => setCookie.split(";")[0];

test("approved emails get a working session", () => {
  for (const email of [OWNER_EMAIL, WORK_EMAIL]) {
    assert.equal(isOwnerSession(reqWith(valueOf(sessionCookie(email)))), true);
  }
});

test("unapproved emails cannot be issued a session", () => {
  assert.throws(() => sessionCookie("someone@example.com"));
});

test("tampered or unsigned cookies are rejected", () => {
  const good = valueOf(sessionCookie(OWNER_EMAIL));
  assert.equal(isOwnerSession(reqWith(good.slice(0, -2) + "xx")), false);
  assert.equal(isOwnerSession(reqWith("taskdash_session=")), false);
  assert.equal(isOwnerSession({ headers: {} }), false);
  // Old two-part cookies (no issue time) are no longer accepted.
  assert.equal(
    isOwnerSession(
      reqWith(`taskdash_session=${encodeURIComponent(OWNER_EMAIL + ".abc")}`),
    ),
    false,
  );
});

test("sessions expire after 30 days", () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 31 * 24 * 60 * 60 * 1000;
    const old = valueOf(sessionCookie(OWNER_EMAIL));
    Date.now = realNow;
    assert.equal(isOwnerSession(reqWith(old)), false);
  } finally {
    Date.now = realNow;
  }
});
