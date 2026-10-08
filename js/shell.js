// App shell: start-up, navigation between views, refresh, settings, quick
// add and global search.
document.addEventListener("DOMContentLoaded", init);
async function init() {
  wireNavigation();
  wireControls();
  applySettings();
  renderShellDate();
  await refreshAll();
  routeFromHash();
  watchForNewDay();
}
// "Today" is fixed when the page loads, so a tab left open overnight reloads
// itself on the new day — but never mid-session or with a form open.
function watchForNewDay() {
  const check = () => {
    if (document.hidden || ymd(new Date()) === todayKey) return;
    if (state.live || $("#formDialog").open) return;
    location.reload();
  };
  document.addEventListener("visibilitychange", check);
  setInterval(check, 5 * 60 * 1000);
}
function wireNavigation() {
  $("#sideNav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) go(b.dataset.view);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) go(b.dataset.go);
  });
  window.addEventListener("hashchange", routeFromHash);
  $("#mobileMenu").onclick = () => toggleRail(true);
  $("#mobileScrim").onclick = () => toggleRail(false);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#globalSearch").focus();
    }
    if (e.key === "Escape") toggleRail(false);
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === "z" &&
      !$("#programEditor").hidden &&
      !e.target.matches("input, select, textarea")
    ) {
      e.preventDefault();
      stepProgramHistory(e.shiftKey ? "redo" : "undo");
    }
  });
  $("#globalSearch").addEventListener("input", (e) =>
    globalSearch(e.target.value),
  );
}
function go(view) {
  location.hash = view === "dashboard" ? "" : view;
  state.view = view;
  renderRoute();
  toggleRail(false);
}
function routeFromHash() {
  const hash = decodeURIComponent(location.hash.slice(1)) || "dashboard";
  // Client profiles have their own address: #client/<id>.
  const client = /^client\/(.+)$/.exec(hash);
  if (client) {
    if (client[1] !== state.activeClient) openClientProfile(client[1]);
    else {
      state.view = "client";
      renderRoute();
    }
    return;
  }
  // A consult has its own address too: #consult/<id>.
  const consult = /^consult\/(\d+)$/.exec(hash);
  if (consult) return openConsult(consult[1]);
  state.view = document.getElementById(`view-${hash}`) ? hash : "dashboard";
  renderRoute();
}
function renderRoute() {
  // Leaving a consult page: make sure the last answers are saved.
  if (state.view !== "consult" && state.consult?.unsaved) saveConsult();
  $$(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${state.view}`),
  );
  // A client's page sits under Clients in the sidebar.
  const section = ["client", "consult"].includes(state.view)
    ? "clients"
    : state.view;
  $$(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === section),
  );
  const active = $(`#view-${state.view}`),
    title =
      state.view === "client"
        ? state.clients.find((c) => String(c.id) === state.activeClient)
            ?.name || "Client"
        : state.view === "consult"
          ? state.consult
            ? `PT consult · ${state.consult.client?.name || ""}`
            : "PT consult"
          : active?.dataset.title || "Dashboard";
  $("#crumbTitle").textContent = title;
  document.title = `${title} · Task Dash`;
  if (state.view === "client") renderClientProfile();
  if (state.view === "calendar") renderCalendar();
  if (state.view === "scheduler") renderScheduler();
  if (state.view === "resources") renderLinks();
  if (state.view === "programs") renderPrograms();
  if (state.view === "clients") renderClients();
  if (state.view === "docs") renderDocs();
  if (state.view === "inbox") {
    loadInbox();
    renderInbox();
  }
  if (state.view === "events") renderEvents();
  if (state.view === "connections") renderConnections();
}
function toggleRail(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#mobileScrim").classList.toggle("show", open);
}
function wireControls() {
  $("#refreshBtn").onclick = refreshAll;
  $("#briefRefresh").onclick = renderDashboard;
  $("#taskAdd").onclick = addTask;
  $("#taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTask();
  });
  $("#taskList").addEventListener("change", toggleTask);
  $("#taskList").addEventListener("click", taskRowAction);
  $("#taskSmart").onclick = smartAddTask;
  $("#taskManage").onclick = openTaskManager;
  $("#quickAddBtn").onclick = openQuickAdd;
  $("#addBlockOpen").onclick = openBlockDialog;
  $("#calendarConnect").onclick = () => (location.href = "/api/auth/start");
  $("#workCalendarWeekConnect").onclick = () =>
    (location.href = "/api/auth/start?account=work");
  $("#prevWeek").onclick = () => shiftCalendarWeek(-1);
  $("#nextWeek").onclick = () => shiftCalendarWeek(1);
  $("#openBookingPage").onclick = () =>
    window.open(state.scheduler.publicUrl, "_blank", "noopener");
  $("#copyBookingLink").onclick = copyBookingLink;
  $("#copyBookingLinkInline").onclick = copyBookingLink;
  $("#workCalendarConnect").onclick = () =>
    (location.href = "/api/auth/start?account=work");
  $("#saveSchedule").onclick = saveSchedule;
  $("#scheduleHours").addEventListener("change", scheduleHoursChange);
  $("#bookingList").addEventListener("click", cancelBooking);
  $("#newProgramBtn").onclick = () => openProgramDialog();
  $("#programSearch").oninput = renderPrograms;
  $("#stockFilters").onchange = (e) => {
    const key = e.target.dataset.stockFilter;
    if (key) state.stockFilters[key] = e.target.value;
    renderPrograms();
  };
  $("#stockFilters").onclick = (e) => {
    if (e.target.dataset.stockFilter !== "clear") return;
    state.stockFilters = { days: "", emphasis: "", source: "" };
    renderPrograms();
  };
  $("#programFilters").onclick = (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    state.programFilter = b.dataset.filter;
    $$("#programFilters button").forEach((x) =>
      x.classList.toggle("active", x === b),
    );
    renderPrograms();
  };
  $("#programGrid").onclick = programAction;
  $("#programEditor").onclick = programEditorAction;
  $("#programEditor").addEventListener("focusin", (e) => {
    if (e.target.matches("input, select"))
      state.programHistory.pending = programSnapshot();
  });
  $("#programEditor").addEventListener("change", (e) => {
    const pending = state.programHistory.pending;
    if (!pending || !e.target.matches("input, select")) return;
    state.programHistory.pending = programSnapshot();
    if (!sameSnapshot(pending, state.programHistory.pending))
      recordProgramEdit(pending);
  });
  $("#newClientBtn").onclick = openClientDialog;
  $("#wrapUpDialog").addEventListener("click", wrapupClick);
  $("#wrapUpDialog").addEventListener("change", wrapupChange);
  $("#wrapupSettingsCard").addEventListener("click", wrapupSettingsClick);
  $("#wrapupQueue").addEventListener("click", (e) => {
    const row = e.target.closest("[data-wrapup]");
    if (row) openWrapUp(row.dataset.wrapup);
  });
  $("#newConsultBtn").onclick = () => openNewConsultDialog();
  $("#consultView").addEventListener("input", consultInput);
  $("#consultView").addEventListener("change", consultInput);
  $("#consultView").addEventListener("click", consultClick);
  $("#bookingList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-start-consult]");
    if (!b) return;
    const booking = state.scheduler.bookings?.find(
      (x) => String(x.id) === b.dataset.startConsult,
    );
    if (booking)
      openNewConsultDialog({
        name: booking.visitor_name,
        email: booking.visitor_email || "",
        bookingCode: booking.booking_code,
      });
  });
  $("#clientSearch").oninput = renderClients;
  $("#clientTypeFilter").onchange = renderClients;
  $("#clientRows").onclick = clientAction;
  $("#addDocBtn").onclick = () => openAddDocDialog();
  $("#docSearch").oninput = renderDocs;
  $("#docFilters").onclick = (e) => {
    const b = e.target.closest("[data-doc-filter]");
    if (!b) return;
    state.docFilter = b.dataset.docFilter;
    renderDocs();
  };
  $("#docList").onclick = docAction;
  $("#clientProfile").addEventListener("click", clientProfileAction);
  $("#liveSession").addEventListener("input", liveInput);
  $("#liveSession").addEventListener("change", liveChange);
  $("#liveSession").addEventListener("click", liveClick);
  $("#clientProfile").addEventListener("change", clientProfileAction);
  $("#onboardingQueue").onclick = (e) => {
    const row = e.target.closest("[data-client]");
    if (row) openClientProfile(row.dataset.client);
  };
  $("#inboxRefresh").onclick = loadInbox;
  $$(".source-filter").forEach(
    (b) =>
      (b.onclick = () => {
        state.mailFilter = b.dataset.source;
        $$(".source-filter").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        renderInbox();
      }),
  );
  $("#newEventBtn").onclick = openEventDialog;
  $("#eventBoard").addEventListener("change", (e) => {
    if (e.target.matches("[data-report-field],[data-report-setting]"))
      reportChange(e);
    else if (e.target.matches("[data-draft-text]")) saveDraftEdit(e);
    else if (e.target.matches("[data-survey-field]")) surveyStatsChange(e);
    else if (e.target.matches(".step-check")) eventStepChange(e);
  });
  $("#eventBoard").addEventListener("click", eventAction);
  // <details> toggle doesn't bubble; capture it to remember open draft panels.
  $("#eventBoard").addEventListener(
    "toggle",
    (e) => {
      const report = e.target.matches(".report-panel");
      if (!report && !e.target.matches(".draft-panel")) return;
      const id = e.target.closest(".event-card")?.dataset.id;
      if (!id) return;
      const set = report ? state.openReports : state.openDrafts;
      if (e.target.open) set.add(id);
      else set.delete(id);
      rememberOpenDrafts();
    },
    true,
  );
  $("#saveSettings").onclick = saveSettings;
  $("#clearLocal").onclick = clearLocal;
  $$(".link-search").forEach((input) => (input.oninput = renderLinks));
  $$(".resource-filters").forEach(
    (filters) =>
      (filters.onclick = (e) => {
        const b = e.target.closest("[data-link-filter]");
        if (!b) return;
        state.linkFilter = b.dataset.linkFilter;
        renderLinks();
      }),
  );
}
async function refreshAll() {
  $("#refreshBtn").classList.add("loading");
  await Promise.allSettled([
    loadTasks(),
    loadEvents(),
    loadClients(),
    loadPrograms(),
    loadCalendar(),
    loadConnections(),
    loadLinks(),
    loadScheduler(),
    loadDocs(),
    loadWrapupSettings(),
  ]);
  renderEverything();
  $("#refreshBtn").classList.remove("loading");
}
function renderEverything() {
  renderWrapupSettings();
  renderAuthGate();
  renderDashboard();
  renderCalendar();
  renderScheduler();
  renderPrograms();
  renderClients();
  renderInbox();
  renderEvents();
  renderConnections();
  renderDocs();
}
function renderAuthGate() {
  $("#ownerGate").hidden = !state.authRequired;
}
function renderShellDate() {
  const hour = today.getHours();
  $("#greeting").textContent =
    `Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${state.settings.name.split(" ")[0] || "Will"}.`;
  $("#todayStamp").textContent = today
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}
function applySettings() {
  $("#settingName").value = state.settings.name;
  $("#settingCoach").value = state.settings.coach;
  $("#settingFooter").value = state.settings.footer;
  $("#settingShift").value = state.settings.shift;
  $("#settingCompleted").checked = state.settings.showCompleted;
}
function saveSettings() {
  state.settings = {
    ...state.settings,
    name: $("#settingName").value.trim() || "William Farparan",
    coach: $("#settingCoach").value.trim(),
    footer: $("#settingFooter").value.trim(),
    shift: $("#settingShift").value,
    showCompleted: $("#settingCompleted").checked,
  };
  writeLocal("taskdash_settings", state.settings);
  renderShellDate();
  renderDashboard();
  $("#settingsSaved").textContent = "Saved just now.";
  toast("Settings saved");
}
function clearLocal() {
  [
    "taskdash_settings",
    "taskdash_clients",
    "taskdash_sessions",
    "taskdash_programs",
    "taskdash_events",
  ].forEach((k) => localStorage.removeItem(k));
  toast("Local cache cleared");
}
function openQuickAdd() {
  openDialog({
    kicker: "QUICK ADD",
    title: "What are you adding?",
    fields: [
      [
        "type",
        "Item type",
        "select",
        ["Task", "Client", "Session", "Program", "Event", "Calendar block"],
      ],
    ],
    submit: (v) => {
      const action = {
        Task: () => {
          $("#taskInput").focus();
        },
        Client: openClientDialog,
        Program: openProgramDialog,
        Event: openEventDialog,
        "Calendar block": openBlockDialog,
        Session: () => go("clients"),
      }[v.type];
      setTimeout(() => action?.(), 80);
    },
  });
}
function globalSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return;
  const found = [
    ["clients", state.clients],
    ["programs", state.programs],
    ["events", state.events],
    ["dashboard", state.tasks],
  ].find(([, items]) =>
    items.some((x) => JSON.stringify(x).toLowerCase().includes(q)),
  );
  if (found) go(found[0]);
}
