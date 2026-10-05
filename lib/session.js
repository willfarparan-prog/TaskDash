const crypto = require("crypto");
const { OWNER_EMAIL, WORK_EMAIL } = require("./google");

const APPROVED_EMAILS = new Set([OWNER_EMAIL, WORK_EMAIL]);

function secret() {
  return process.env.DASHBOARD_SESSION_SECRET || "";
}

function signature(email) {
  if (!secret()) return "";
  return crypto
    .createHmac("sha256", secret())
    .update(email)
    .digest("base64url");
}

function sessionCookie(email = OWNER_EMAIL) {
  const normalized = String(email || "").toLowerCase();
  if (!APPROVED_EMAILS.has(normalized))
    throw new Error("Task Dash session email is not approved");
  const value = `${normalized}.${signature(normalized)}`;
  return `taskdash_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function isOwnerSession(req) {
  const raw = String(req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("taskdash_session="));
  if (!raw || !secret()) return false;
  const value = decodeURIComponent(raw.slice("taskdash_session=".length));
  const splitAt = value.lastIndexOf(".");
  if (splitAt < 0) return false;
  const email = value.slice(0, splitAt);
  const supplied = value.slice(splitAt + 1);
  const expected = signature(email);
  if (!APPROVED_EMAILS.has(email) || supplied.length !== expected.length)
    return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function requireOwnerSession(req, res) {
  if (!isOwnerSession(req)) {
    res
      .status(401)
      .json({
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
