const { ensureWorkspaceSchema, trackUsage } = require("../db");
const {
  OWNER_EMAIL,
  WORK_EMAIL,
  getVerifiedGoogleToken,
} = require("../google");
const { requireOwnerSession } = require("../session");

function headerValue(headers, name) {
  return (
    (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value || ""
  );
}

function shortSender(value) {
  return (
    value
      .replace(/<[^>]+>/g, "")
      .replace(/^"|"$/g, "")
      .trim() || value
  );
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  });
}

// Opens a thread in Gmail as the account it came from. The account goes in
// the standard `authuser` query parameter: the older /mail/u/<email>/ path
// form with a percent-encoded "@" can land on Gmail's "Temporary Error (404)".
function gmailLink(email, threadId) {
  const base = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}`;
  const id = String(threadId || "");
  return /^[\w-]+$/.test(id) ? `${base}#all/${id}` : `${base}#inbox`;
}

const GMAIL_SCOPE = "gmail.readonly";
const QUERY = "is:unread (is:important OR is:starred) newer_than:30d";

// Unread priority mail from one connected Google account.
async function priorityMail(token, source) {
  const auth = { headers: { Authorization: `Bearer ${token.access_token}` } };
  const listResponse = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
      new URLSearchParams({ q: QUERY, maxResults: "20" }),
    auth,
  );
  const list = await listResponse.json();
  if (!listResponse.ok)
    throw new Error(list.error?.message || "Gmail could not be loaded");
  const details = await Promise.all(
    (list.messages || []).slice(0, 20).map(async (item) => {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        auth,
      );
      return response.ok ? response.json() : null;
    }),
  );
  const messages = details.filter(Boolean).map((item) => {
    const headers = item.payload?.headers || [];
    const date = headerValue(headers, "Date");
    return {
      id: `${source}-${item.id}`,
      source,
      account: token.account_email,
      from: shortSender(headerValue(headers, "From")),
      subject: headerValue(headers, "Subject") || "(no subject)",
      snippet: item.snippet || "",
      received: shortDate(date),
      sortTime: Number(item.internalDate) || Date.parse(date) || 0,
      link: gmailLink(token.account_email, item.threadId || item.id),
    };
  });
  trackUsage("Google Gmail", `Load priority inbox (${source})`, "ok", {
    calls: 1 + details.length,
  });
  return messages;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: "method not allowed" });
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const connections = { google: false, work: false, microsoft: false };
    const notices = [];
    let messages = [];
    const accounts = [
      { kind: "owner", source: "google", email: OWNER_EMAIL },
      { kind: "work", source: "work", email: WORK_EMAIL },
    ];
    for (const account of accounts) {
      let token = null;
      try {
        token = await getVerifiedGoogleToken(account.kind);
      } catch (err) {
        notices.push({
          account: account.kind,
          text: `${account.email}: ${err.message}. Reconnect it to load its mail.`,
        });
        continue;
      }
      if (!token || !String(token.scope || "").includes(GMAIL_SCOPE)) {
        notices.push({
          account: account.kind,
          text: token
            ? `${account.email} is connected for calendar only. Reconnect it and approve read-only Gmail access to add its inbox.`
            : `Connect ${account.email} and approve read-only Gmail access to add its inbox.`,
        });
        continue;
      }
      try {
        messages = messages.concat(await priorityMail(token, account.source));
        connections[account.source] = true;
      } catch (err) {
        trackUsage(
          "Google Gmail",
          `Load priority inbox (${account.source})`,
          "error",
        );
        notices.push({
          account: account.kind,
          text: `${account.email}: ${err.message}`,
        });
      }
    }
    messages.sort((a, b) => b.sortTime - a.sortTime);
    return res.status(200).json({
      messages,
      connections,
      notices,
      // Older pages read a single notice.
      notice: notices[0]?.text,
    });
  } catch (err) {
    trackUsage("Google Gmail", "Load priority inbox", "error");
    return res.status(500).json({ error: err.message });
  }
};
