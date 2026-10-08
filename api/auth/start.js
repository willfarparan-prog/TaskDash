// /api/auth/start — redirects the browser into Google's OAuth consent flow.
// Reads GOOGLE_CLIENT_ID from env. No secrets touch the client.

const crypto = require("crypto");
const { isOwnerSession } = require("../../lib/session");
const { OWNER_EMAIL, WORK_EMAIL } = require("../../lib/google");

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res
      .status(500)
      .send("GOOGLE_CLIENT_ID is not set in this deployment.");
  }

  // Fixed production origin — must exactly match callback.js and the
  // redirect URI registered in Google Cloud Console.
  const redirectUri = "https://task-dash-umber.vercel.app/api/auth/callback";

  const requestedAccount = String(req.query.account || "owner");
  const account = ["work", "operator"].includes(requestedAccount)
    ? requestedAccount
    : "owner";
  if (account === "work" && !isOwnerSession(req))
    return res
      .status(401)
      .send(
        `Connect ${OWNER_EMAIL} first, then connect the work calendar from Scheduler.`,
      );
  const expectedEmail = account === "owner" ? OWNER_EMAIL : WORK_EMAIL;
  const scopes =
    account === "work"
      ? [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/gmail.readonly",
        ]
      : account === "owner"
        ? [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/gmail.readonly",
          ]
        : ["openid", "email", "profile"];
  const nonce = crypto.randomBytes(18).toString("base64url");
  // Where to land afterwards; only known pages are allowed.
  const next = req.query.next === "inbox" ? "inbox" : "";
  const state = `${account}.${nonce}${next ? `.${next}` : ""}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    login_hint: expectedEmail,
    state,
    scope: scopes.join(" "),
  });

  res.setHeader(
    "Set-Cookie",
    `taskdash_oauth_state=${encodeURIComponent(state)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );
  res.writeHead(302, {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
  res.end();
};
