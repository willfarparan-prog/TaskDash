// Connections: integration status, API usage and the error log (including
// browser errors reported from any page).
async function loadConnections() {
  try {
    const [d, e] = await Promise.all([
      getJSON("/api/connections"),
      getJSON("/api/errors").catch(() => ({ errors: [] })),
    ]);
    state.authRequired = false;
    state.connections = d.connections || [];
    state.usage = d.usage || state.usage;
    state.errors = e.errors || [];
  } catch {
    state.connections = fallbackConnections();
  }
}
function renderConnections() {
  const list = state.connections.length
      ? state.connections
      : fallbackConnections(),
    live = list.filter((c) => c.status === "connected").length;
  $("#connectedTotal").textContent = `${live} / ${list.length}`;
  $("#apiCalls").textContent = Number(state.usage.calls || 0).toLocaleString();
  $("#aiTokens").textContent = Number(state.usage.tokens || 0).toLocaleString();
  $("#apiCredits").textContent =
    state.usage.credits == null ? "—" : state.usage.credits;
  $("#connectionsGrid").innerHTML = list
    .map(
      (c) =>
        `<article class="connection-card"><div class="connection-logo">${esc(c.initials || c.name.slice(0, 2).toUpperCase())}</div><div><h3>${esc(c.name)}</h3><p>${esc(c.detail || "")}</p></div><span class="conn-status ${c.status}">${esc(c.status === "connected" ? "LIVE" : c.status === "attention" ? "ACTION NEEDED" : "READY LATER")}</span></article>`,
    )
    .join("");
  const runs = state.usage.runs || [];
  $("#runRows").innerHTML = runs.length
    ? runs
        .map(
          (r) =>
            `<tr><td><strong>${esc(r.service)}</strong></td><td>${esc(r.operation)}</td><td><span class="service-pill">${esc(r.status)}</span></td><td>${r.calls || 1}</td><td>${shortDate(r.last_run)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5"><div class="empty-state compact">Usage tracking begins with this dashboard release.</div></td></tr>';
  $("#connectionPin").classList.toggle("live", live === list.length);
  $("#errorLog").innerHTML = state.errors.length
    ? state.errors
        .map(
          (e) =>
            `<div class="error-row"><span>${esc(e.source)}</span><p>${esc(e.message)}</p><time>${shortDate(e.created_at)} ${fmtTime(new Date(e.created_at))}</time></div>`,
        )
        .join("")
    : '<div class="empty-state compact">No errors recorded. Server and browser errors will be listed here.</div>';
  renderReadiness();
}
// Browser crashes are sent to the error log (at most 5 per page load).
let errorsReported = 0;
function reportBrowserError(message, stack = "") {
  if (errorsReported++ >= 5 || !message) return;
  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      where: state.view,
      message: String(message),
      stack: String(stack),
    }),
  }).catch(() => {});
}
window.addEventListener("error", (e) =>
  reportBrowserError(e.message, e.error?.stack),
);
window.addEventListener("unhandledrejection", (e) =>
  reportBrowserError(e.reason?.message || e.reason, e.reason?.stack),
);
function fallbackConnections() {
  return [
    {
      name: "Neon database",
      initials: "N",
      status: "connected",
      detail: "Tasks, clients, programs, and events",
    },
    {
      name: "Google",
      initials: "G",
      status: state.calendarConnected ? "connected" : "attention",
      detail: `Personal data: ${OWNER_EMAIL} · operator: ${WORK_EMAIL}`,
    },
    {
      name: "Work Scheduler Calendar",
      initials: "WC",
      status: state.scheduler.workCalendar.connected
        ? "connected"
        : "attention",
      detail: `Booking sync · ${WORK_EMAIL}`,
    },
    {
      name: "Adobe Microsoft",
      initials: "M",
      status: "queued",
      detail: "Work inbox · connection not authorized yet",
    },
    {
      name: "Claude assistant",
      initials: "C",
      status: "queued",
      detail: "Daily overview and drafting",
    },
    {
      name: "GitHub",
      initials: "GH",
      status: "connected",
      detail: "willfarparan-prog/TaskDash",
    },
    {
      name: "Vercel",
      initials: "V",
      status: "connected",
      detail: "task-dash production",
    },
  ];
}
