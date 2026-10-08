// Inbox: priority mail from the personal and work Gmail accounts.
async function loadInbox() {
  try {
    const d = await getJSON("/api/inbox");
    state.mail = d.messages || [];
    state.inboxConnections = d.connections || {};
    state.inboxNotices =
      d.notices || (d.notice ? [{ account: "owner", text: d.notice }] : []);
    state.inboxError = "";
  } catch (e) {
    state.mail = [];
    state.inboxNotices = [];
    state.inboxError = e.message;
  }
  renderInbox();
}
function renderInbox() {
  const filtered = state.mail.filter(
    (m) => state.mailFilter === "all" || m.source === state.mailFilter,
  );
  $("#mailList").innerHTML = filtered.length
    ? filtered
        .map(
          (m) =>
            `<a class="mail-row unread" href="${attr(m.link || "https://mail.google.com/")}" target="_blank" rel="noopener noreferrer" title="Open in Gmail"><i class="priority-dot"></i><div class="mail-from">${esc(m.from || "Unknown")}<small class="mail-account ${attr(m.source)}">${m.source === "work" ? "Exos work" : "Personal"}</small></div><div><div class="mail-subject">${esc(m.subject || "(no subject)")}</div><span class="mail-snippet">${esc(m.snippet || "")}</span></div><div class="mail-time">${esc(m.received || "")}</div></a>`,
        )
        .join("")
    : inboxEmptyHTML();
  $("#inboxNotices").innerHTML = inboxNoticesHTML();
  const count = (source) =>
      state.mail.filter((m) => m.source === source).length,
    total = state.mail.length;
  $("#mailGoogleCount").textContent = count("google");
  $("#mailWorkCount").textContent = count("work");
  $("#mailMicrosoftCount").textContent = count("microsoft");
  $("#mailAllCount").textContent = total;
  $("#inboxBadge").hidden = !total;
  $("#inboxBadge").textContent = total;
}
// One line per account that still needs connecting, with its Connect button.
function inboxNoticesHTML() {
  return (state.inboxNotices || [])
    .map(
      (n) =>
        `<div class="inbox-notice"><span>${esc(n.text)}</span><a class="primary-btn inbox-connect" href="/api/auth/start${n.account === "work" ? "?account=work&next=inbox" : ""}">${n.account === "work" ? "Connect work Gmail" : "Connect personal Gmail"}</a></div>`,
    )
    .join("");
}
function inboxEmptyHTML() {
  if (state.inboxError)
    return `<div class="empty-state"><strong>Inbox connection needed</strong><br>${esc(state.inboxError)}<br><a class="primary-btn inbox-connect" href="/api/auth/start">Connect ${esc(OWNER_EMAIL)}</a></div>`;
  const live = Object.entries(state.inboxConnections || {})
    .filter(([source, on]) => on && source !== "microsoft")
    .map(([source]) => (source === "work" ? WORK_EMAIL : OWNER_EMAIL));
  if (!live.length)
    return `<div class="empty-state"><strong>No inbox connected yet</strong><br>Connect an account above to see its important and starred mail here.</div>`;
  return `<div class="empty-state"><strong>No priority messages</strong><br>Nothing unread from the last 30 days is marked important or starred in ${esc(live.join(" or "))}.</div>`;
}
