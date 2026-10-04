const { ensureWorkspaceSchema, trackUsage } = require("../lib/db");
const { OWNER_EMAIL, getVerifiedGoogleToken } = require("../lib/google");
const { requireOwnerSession } = require("../lib/session");

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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET")
    return res.status(405).json({ error: "method not allowed" });
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const token = await getVerifiedGoogleToken();
    const connections = { google: false, microsoft: false };
    const messages = [];

    if (token && String(token.scope || "").includes("gmail.readonly")) {
      connections.google = true;
      const listResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?" +
          new URLSearchParams({
            q: "is:unread (is:important OR is:starred) newer_than:30d",
            maxResults: "20",
          }),
        { headers: { Authorization: `Bearer ${token.access_token}` } },
      );
      const list = await listResponse.json();
      if (!listResponse.ok)
        throw new Error(list.error?.message || "Gmail could not be loaded");
      const details = await Promise.all(
        (list.messages || []).slice(0, 20).map(async (item) => {
          const response = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token.access_token}` } },
          );
          return response.ok ? response.json() : null;
        }),
      );
      for (const item of details.filter(Boolean)) {
        const headers = item.payload?.headers || [];
        messages.push({
          id: item.id,
          source: "google",
          from: shortSender(headerValue(headers, "From")),
          subject: headerValue(headers, "Subject") || "(no subject)",
          snippet: item.snippet || "",
          received: new Date(headerValue(headers, "Date")).toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric" },
          ),
        });
      }
      trackUsage("Google Gmail", "Load priority inbox", "ok", {
        calls: 1 + details.length,
      });
    }

    if (!connections.google) {
      return res.status(200).json({
        messages,
        connections,
        notice: `Reconnect Google and approve read-only Gmail access for ${OWNER_EMAIL}. Microsoft remains disconnected until the Adobe work account is authorized.`,
      });
    }
    return res.status(200).json({ messages, connections });
  } catch (err) {
    trackUsage("Google Gmail", "Load priority inbox", "error");
    return res.status(500).json({ error: err.message });
  }
};
