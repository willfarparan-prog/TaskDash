// A small error log in Neon. Vercel's free plan keeps logs for an hour, so
// failures are also written here and listed on the Connections page.
const { getPool } = require("./db");

async function reportError(source, message, stack = "") {
  try {
    await getPool().query(
      "insert into app_errors (source, message, stack) values ($1,$2,$3)",
      [
        String(source || "unknown").slice(0, 80),
        String(message || "Unknown error").slice(0, 1000),
        String(stack || "").slice(0, 4000) || null,
      ],
    );
  } catch {
    // Logging must never break the request that failed.
  }
}

module.exports = { reportError };
