const crypto = require("crypto");
const { OWNER_EMAIL, WORK_EMAIL } = require("./google");

const APPROVED_EMAILS = new Set([OWNER_EMAIL, WORK_EMAIL]);

function secret() {
  return process.env.DASHBOARD_SESSION_SECRET || "";
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function signature(payload) {
  if (!secret()) return "";
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

// Cookie value: <email>.<issued-at ms>.<signature over "email.issued">.
// The issue time is signed, so the server enforces expiry itself instead of
// trusting the browser's Max-Age.
function sessionCookie(email = OWNER_EMAIL) {
  const normalized = String(email || "").toLowerCase();
  if (!APPROVED_EMAILS.has(normalized))
    throw new Error("Task Dash session email is not approved");
  const payload = `${normalized}.${Date.now()}`;
  const value = `${payload}.${signature(payload)}`;
  return `taskdash_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function isOwnerSession(req) {
  const raw = String(req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("taskdash_session="));
  if (!raw || !secret()) return false;
  let value;
  try {
    value = decodeURIComponent(raw.slice("taskdash_session=".length));
  } catch {
    return false;
  }
  const sigAt = value.lastIndexOf(".");
  if (sigAt < 0) return false;
  const payload = value.slice(0, sigAt);
  const supplied = value.slice(sigAt + 1);
  const issuedAt = payload.lastIndexOf(".");
  if (issuedAt < 0) return false;
  const email = payload.slice(0, issuedAt);
  const issued = Number(payload.slice(issuedAt + 1));
  const age = Date.now() - issued;
  if (
    !Number.isFinite(issued) ||
    age < 0 ||
    age > SESSION_MAX_AGE_SECONDS * 1000
  )
    return false;
  const expected = signature(payload);
  if (!APPROVED_EMAILS.has(email) || supplied.length !== expected.length)
    return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function requireOwnerSession(req, res) {
  if (!isOwnerSession(req)) {
    res.status(401).json({
      error: `Sign in as ${WORK_EMAIL} or ${OWNER_EMAIL} to unlock private dashboard data.`,
    });
    return false;
  }
  const method = String(req.method || "GET").toUpperCase();
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    fetchSite === "cross-site"
  ) {
    res
      .status(403)
      .json({ error: "Cross-site dashboard changes are not allowed." });
    return false;
  }
  return true;
}

module.exports = { sessionCookie, isOwnerSession, requireOwnerSession };
