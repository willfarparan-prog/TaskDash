// Resource hub: private work links and pinned docs.
async function loadLinks() {
  try {
    state.links = ((await getJSON("/api/links")).links || [])
      .filter((l) => /^https?:\/\//.test(l.url || ""))
      .map((link) => ({ ...link, url: workAccountUrl(link.url) }));
    state.linkError = "";
  } catch (e) {
    state.links = [];
    state.linkError =
      e.message.includes("401") || e.message.includes("Connect Google")
        ? `Sign in as ${WORK_EMAIL} or ${OWNER_EMAIL} to unlock private work links.`
        : "Private work links load after sign-in on the deployed dashboard.";
  }
}
// Pinned docs also show at the top of the Resource hub.
function renderPinnedDocs() {
  const box = $("#pinnedDocs");
  if (!box) return;
  const pinned = state.docs.filter((d) => d.pinned);
  box.hidden = !pinned.length;
  box.innerHTML = pinned.length
    ? `<span class="kicker">PINNED DOCS</span><div>${pinned
        .map(
          (d) =>
            `<a href="${attr(d.kind === "file" ? `/api/docs?file=${encodeURIComponent(d.id)}` : workAccountUrl(d.url))}" target="_blank" rel="noopener noreferrer"><b>${esc(docKindLabel(d))}</b>${esc(d.title)}</a>`,
        )
        .join("")}</div>`
    : "";
}
function renderLinks() {
  renderPinnedDocs();
  const hubs = $$(".resource-hub");
  if (!hubs.length) return;
  const categories = [...new Set(state.links.map((l) => l.category))],
    labels = {
      communication: "Communication",
      coaching: "Coaching",
      programming: "Classes & programs",
      operations: "Operations",
      resources: "Resources & SOPs",
      tracking: "Tracking",
      reporting: "Reporting",
      daily: "Daily",
      forms: "Forms",
      hr_sop: "HR & policy",
      marketing: "Marketing",
    };
  hubs.forEach((hub) => {
    const grid = $(".resource-grid", hub),
      filters = $(".resource-filters", hub),
      context = $(".resource-context", hub),
      search = $(".link-search", hub);
    if (!state.links.length) {
      filters.innerHTML = "";
      context.innerHTML = "";
      grid.innerHTML = `<div class="empty-state compact resource-locked"><strong>Your links are saved privately.</strong><span>${esc(state.linkError || "No work links are available yet.")}</span><a class="primary-btn resource-connect" href="/api/auth/start?account=operator">Sign in as ${WORK_EMAIL}</a></div>`;
      return;
    }
    filters.innerHTML =
      `<button class="${state.linkFilter === "all" ? "active" : ""}" data-link-filter="all">All</button>` +
      categories
        .map(
          (c) =>
            `<button class="${state.linkFilter === c ? "active" : ""}" data-link-filter="${attr(c)}">${esc(labels[c] || cap(c.replace("_", " ")))}</button>`,
        )
        .join("");
    const q = (search?.value || "").trim().toLowerCase(),
      visible = state.links.filter(
        (l) =>
          (state.linkFilter === "all" || l.category === state.linkFilter) &&
          (!q ||
            `${l.title} ${l.description || ""} ${l.category}`
              .toLowerCase()
              .includes(q)),
      );
    grid.innerHTML = visible.length
      ? visible
          .map(
            (l) =>
              `<a class="quick-link-card" href="${attr(l.url)}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${esc((l.short || l.title).slice(0, 2).toUpperCase())}</span><span><strong>${esc(l.title)}</strong><small>${esc(l.description || "Open work resource")}</small><em>${esc(l.frequency || labels[l.category] || cap(l.category))}</em></span><b>↗</b></a>`,
          )
          .join("")
      : '<div class="empty-state compact">No links match that search.</div>';
    const pinned = state.links.filter((l) => l.pinned).slice(0, 8);
    context.innerHTML = pinned
      .map(
        (l) =>
          `<a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(l.short || l.title)}</span><small>${esc(l.frequency || "Quick access")}</small><b>↗</b></a>`,
      )
      .join("");
  });
}
function workAccountUrl(value) {
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase(),
      workspaceHosts = new Set([
        "docs.google.com",
        "drive.google.com",
        "calendar.google.com",
        "sites.google.com",
      ]);
    if (host === "mail.google.com") {
      url.pathname = url.pathname.replace(
        /\/mail\/u\/[^/]+\//,
        `/mail/u/${encodeURIComponent(WORK_EMAIL)}/`,
      );
    } else if (workspaceHosts.has(host)) {
      if (host === "calendar.google.com") {
        url.pathname = url.pathname.replace(
          /\/calendar\/u\/[^/]+\//,
          `/calendar/u/${encodeURIComponent(WORK_EMAIL)}/`,
        );
      }
      url.searchParams.set("authuser", WORK_EMAIL);
    }
    return url.toString();
  } catch {
    return value;
  }
}
