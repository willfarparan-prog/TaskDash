/* Task Dash v3 · Apex-inspired coach command center */
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const OWNER_EMAIL = "willfarparan@gmail.com",
  WORK_EMAIL = "william.farparan@teamexos.com",
  PUBLIC_BOOKING_URL = "https://task-dash-umber.vercel.app/book.html",
  DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
const today = new Date(),
  todayKey = ymd(today);
const DEFAULT_BOOKING_SCHEDULE = {
  timezone: "America/Los_Angeles",
  slotMinutes: 30,
  sessionMinutes: 60,
  noticeMinutes: 120,
  bookAheadDays: 21,
  location: "Adobe SF Wellness Center",
  note: "Choose a time that works for you. William will see your reason for visiting before the session.",
  reasons: [
    "Personal training session",
    "PT consultation",
    "InBody scan",
    "Movement or fitness consultation",
    "Other",
  ],
  hours: {
    sun: { enabled: false, start: "09:00", end: "12:00" },
    mon: { enabled: true, start: "09:00", end: "16:00" },
    tue: { enabled: true, start: "09:00", end: "16:00" },
    wed: { enabled: true, start: "09:00", end: "16:00" },
    thu: { enabled: true, start: "09:00", end: "16:00" },
    fri: { enabled: true, start: "09:00", end: "15:00" },
    sat: { enabled: false, start: "09:00", end: "12:00" },
  },
};
const state = {
  view: "dashboard",
  tasks: [],
  events: [],
  openDrafts: new Set(),
  draftStatus: {},
  clients: [],
  sessions: [],
  programs: [],
  mail: [],
  recurTasks: [],
  mealPlanIndex: [],
  activeClient: null,
  clientMealPlans: [],
  clientWorkouts: [],
  docs: [],
  docCategories: [],
  docFilter: "all",
  live: null,
  activeMealPlan: null,
  taskChecks: [],
  calendar: [],
  connections: [],
  usage: { calls: 0, tokens: 0, credits: null, runs: [] },
  authRequired: false,
  links: [],
  linkFilter: "all",
  linkError: "",
  programFilter: "clients",
  mailFilter: "all",
  calendarOffset: 0,
  activeProgram: null,
  stockFilters: { days: "", emphasis: "", source: "" },
  errors: [],
  programHistory: { undo: [], redo: [], pending: null },
  scheduler: {
    settings: structuredClone(DEFAULT_BOOKING_SCHEDULE),
    bookings: [],
    days: [],
    workCalendar: { connected: false },
    publicUrl: PUBLIC_BOOKING_URL,
    ownerReady: false,
  },
  settings: Object.assign(
    {
      name: "William Farparan",
      coach: "William Farparan",
      footer: "Move well. Train with intent.",
      shift: "06:00",
      showCompleted: true,
    },
    readLocal("taskdash_settings", {}),
  ),
};
const PIPE = [
  {
    key: "vendor",
    name: "Escalate vendor + budget to Michelle",
    offset: 35,
    vendor: true,
    owner: "Michelle",
  },
  { key: "date", name: "Pin down event date", offset: 35, owner: "William" },
  {
    key: "room",
    name: "Book the room",
    offset: 28,
    owner: "Sahar",
    parallel: true,
  },
  {
    key: "flyer",
    name: "Create flyer / poster",
    offset: 21,
    owner: "William",
    parallel: true,
  },
  { key: "catering", name: "Confirm catering", offset: 21, owner: "Josh" },
  {
    key: "slack-1",
    name: "Initial Slack post",
    offset: 18,
    owner: "William",
    parallel: true,
  },
  {
    key: "slack-2",
    name: "Secondary Slack post",
    offset: 10,
    owner: "William",
  },
  { key: "slack-3", name: "Third Slack post", offset: 3, owner: "William" },
  {
    key: "day-of",
    name: "Day-of Slack post + badge reader",
    offset: 0,
    owner: "William",
  },
  {
    key: "survey",
    name: "Send Microsoft Forms NPS survey",
    offset: -3,
    owner: "William",
  },
  {
    key: "response",
    name: "Follow up if survey response is under 20%",
    offset: -7,
    owner: "William",
  },
];
// Messaging drafts generated for each event (see lib/eventDrafts.js).
const DRAFT_TYPES = [
  {
    key: "roomEmail",
    step: "room",
    label: "Room & equipment request",
    hint: "Email to Sahar Rasheed",
    email: true,
  },
  {
    key: "flyerPrompt",
    step: "flyer",
    label: "Flyer / poster prompt",
    hint: "Paste into Nano Banana or Adobe Firefly",
  },
  {
    key: "cateringEmail",
    step: "catering",
    label: "Catering request",
    hint: "Email to Joshua Dougherty",
    email: true,
    needsCatering: true,
  },
  {
    key: "slack1",
    step: "slack-1",
    label: "Initial Slack post",
    hint: "#sf-wellness-center",
  },
  {
    key: "slack2",
    step: "slack-2",
    label: "Secondary Slack post",
    hint: "#sf-wellness-center",
  },
  {
    key: "slack3",
    step: "slack-3",
    label: "Third Slack post",
    hint: "#sf-wellness-center",
  },
  {
    key: "slackDayOf",
    step: "day-of",
    label: "Day-of Slack post",
    hint: "Morning of the event",
  },
  {
    key: "npsEmail",
    step: "survey",
    label: "NPS survey email",
    hint: "BCC all attendees · Microsoft Forms link",
  },
];
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
  const view = location.hash.slice(1) || "dashboard";
  state.view = $(`#view-${view}`) ? view : "dashboard";
  renderRoute();
}
function renderRoute() {
  $$(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${state.view}`),
  );
  $$(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.view),
  );
  const active = $(`#view-${state.view}`);
  $("#crumbTitle").textContent = active?.dataset.title || "Dashboard";
  document.title = `${active?.dataset.title || "Dashboard"} · Task Dash`;
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
    if (e.target.matches("[data-draft-text]")) saveDraftEdit(e);
    else if (e.target.matches(".step-check")) eventStepChange(e);
  });
  $("#eventBoard").addEventListener("click", eventAction);
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
  ]);
  renderEverything();
  $("#refreshBtn").classList.remove("loading");
}
function renderEverything() {
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
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  let data = {};
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    if (r.status === 401) state.authRequired = true;
    throw new Error(data.error || `Request failed (${r.status})`);
  }
  return data;
}
async function loadTasks() {
  try {
    const data = await getJSON(`/api/tasks?day=${todayKey}`);
    state.recurTasks = data.recur || [];
    state.taskChecks = data.checks || [];
    state.tasks = [
      ...scheduledTasks(state.recurTasks, state.taskChecks),
      ...(data.daily || []).map((t) => ({
        id: String(t.id),
        name: t.name,
        // Unfinished one-off tasks from earlier days carry over.
        carried: t.day_key && t.day_key < todayKey ? t.day_key : null,
        cad:
          t.day_key && t.day_key < todayKey
            ? `Added ${shortDate(t.day_key)}`
            : "Today",
        time: "",
        done: !!t.done,
        kind: "daily",
      })),
    ];
  } catch {
    // Offline preview: show the built-in duties on their schedules.
    if (!state.recurTasks.length)
      state.recurTasks = TaskSchedule.BUILTIN_TASKS.map((t) => ({
        ...t,
        source: "builtin",
        created_day: todayKey,
      }));
    state.tasks = scheduledTasks(state.recurTasks, state.taskChecks);
  }
}
// Recurring tasks whose current cycle belongs on today's list.
function scheduledTasks(recur, checks) {
  return recur.flatMap((t) => {
    const keys = checks
        .filter((c) => c.task_id === t.id)
        .map((c) => c.period_key),
      occ = TaskSchedule.occurrenceOn(t, today, keys, t.created_day);
    if (!occ) return [];
    const rule = TaskSchedule.normalizeSchedule(t);
    return [
      {
        id: t.id,
        name: t.name,
        kind: "recur",
        done: occ.done,
        occ,
        rule,
        cad: TaskSchedule.CADENCE_LABELS[rule.cadence],
        time: rule.timeLabel,
      },
    ];
  });
}
async function loadEvents() {
  try {
    state.events = (await getJSON("/api/events")).events || [];
  } catch {
    state.events = readLocal("taskdash_events", []);
  }
}
async function loadClients() {
  try {
    const [d, plans] = await Promise.all([
      getJSON("/api/clients"),
      getJSON("/api/meal-plans").catch(() => ({ mealPlans: [] })),
    ]);
    state.clients = d.clients || [];
    state.sessions = d.sessions || [];
    state.mealPlanIndex = plans.mealPlans || [];
  } catch {
    state.clients = readLocal("taskdash_clients", []);
    state.sessions = readLocal("taskdash_sessions", []);
  }
}
async function loadPrograms() {
  try {
    state.programs = (await getJSON("/api/programs")).programs || [];
  } catch {
    state.programs = readLocal("taskdash_programs", []);
  }
}
async function shiftCalendarWeek(step) {
  state.calendarOffset += step;
  renderCalendar();
  await loadCalendar();
  renderCalendar();
}
async function loadCalendar() {
  try {
    const d = await getJSON(
      `/api/calendar-week?start=${ymd(weekStart(state.calendarOffset))}`,
    );
    state.calendar = d.events || [];
    state.calendarConnected = !!d.connected;
    state.calendarEmail = d.accountEmail || null;
    state.workCalendarConnected = !!d.workConnected;
  } catch {
    state.calendar = [];
    state.calendarConnected = false;
    state.workCalendarConnected = false;
  }
}
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
async function loadScheduler() {
  try {
    const publicData = await getJSON(
      "/api/calendar-manual?resource=availability",
    );
    state.scheduler.days = publicData.days || [];
    state.scheduler.settings = {
      ...state.scheduler.settings,
      ...(publicData.settings || {}),
    };
    state.scheduler.workCalendar.connected = !!publicData.calendarConnected;
  } catch {}
  try {
    const data = await getJSON("/api/calendar-manual?resource=scheduler");
    state.scheduler = {
      ...state.scheduler,
      ...data,
      days: state.scheduler.days,
      ownerReady: true,
    };
    state.scheduler.publicUrl = data.publicUrl || PUBLIC_BOOKING_URL;
  } catch {
    state.scheduler.ownerReady = false;
  }
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
// Overdue first, then due, then open; finished tasks sink to the bottom.
const TASK_ORDER = { over: 0, due: 1, open: 2, done: 3 };
const byUrgency = (a, b) => TASK_ORDER[taskState(a)] - TASK_ORDER[taskState(b)];
// The time note is dropped when the task name already says it ("— AM").
const taskWhen = (t) =>
  t.time && !String(t.name).includes(t.time) ? t.time : t.time ? "" : t.cad;
function renderDashboard() {
  const visible = (
      state.settings.showCompleted
        ? state.tasks
        : state.tasks.filter((t) => !t.done)
    )
      .slice()
      .sort(byUrgency),
    done = state.tasks.filter((t) => t.done).length,
    remaining = state.tasks.length - done,
    overdue = state.tasks.filter(
      (t) => !t.done && taskState(t) === "over",
    ).length,
    sessionsToday = state.sessions.filter(
      (s) => String(s.session_date || "").slice(0, 10) === todayKey,
    ).length;
  $("#attentionCount").textContent = overdue || remaining;
  $("#attentionLabel").textContent = overdue
    ? overdue === remaining
      ? `${overdue} overdue`
      : `${overdue} overdue · ${remaining} open`
    : `${remaining} task${remaining === 1 ? "" : "s"} remaining`;
  $("#sessionCount").textContent = sessionsToday;
  $("#eventCount").textContent = state.events.length;
  $("#metricTasks").textContent = `${done} / ${state.tasks.length}`;
  $("#taskProgress").style.width =
    `${state.tasks.length ? (done / state.tasks.length) * 100 : 0}%`;
  $("#metricClients").textContent = state.clients.length;
  $("#metricPrograms").textContent = activeClientPrograms();
  const live = state.connections.filter((c) => c.status === "connected").length,
    readiness = state.connections.length
      ? Math.round((live / state.connections.length) * 100)
      : 0;
  $("#metricReadiness").textContent = `${readiness}%`;
  $("#readyProgress").style.width = `${readiness}%`;
  $("#todayTaskCount").textContent = `${remaining} open · ${done} done`;
  $("#taskList").innerHTML = visible.length
    ? visible.map(taskHTML).join("")
    : '<div class="empty-state compact">Nothing is due today.</div>';
  const next = state.tasks
      .filter((t) => !t.done)
      .sort(byUrgency)
      .slice(0, 3)
      .map((t) => {
        const when = taskWhen(t);
        return `<li><strong>${esc(t.name)}</strong>${when ? ` · ${esc(when)}` : ""}</li>`;
      })
      .join(""),
    nextEvent = state.events
      .map(normalizeEvent)
      .sort((a, b) => a.date - b.date)
      .find((e) => e.days >= 0);
  $("#dailyBrief").innerHTML =
    `<strong>${overdue ? "Start with the overdue work." : "Your operating queue is under control."}</strong><ul>${next || "<li>No open tasks on today’s list.</li>"}${nextEvent ? `<li><strong>${esc(nextEvent.name)}</strong> is ${nextEvent.days === 0 ? "today" : `in ${nextEvent.days} days`}.</li>` : ""}</ul>`;
  renderOnboardingQueue();
  renderAgenda();
  renderEventPreview();
  renderReadiness();
  renderLinks();
}
function taskHTML(t) {
  const s = taskState(t),
    links = taskResourceLinks(t);
  return `<div class="task-row ${t.done ? "done" : ""}" data-id="${attr(t.id)}" data-kind="${t.kind}"><input class="task-check" type="checkbox" aria-label="Complete ${attr(t.name)}" ${t.done ? "checked" : ""}><div><div class="task-name">${esc(t.name)}</div><div class="task-meta">${esc(t.cad)}${t.time ? ` · ${esc(t.time)}` : ""}${t.occ && !["Daily", "Weekdays"].includes(t.rule.cadence) ? ` · ${esc(TaskSchedule.dueLabel(t.occ))}` : ""}${links.map((l) => ` <a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.short || l.title)} ↗</a>`).join("")}</div></div><span class="task-status ${s}">${t.done ? "DONE" : s === "over" ? "OVERDUE" : s === "due" ? "DUE" : "OPEN"}</span><span class="task-tools"><button class="row-edit" aria-label="Edit task" title="Edit">✎</button><button class="row-delete" aria-label="Delete task" title="Delete">×</button></span></div>`;
}
function taskResourceLinks(t) {
  const keys = {
    inbox: ["work-gmail", "adobe-outlook"],
    workday: ["workday"],
    lab: ["strength-lab"],
    fdt: ["badge-report-sop", "badge-report-claude"],
    class: ["signature-classes-site"],
  };
  return (keys[t.id] || [])
    .map((id) => state.links.find((l) => l.id === id))
    .filter(Boolean);
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
function taskState(t) {
  if (t.done) return "done";
  if (t.occ?.overdue || t.carried) return "over";
  if (t.occ && t.occ.daysUntil > 0) return "open";
  const h = today.getHours();
  if (
    (/AM|Shift/.test(t.time) && h >= 12) ||
    (/2:00/.test(t.time) && h >= 14) ||
    (/PM|EOD/.test(t.time) && h >= 17)
  )
    return "over";
  const everyDay = ["Daily", "Weekdays"].includes(t.rule?.cadence);
  return !everyDay || h >= 11 ? "due" : "open";
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
async function addTask() {
  const input = $("#taskInput"),
    name = input.value.trim();
  if (!name) return;
  input.value = "";
  try {
    await getJSON("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "daily_task", dayKey: todayKey, name }),
    });
    await loadTasks();
  } catch {
    state.tasks.push({
      id: `local-${Date.now()}`,
      name,
      cad: "Today",
      time: "",
      done: false,
      kind: "daily",
    });
  }
  renderDashboard();
  toast("Task added");
}
async function toggleTask(e) {
  const row = e.target.closest(".task-row");
  if (!row) return;
  const t = state.tasks.find((x) => String(x.id) === row.dataset.id);
  if (!t) return;
  t.done = e.target.checked;
  renderDashboard();
  const body =
    t.kind === "daily"
      ? { kind: "daily_task", id: t.id, done: t.done, dayKey: todayKey }
      : {
          kind: "recur_check",
          taskId: t.id,
          periodKey: t.occ.periodKey,
          windowStart: TaskSchedule.ymd(
            new Date(
              t.occ.due.getFullYear(),
              t.occ.due.getMonth(),
              t.occ.due.getDate() - t.rule.leadDays,
            ),
          ),
          done: t.done,
        };
  try {
    await getJSON("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    toast("Saved in this browser only");
  }
}
function taskRowAction(e) {
  const row = e.target.closest(".task-row");
  if (!row) return;
  if (e.target.closest(".row-edit")) {
    const t = state.tasks.find((x) => String(x.id) === row.dataset.id);
    if (t) openTaskDialog(taskDraft(t));
  }
  if (e.target.closest(".row-delete"))
    deleteTask(row.dataset.id, row.dataset.kind);
}
async function deleteTask(id, kind) {
  const recur = kind === "recur",
    name =
      (recur
        ? state.recurTasks.find((t) => t.id === id)
        : state.tasks.find((t) => String(t.id) === id)
      )?.name || "this task";
  if (
    recur &&
    !confirm(`Delete “${name}”? It won't come back on future cycles.`)
  )
    return;
  state.tasks = state.tasks.filter((t) => String(t.id) !== id);
  if (recur) state.recurTasks = state.recurTasks.filter((t) => t.id !== id);
  renderDashboard();
  try {
    await getJSON(
      `/api/tasks?id=${encodeURIComponent(id)}${recur ? "&kind=recur" : ""}`,
      { method: "DELETE" },
    );
  } catch {}
  toast("Task deleted");
}
// Form values for an existing task (dashboard row or recur_tasks record).
function taskDraft(t) {
  if (t.kind === "daily")
    return { id: t.id, kind: "daily", name: t.name, repeat: "Once" };
  const source = state.recurTasks.find((x) => x.id === t.id) || t,
    rule = TaskSchedule.normalizeSchedule(source);
  return {
    id: source.id,
    kind: "recur",
    name: source.name,
    repeat: rule.cadence,
    ...rule,
  };
}
const REPEAT_OPTIONS = [
  "Once|Just today",
  "Daily|Every day",
  "Weekdays|Every weekday (Mon–Fri)",
  "Weekly|Weekly",
  "Biweekly|Every 2 weeks",
  "Monthly|Monthly",
];
const WEEKDAY_OPTIONS = DOW.map((d, i) => `${i}|${d}`);
const MONTH_DAY_OPTIONS = [
  ...Array.from(
    { length: 31 },
    (_, i) => `${i + 1}|${TaskSchedule.ordinal(i + 1)}`,
  ),
  "0|Last day of the month",
];
const LEAD_OPTIONS = [
  "0|On the due date",
  "1|1 day early",
  "2|2 days early",
  "3|3 days early",
  "4|4 days early",
  "5|5 days early",
  "6|The week before",
  "13|2 weeks early",
];
// Dialog selects use "value|label" options; these map between the two.
const optionFor = (options, value) =>
  options.find((o) => o.split("|")[0] === String(value)) || options[0];
const optionValue = (choice) => String(choice).split("|")[0];
// One form for adding or editing any task. `draft.kind` is "daily" or
// "recur" for an existing task, and absent for a new one.
function openTaskDialog(draft = {}) {
  const weekday = draft.weekday ?? today.getDay(),
    anchor =
      draft.anchorDate ||
      TaskSchedule.ymd(
        TaskSchedule.nextDue({ cadence: "Weekly", weekday }, today),
      );
  openDialog({
    kicker: draft.kind ? "EDIT TASK" : "NEW TASK",
    title: draft.kind ? "Change this task" : "Add a task",
    fields: [
      ["name", "Task", "text", "What needs doing?", draft.name || ""],
      [
        "repeat",
        "Repeats",
        "select",
        REPEAT_OPTIONS,
        optionFor(REPEAT_OPTIONS, draft.repeat || "Once"),
      ],
      [
        "weekday",
        "Day of the week",
        "select",
        WEEKDAY_OPTIONS,
        optionFor(WEEKDAY_OPTIONS, weekday),
      ],
      ["anchorDate", "First due date", "date", "", anchor],
      [
        "monthDay",
        "Day of the month",
        "select",
        MONTH_DAY_OPTIONS,
        optionFor(MONTH_DAY_OPTIONS, draft.monthDay ?? 1),
      ],
      [
        "leadDays",
        "Show it",
        "select",
        LEAD_OPTIONS,
        optionFor(LEAD_OPTIONS, draft.leadDays ?? 0),
      ],
      [
        "timeLabel",
        "Time note (optional)",
        "text",
        "AM, By 2:00p, EOD",
        draft.timeLabel || "",
      ],
    ],
    submit: (v) => saveTaskForm(draft, v),
  });
  // Only show the schedule fields that apply to the chosen repeat.
  const form = $("#dialogForm"),
    sync = () => {
      const r = optionValue(form.elements.repeat.value),
        show = {
          weekday: r === "Weekly",
          anchorDate: r === "Biweekly",
          monthDay: r === "Monthly",
          leadDays: ["Weekly", "Biweekly", "Monthly"].includes(r),
          timeLabel: r !== "Once",
        };
      for (const [name, visible] of Object.entries(show))
        form.elements[name].closest("label").hidden = !visible;
    };
  form.elements.repeat.onchange = sync;
  sync();
}
async function saveTaskForm(draft, form) {
  const v = {
      ...form,
      repeat: optionValue(form.repeat),
      weekday: optionValue(form.weekday),
      monthDay: optionValue(form.monthDay),
      leadDays: optionValue(form.leadDays),
    },
    name = v.name.trim();
  if (!name) throw new Error("Give the task a name");
  const json = (method, body) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const schedule = {
    name,
    cadence: v.repeat,
    weekday: v.weekday,
    monthDay: v.monthDay,
    anchorDate: v.anchorDate,
    leadDays: v.leadDays,
    timeLabel: v.timeLabel,
  };
  if (v.repeat === "Once") {
    if (draft.kind === "daily")
      await getJSON(
        "/api/tasks",
        json("PATCH", { kind: "daily_task", id: draft.id, name }),
      );
    else
      await getJSON(
        "/api/tasks",
        json("POST", { type: "daily_task", dayKey: todayKey, name }),
      );
  } else if (draft.kind === "recur") {
    await getJSON(
      "/api/tasks",
      json("PATCH", { kind: "recur_task", id: draft.id, ...schedule }),
    );
  } else {
    await getJSON(
      "/api/tasks",
      json("POST", { type: "recur_task", ...schedule }),
    );
  }
  // A task that switched between one-off and repeating leaves its old record.
  if (draft.kind === "daily" && v.repeat !== "Once")
    await getJSON(`/api/tasks?id=${encodeURIComponent(draft.id)}`, {
      method: "DELETE",
    });
  if (draft.kind === "recur" && v.repeat === "Once")
    await getJSON(`/api/tasks?id=${encodeURIComponent(draft.id)}&kind=recur`, {
      method: "DELETE",
    });
  await loadTasks();
  renderDashboard();
  toast(draft.kind ? "Task updated" : "Task added");
}
// Smart add: Claude reads the sentence and pre-fills the task form.
async function smartAddTask() {
  const input = $("#taskInput"),
    text = input.value.trim();
  if (!text) {
    openTaskDialog();
    return;
  }
  const btn = $("#taskSmart");
  btn.disabled = true;
  btn.textContent = "Reading…";
  let draft = { name: text };
  try {
    draft = await getJSON("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "parse_task", text, dayKey: todayKey }),
    });
  } catch (err) {
    toast(err.message || "Smart add is unavailable; fill in the schedule");
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Smart add";
  }
  input.value = "";
  openTaskDialog(draft);
}
// Every repeating task, including ones not due today.
function openTaskManager() {
  openDialog({
    kicker: "OPERATING QUEUE",
    title: "Repeating tasks",
    fields: [],
    submit: () => {},
  });
  $("#dialogFields").innerHTML = state.recurTasks.length
    ? `<div class="task-manager">${state.recurTasks
        .map(
          (t) =>
            `<div class="task-manager-row" data-id="${attr(t.id)}"><div><strong>${esc(t.name)}</strong><span>${esc(TaskSchedule.describe(t))}${t.time_label || t.timeLabel ? ` · ${esc(t.time_label || t.timeLabel)}` : ""}</span></div><button type="button" class="row-edit" aria-label="Edit ${attr(t.name)}">✎</button><button type="button" class="row-delete" aria-label="Delete ${attr(t.name)}">×</button></div>`,
        )
        .join(
          "",
        )}</div><button type="button" class="secondary-btn task-manager-add">＋ New task</button>`
    : '<div class="empty-state compact">No repeating tasks yet.</div><button type="button" class="secondary-btn task-manager-add">＋ New task</button>';
  $("#dialogSubmit").textContent = "Done";
  $("#dialogFields").onclick = async (e) => {
    const row = e.target.closest(".task-manager-row");
    if (e.target.closest(".task-manager-add")) {
      openTaskDialog({ repeat: "Weekly" });
      return;
    }
    if (!row) return;
    const t = state.recurTasks.find((x) => x.id === row.dataset.id);
    if (!t) return;
    if (e.target.closest(".row-edit"))
      openTaskDialog(taskDraft({ ...t, kind: "recur" }));
    if (e.target.closest(".row-delete")) {
      await deleteTask(t.id, "recur");
      openTaskManager();
    }
  };
}
function renderAgenda() {
  const events = state.calendar
    .map((e) => ({ ...e, date: new Date(e.start) }))
    .filter((e) => e.date >= startOfDay(today))
    .sort((a, b) => a.date - b.date)
    .slice(0, 5);
  $("#agendaList").innerHTML = events.length
    ? events
        .map(
          (e) =>
            `<div class="agenda-row"><div class="agenda-date"><strong>${e.date.getDate()}</strong><small>${DOW[e.date.getDay()]}</small></div><i class="agenda-line ${attr(e.source || "")}"></i><div class="agenda-body"><strong>${esc(e.title)}</strong><span>${e.allDay ? "All day" : fmtTime(e.date)} · ${esc(cap(e.source || "calendar"))}</span></div></div>`,
        )
        .join("")
    : '<div class="empty-state compact">No connected calendar items this week.</div>';
}
function renderEventPreview() {
  const list = state.events
    .map(normalizeEvent)
    .sort((a, b) => a.date - b.date)
    .slice(0, 4);
  $("#eventPreview").innerHTML = list.length
    ? list
        .map((e) => {
          const steps = eventSteps(e.raw),
            done = steps.filter((s) => s.done).length;
          return `<div class="preview-event"><header><strong>${esc(e.name)}</strong><span>${e.days >= 0 ? `${e.days}d out` : "past"}</span></header><div class="track"><i style="width:${steps.length ? (done / steps.length) * 100 : 0}%"></i></div><span>${done} of ${steps.length} SOP steps complete · ${fmtDate(e.date)}</span></div>`;
        })
        .join("")
    : '<div class="empty-state compact">No active events. Add a date and the SOP will build itself.</div>';
}
function renderReadiness() {
  const sample = state.connections.length
    ? state.connections.slice(0, 6)
    : fallbackConnections();
  $("#readinessList").innerHTML = sample
    .map(
      (c) =>
        `<div class="ready-row"><i class="ready-dot ${c.status === "connected" ? "live" : c.status === "attention" ? "attention" : ""}"></i><span>${esc(c.name)}</span><em>${esc(cap(c.status || "queued"))}</em></div>`,
    )
    .join("");
}
function weekStart(offset = 0) {
  const d = new Date(today),
    day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function renderCalendar() {
  const start = weekStart(state.calendarOffset),
    end = new Date(start);
  end.setDate(end.getDate() + 6);
  $("#calendarRange").textContent =
    `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  $("#calendarBanner strong").textContent = state.calendarConnected
    ? "Google calendar connected"
    : "Connect Google calendar";
  $("#calendarBanner span").textContent = state.calendarConnected
    ? `${state.calendarEmail || OWNER_EMAIL} · read-only sync`
    : `Only ${OWNER_EMAIL} is allowed`;
  $("#calendarConnect").textContent = state.calendarConnected
    ? "Connected"
    : "Connect";
  $("#calendarConnect").disabled = state.calendarConnected;
  $("#workCalendarWeekBanner strong").textContent = state.workCalendarConnected
    ? "Work Google calendar connected"
    : "Connect work Google calendar";
  $("#workCalendarWeekBanner span").textContent = state.workCalendarConnected
    ? `${WORK_EMAIL} · events show in purple`
    : `Only ${WORK_EMAIL} is allowed`;
  $("#workCalendarWeekConnect").textContent = state.workCalendarConnected
    ? "Connected"
    : "Connect";
  $("#workCalendarWeekConnect").disabled = state.workCalendarConnected;
  let html = '<div class="cal-corner"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    html += `<div class="cal-day-head ${ymd(d) === todayKey ? "today" : ""}"><span>${DOW[d.getDay()]}</span><strong>${d.getDate()}</strong></div>`;
  }
  html += '<div class="time-axis">';
  for (let h = 6; h <= 18; h += 2)
    html += `<span style="top:${((h - 6) / 12) * 100}%">${h > 12 ? h - 12 : h}${h >= 12 ? "p" : "a"}</span>`;
  html += "</div>";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = ymd(d);
    html += `<div class="cal-day" data-date="${key}">${state.calendar
      .filter((e) => String(e.start).slice(0, 10) === key)
      .map(calendarEventHTML)
      .join("")}</div>`;
  }
  $("#weekCalendar").innerHTML = html;
}
function calendarEventHTML(e) {
  if (e.allDay)
    return `<div class="cal-event ${attr(e.source || "")}" style="top:4px;height:28px"><strong>${esc(e.title)}</strong></div>`;
  const s = new Date(e.start),
    en = new Date(e.end),
    top = Math.max(0, ((s.getHours() + s.getMinutes() / 60 - 6) / 12) * 100),
    height = Math.max(4, ((en - s) / 36e5 / 12) * 100);
  return `<div class="cal-event ${attr(e.source || "")}" style="top:${top}%;height:${height}%"><strong>${esc(e.title)}</strong>${fmtTime(s)}</div>`;
}
function openBlockDialog() {
  openDialog({
    kicker: "CALENDAR",
    title: "Add a work block",
    fields: [
      ["title", "Title", "text", "e.g. PT consult"],
      ["date", "Date", "date", todayKey],
      ["start", "Start", "time", "09:00"],
      ["end", "End", "time", "10:00"],
      ["source", "Source", "select", ["Adobe", "Exos", "Personal"]],
    ],
    submit: async (v) => {
      if (!v.title.trim()) throw new Error("Give the block a title");
      if (v.end <= v.start)
        throw new Error("End time must be after start time");
      await getJSON("/api/calendar-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: v.title,
          date: v.date,
          start: v.start,
          end: v.end,
          source: v.source.toLowerCase(),
        }),
      });
      await loadCalendar();
      renderCalendar();
      toast("Calendar block added");
    },
  });
}
function renderScheduler() {
  const scheduler = state.scheduler,
    s = scheduler.settings || DEFAULT_BOOKING_SCHEDULE,
    url = scheduler.publicUrl || PUBLIC_BOOKING_URL;
  $("#bookingUrl").textContent = url;
  $("#bookingUrl").href = url;
  $("#scheduleSlot").value = s.slotMinutes || 30;
  $("#scheduleDuration").value = s.sessionMinutes || 60;
  $("#scheduleNotice").value = String(s.noticeMinutes ?? 120);
  $("#scheduleAhead").value = s.bookAheadDays || 21;
  $("#scheduleLocation").value = s.location || "";
  $("#scheduleNote").value = s.note || "";
  const connected = !!scheduler.workCalendar?.connected;
  $("#workCalendarBanner strong").textContent = connected
    ? "Work Google Calendar connected"
    : "Connect Work Google Calendar";
  $("#workCalendarBanner span").textContent = connected
    ? `${scheduler.workCalendar.email || WORK_EMAIL} · busy times hidden automatically`
    : `Connect ${WORK_EMAIL} to hide busy times and create calendar events.`;
  $("#workCalendarConnect").textContent = connected
    ? "Connected"
    : "Connect work calendar";
  $("#workCalendarConnect").disabled = connected || !scheduler.ownerReady;
  const names = {
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  $("#scheduleHours").innerHTML = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ]
    .map((day) => {
      const h = s.hours?.[day] || DEFAULT_BOOKING_SCHEDULE.hours[day];
      return `<div class="schedule-day ${h.enabled ? "" : "off"}" data-day="${day}"><label class="schedule-toggle"><input type="checkbox" data-hour="enabled" ${h.enabled ? "checked" : ""}><span>${names[day]}</span></label><div class="schedule-range"><input type="time" data-hour="start" value="${attr(h.start)}" ${h.enabled ? "" : "disabled"} aria-label="${names[day]} start"><span>to</span><input type="time" data-hour="end" value="${attr(h.end)}" ${h.enabled ? "" : "disabled"} aria-label="${names[day]} end"></div><em>${h.enabled ? "Available" : "Not available"}</em></div>`;
    })
    .join("");
  const openDays = (scheduler.days || [])
    .filter((day) => day.openCount > 0)
    .slice(0, 4);
  $("#schedulePreview").innerHTML = openDays.length
    ? openDays
        .map(
          (day) =>
            `<div class="preview-day"><div><strong>${esc(day.label)}</strong><small>${day.openCount} opening${day.openCount === 1 ? "" : "s"}</small></div><div class="preview-slots">${day.slots
              .filter((slot) => slot.open)
              .slice(0, 3)
              .map((slot) => `<span>${esc(slot.label)}</span>`)
              .join(
                "",
              )}${day.openCount > 3 ? `<em>+${day.openCount - 3}</em>` : ""}</div></div>`,
        )
        .join("")
    : '<div class="empty-state compact">No public openings in the current window.</div>';
  const bookings = (scheduler.bookings || []).filter(
    (b) =>
      b.status !== "cancelled" && new Date(b.starts_at) >= startOfDay(today),
  );
  $("#bookingList").innerHTML = bookings.length
    ? bookings
        .slice(0, 12)
        .map((b) => {
          const start = new Date(b.starts_at);
          return `<div class="booking-row" data-booking-id="${b.id}"><div><strong>${esc(b.visitor_name)}</strong><span>${esc(b.reason)} · ${start.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><small>${b.calendar_sync_status === "synced" ? "On work calendar" : b.calendar_sync_status === "error" ? "Calendar sync needs attention" : "Waiting for calendar connection"}</small></div><button class="row-delete" data-cancel-booking aria-label="Cancel ${attr(b.visitor_name)} booking">×</button></div>`;
        })
        .join("")
    : '<div class="empty-state compact">No upcoming bookings yet.</div>';
  $("#schedulerPin").classList.toggle("live", connected);
  $("#saveSchedule").disabled = !scheduler.ownerReady;
  $("#schedulerSaved").textContent = scheduler.ownerReady
    ? "Changes update the public booking page."
    : `Sign in as ${WORK_EMAIL} or ${OWNER_EMAIL} to edit availability.`;
}
function scheduleHoursChange(event) {
  const row = event.target.closest(".schedule-day");
  if (!row) return;
  const enabled = row.querySelector('[data-hour="enabled"]').checked;
  row.classList.toggle("off", !enabled);
  row
    .querySelectorAll("input[type=time]")
    .forEach((input) => (input.disabled = !enabled));
  row.querySelector("em").textContent = enabled ? "Available" : "Not available";
}
async function copyBookingLink() {
  const value = PUBLIC_BOOKING_URL;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  toast("Booking link copied — ready to paste in Slack");
}
async function saveSchedule() {
  const settings = {
    ...state.scheduler.settings,
    slotMinutes: Number($("#scheduleSlot").value),
    sessionMinutes: Number($("#scheduleDuration").value),
    noticeMinutes: Number($("#scheduleNotice").value),
    bookAheadDays: Number($("#scheduleAhead").value),
    location: $("#scheduleLocation").value.trim(),
    note: $("#scheduleNote").value.trim(),
    hours: {},
  };
  $$(".schedule-day").forEach((row) => {
    settings.hours[row.dataset.day] = {
      enabled: row.querySelector('[data-hour="enabled"]').checked,
      start: row.querySelector('[data-hour="start"]').value,
      end: row.querySelector('[data-hour="end"]').value,
    };
  });
  const button = $("#saveSchedule");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const data = await getJSON("/api/calendar-manual?resource=schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "schedule", settings }),
    });
    state.scheduler.settings = data.settings;
    await loadScheduler();
    renderScheduler();
    $("#schedulerSaved").textContent = "Saved just now.";
    toast("Public availability updated");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = !state.scheduler.ownerReady;
    button.textContent = "Save availability";
  }
}
async function cancelBooking(event) {
  const button = event.target.closest("[data-cancel-booking]");
  if (!button) return;
  const row = button.closest("[data-booking-id]");
  if (!confirm("Cancel this booking and remove its work calendar event?"))
    return;
  try {
    const result = await getJSON(
      `/api/calendar-manual?resource=booking&id=${encodeURIComponent(row.dataset.bookingId)}`,
      { method: "DELETE" },
    );
    await loadScheduler();
    renderScheduler();
    toast(
      result.calendarRemoved === false
        ? "Booking cancelled, but its work calendar event could not be removed. Delete it in Google Calendar."
        : "Booking cancelled",
    );
  } catch (error) {
    toast(error.message);
  }
}
function renderPrograms() {
  const q = $("#programSearch").value.toLowerCase(),
    clients = state.programs.filter((p) => !p.is_stock),
    stock = state.programs.filter((p) => p.is_stock),
    list = state.programs.filter((p) => {
      const filter =
        state.programFilter === "clients"
          ? !p.is_stock
          : state.programFilter === "stock"
            ? p.is_stock && stockFilterMatch(p)
            : (p.status || "draft") === state.programFilter;
      return (
        filter &&
        `${p.name} ${p.client_name || ""} ${p.goal || ""} ${p.level || ""} ${p.emphasis || ""}`
          .toLowerCase()
          .includes(q)
      );
    });
  $("#programClientCount").textContent = clients.length;
  $("#programTemplateCount").textContent = stock.length;
  $("#programActiveCount").textContent = clients.filter(
    (p) => p.status === "active",
  ).length;
  renderStockFilters(stock);
  $("#programGrid").innerHTML = list.length
    ? list.map(programCardHTML).join("")
    : `<div class="empty-state"><strong>${state.programFilter === "stock" ? "No stock templates yet." : "No programs match this view."}</strong><br>${state.programFilter === "stock" ? "Open a client program and choose “Save as stock template.”" : "Create a program or use a stock template for a client."}</div>`;
  $("#metricPrograms").textContent = activeClientPrograms();
}
// "Active training plans": client programs, not the stock library.
const activeClientPrograms = () =>
  state.programs.filter((p) => !p.is_stock && p.status !== "archived").length;
// Where a stock template came from, for the library's Source filter.
function stockSource(p) {
  if (p.source_program_id) return "My templates";
  if (/^From the EXOS_Adobe training card/.test(p.goal || ""))
    return "Training cards";
  return "TC Nexus library";
}
// Stock filters: days per week, emphasis and source.
function stockFilterMatch(p) {
  const f = state.stockFilters,
    days = Number(p.days_per_week) || 0;
  return (
    (!f.days || (f.days === "5+" ? days >= 5 : days === Number(f.days))) &&
    (!f.emphasis || p.emphasis === f.emphasis) &&
    (!f.source || stockSource(p) === f.source)
  );
}
function renderStockFilters(stock) {
  const box = $("#stockFilters"),
    f = state.stockFilters;
  box.hidden = state.programFilter !== "stock";
  if (box.hidden) return;
  const select = (key, label, options) =>
    `<label>${label}<select data-stock-filter="${key}"><option value="">Any</option>${options
      .map(
        (o) =>
          `<option value="${attr(o)}" ${f[key] === o ? "selected" : ""}>${esc(o)}</option>`,
      )
      .join("")}</select></label>`;
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
  box.innerHTML =
    select("days", "Days / week", ["1", "2", "3", "4", "5+"]) +
    select("emphasis", "Emphasis", uniq(stock.map((p) => p.emphasis))) +
    select("source", "Source", uniq(stock.map(stockSource))) +
    (f.days || f.emphasis || f.source
      ? '<button class="text-btn" data-stock-filter="clear">Clear filters</button>'
      : "");
}
// First few lifts of day 1, so a template can be judged without opening it.
function programPreview(p) {
  const day = normalizeProgramContent(p).days[0];
  if (!day) return "";
  const lifts = (day.blocks || [])
    .flatMap((b) => b.exercises.map((x) => x.name))
    .filter(Boolean);
  return lifts.length
    ? `<p class="program-preview"><b>${esc(day.name || "Day 1")}</b> ${esc(lifts.slice(0, 3).join(" · "))}${lifts.length > 3 ? ` +${lifts.length - 3} more` : ""}</p>`
    : "";
}
function programCardHTML(p) {
  const tags = [p.level, p.sport, p.emphasis].filter(Boolean);
  return `<article class="program-card ${p.is_stock ? "stock" : ""}" data-id="${p.id}"><div class="program-card-top"></div><div class="program-card-body"><span class="status">${p.is_stock ? "STOCK TEMPLATE" : esc((p.status || "draft").toUpperCase())}</span><h3>${esc(p.name)}</h3><p>${esc(p.is_stock ? tags.join(" · ") || "Ready to reuse" : p.client_name || "Not linked to a client")}</p>${p.is_stock ? programPreview(p) : ""}<dl><div><dt>Days</dt><dd>${p.days_per_week || 3}</dd></div><div><dt>Weeks</dt><dd>${p.weeks || 4}</dd></div><div><dt>Updated</dt><dd>${shortDate(p.updated_at || p.created_at)}</dd></div></dl><footer><button class="secondary-btn" data-action="edit">Open</button>${p.is_stock ? '<button class="primary-btn" data-action="use">Use for client</button>' : '<button class="primary-btn" data-action="print">Print</button>'}</footer></div></article>`;
}
function clientChoice(value) {
  if (!value || value === "Not linked")
    return { clientId: null, clientName: "" };
  const [id, ...name] = value.split("|");
  return { clientId: id, clientName: name.join("|") };
}
// `client` preselects the client (from the new-client checklist).
function openProgramDialog(client = null) {
  const options = [
    "Not linked",
    ...state.clients.map((c) => `${c.id}|${c.name}`),
  ];
  openDialog({
    kicker: "TRAINING PROGRAM",
    title: "Start a client program",
    fields: [
      [
        "name",
        "Program name",
        "text",
        "e.g. Jordan · Foundation Block",
        client ? `${client.name} · Program` : undefined,
      ],
      [
        "client",
        "Link to client",
        "select",
        options,
        client ? `${client.id}|${client.name}` : undefined,
      ],
      ["goal", "Program goal", "text", "e.g. Foundational strength"],
      ["days", "Days per week", "number", "3"],
      ["weeks", "Weeks", "number", "4"],
    ],
    submit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error("Give the program a name to continue");
      const linked = clientChoice(v.client),
        payload = {
          name,
          ...linked,
          goal: v.goal,
          daysPerWeek: Number(v.days),
          weeks: Number(v.weeks),
          status: "draft",
        },
        local = {
          ...payload,
          id: `local-${Date.now()}`,
          days_per_week: payload.daysPerWeek,
          weeks: payload.weeks,
          client_id: linked.clientId,
          client_name: linked.clientName,
          content: defaultProgram(payload.daysPerWeek, payload.weeks),
          is_stock: false,
        };
      let saved;
      try {
        saved = await getJSON("/api/programs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await loadPrograms();
      } catch (err) {
        if (
          state.authRequired ||
          /\((400|401|403)\)|required/i.test(err.message)
        )
          throw err; // a rejection, not an outage: let the dialog show it
        saved = local;
        state.programs.unshift(saved);
        writeLocal("taskdash_programs", state.programs);
        toast("Server unreachable — program saved on this device only");
      }
      renderPrograms();
      openProgram(saved.id);
      if (!String(saved.id).startsWith("local-")) toast("Program created");
    },
  });
}
function programAction(e) {
  const card = e.target.closest(".program-card");
  if (!card) return;
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "edit") openProgram(card.dataset.id);
  if (action === "print") {
    openProgram(card.dataset.id);
    markProgramPrinted(card.dataset.id);
    setTimeout(() => window.print(), 100);
  }
  if (action === "use") useStockProgram(card.dataset.id);
}
function openProgram(id, { draft, day = 0 } = {}) {
  // History belongs to one editing session: opening a different program
  // (or reopening after closing) starts fresh; re-renders keep it.
  if (String(id) !== state.activeProgram || $("#programEditor").hidden)
    state.programHistory = { undo: [], redo: [], pending: null };
  state.activeProgram = String(id);
  const saved = state.programs.find(
    (x) => String(x.id) === state.activeProgram,
  );
  if (!saved) return;
  const p = draft ? { ...saved, ...draft } : saved;
  const plan = normalizeProgramContent(p),
    weeks = Number(p.weeks) || 4,
    clientOptions =
      `<option value="">Not linked</option>` +
      state.clients
        .map(
          (c) =>
            `<option value="${attr(c.id)}" ${String(c.id) === String(p.client_id) ? "selected" : ""}>${esc(c.name)}</option>`,
        )
        .join("");
  $("#programEditor").hidden = false;
  $("#programEditor").innerHTML =
    `<div class="program-edit-head"><div><span class="kicker">${p.is_stock ? "STOCK TEMPLATE" : "PROGRAM BUILDER"}</span><h2>${esc(p.name)}</h2><p>${p.is_stock ? "Edit the reusable source or copy it for a client." : "Changes here affect this client copy only."}</p></div><div class="editor-history"><button class="secondary-btn" data-editor="undo" title="Undo (⌘Z)">↶ Undo</button><button class="secondary-btn" data-editor="redo" title="Redo (⇧⌘Z)">↷ Redo</button><button class="icon-btn" data-editor="close">×</button></div></div><div class="program-meta"><label>Program title<input data-meta="name" value="${attr(p.name)}"></label><label>Client<select data-meta="clientId" ${p.is_stock ? "disabled" : ""}>${clientOptions}</select></label><label>Weeks<select data-meta="weeks">${Array.from({ length: 8 }, (_, i) => `<option ${i + 1 === weeks ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label><label>Status<select data-meta="status"><option ${p.status === "draft" ? "selected" : ""}>draft</option><option ${p.status === "active" ? "selected" : ""}>active</option><option ${p.status === "archived" ? "selected" : ""}>archived</option></select></label><label class="wide">Goal / coaching focus<input data-meta="goal" value="${attr(p.goal || "")}" placeholder="What should this block accomplish?"></label></div><div class="day-tabs">${plan.days.map((d, i) => `<button class="${i === 0 ? "active" : ""}" data-day="${i}">${esc(d.name || `Day ${i + 1}`)}</button>`).join("")}<button data-editor="add-day">＋ Day</button></div><div class="program-builder">${plan.days.map((d, i) => dayEditorHTML(d, i, weeks)).join("")}</div><div class="program-print-sheet">${programPrintHTML(p, plan, weeks)}</div><div class="editor-actions"><button class="text-btn danger-text" data-editor="delete">Delete</button>${p.is_stock ? '<button class="secondary-btn" data-editor="use">Use for a client</button>' : '<button class="secondary-btn" data-editor="template">Save as stock template</button>'}${p.client_id ? '<button class="secondary-btn" data-editor="live">▶ Live session</button>' : ""}<button class="secondary-btn" data-editor="print">Print program</button><button class="primary-btn" data-editor="save">Save changes</button></div>`;
  if (day) showProgramDay(Math.min(day, plan.days.length - 1));
  updateProgramHistoryButtons();
  if (!draft)
    $("#programEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}
function showProgramDay(index) {
  const root = $("#programEditor");
  $$(".day-tabs [data-day]", root).forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.day) === index),
  );
  $$("[data-day-panel]", root).forEach(
    (p) => (p.hidden = Number(p.dataset.dayPanel) !== index),
  );
}
function programSnapshot() {
  const root = $("#programEditor"),
    meta = (key) => $(`[data-meta="${key}"]`, root)?.value ?? "",
    content = collectProgram();
  return {
    name: meta("name"),
    client_id: meta("clientId") || null,
    status: meta("status"),
    goal: meta("goal"),
    weeks: content.weeks,
    content,
    day: Math.max(
      0,
      $$(".day-tabs [data-day]", root).findIndex((b) =>
        b.classList.contains("active"),
      ),
    ),
  };
}
const sameSnapshot = (a, b) =>
  JSON.stringify({ ...a, day: 0 }) === JSON.stringify({ ...b, day: 0 });
function recordProgramEdit(snapshot = programSnapshot()) {
  const h = state.programHistory;
  h.undo.push(snapshot);
  if (h.undo.length > 100) h.undo.shift();
  h.redo = [];
  updateProgramHistoryButtons();
}
function stepProgramHistory(direction) {
  const h = state.programHistory,
    from = direction === "redo" ? h.redo : h.undo,
    to = direction === "redo" ? h.undo : h.redo;
  if (!from.length) return;
  to.push(programSnapshot());
  const { day, ...draft } = from.pop();
  h.pending = null;
  openProgram(state.activeProgram, { draft, day });
}
function updateProgramHistoryButtons() {
  const root = $("#programEditor");
  $('[data-editor="undo"]', root).disabled = !state.programHistory.undo.length;
  $('[data-editor="redo"]', root).disabled = !state.programHistory.redo.length;
}
function dayEditorHTML(day, index, weeks) {
  return `<section class="program-day" data-day-panel="${index}" ${index ? "hidden" : ""}><div class="day-edit-title"><input data-day-name value="${attr(day.name || `Day ${index + 1}`)}" aria-label="Day name"><button class="text-btn" data-editor="remove-day">Remove day</button></div><div class="warmup-editor"><div class="builder-label"><span>WARM-UP / PILLAR PREP</span><button data-editor="add-warmup">＋ Line</button></div>${(day.warmup || []).map((w, i) => `<div class="warmup-row"><b>${i + 1}.</b><input data-warm-name value="${attr(w.name || "")}" placeholder="Warm-up movement"><input data-warm-rx value="${attr(w.prescription || "")}" placeholder="2 rounds"><button data-remove-row>×</button></div>`).join("")}</div><div class="blocks-editor">${(day.blocks || []).map((b, i) => blockEditorHTML(b, i, weeks)).join("")}</div><button class="secondary-btn add-block" data-editor="add-block">＋ Add training block</button></section>`;
}
function blockEditorHTML(block, index, weeks) {
  return `<div class="training-block" data-block><div class="builder-label"><span>BLOCK ${esc(block.letter || String.fromCharCode(65 + index))}</span><button data-editor="add-exercise">＋ Exercise</button></div><div class="exercise-head"><span>Slot</span><span>Exercise / coaching note</span><span>Sets</span>${Array.from({ length: weeks }, (_, i) => `<span>W${i + 1}</span>`).join("")}<span></span></div>${(block.exercises || []).map((x, i) => exerciseRowHTML(x, block.letter || String.fromCharCode(65 + index), i, weeks)).join("")}</div>`;
}
function exerciseRowHTML(x, letter, index, weeks) {
  return `<div class="exercise-row"><b>${letter}${index + 1}</b><div><input data-ex-name value="${attr(x.name || "")}" placeholder="Exercise"><input class="exercise-note" data-ex-note value="${attr(x.note || "")}" placeholder="Coaching note (optional)"></div><input data-ex-sets type="number" min="1" max="10" value="${Number(x.sets) || 3}">${Array.from({ length: weeks }, (_, i) => `<input data-ex-rep="${i}" value="${attr((x.reps || [])[i] || "")}" placeholder="Reps">`).join("")}<button data-remove-row>×</button></div>`;
}
function normalizeProgramContent(p) {
  let value = p.content;
  try {
    if (typeof value === "string") value = JSON.parse(value);
  } catch {}
  if (value?.days) return value;
  if (Array.isArray(value))
    return {
      days: value.map((d, i) => ({
        name: d.name || `Day ${i + 1}`,
        warmup: [],
        blocks: [
          {
            letter: "A",
            exercises: [
              {
                name: "Existing workout",
                sets: 1,
                reps: Array(Number(p.weeks) || 4).fill(""),
                note: d.exercises || "",
              },
            ],
          },
        ],
      })),
    };
  return defaultProgram(p.days_per_week || 3, p.weeks || 4);
}
function defaultProgram(days, weeks = 4) {
  const count = Math.max(1, Math.min(Number(weeks) || 4, 8));
  return {
    days: Array.from(
      { length: Math.max(1, Math.min(Number(days) || 3, 7)) },
      (_, i) => ({
        name: `Day ${i + 1}`,
        warmup: [{ name: "Mobility / activation", prescription: "2 rounds" }],
        blocks: [
          {
            letter: "A",
            exercises: [
              {
                name: "Primary movement",
                sets: 4,
                reps: Array(count).fill("6"),
                note: "",
              },
              {
                name: "Paired movement",
                sets: 4,
                reps: Array(count).fill("8"),
                note: "",
              },
            ],
          },
          {
            letter: "B",
            exercises: [
              {
                name: "Secondary movement",
                sets: 3,
                reps: Array(count).fill("10"),
                note: "",
              },
              {
                name: "Core / carry",
                sets: 3,
                reps: Array(count).fill("30 sec"),
                note: "",
              },
            ],
          },
        ],
      }),
    ),
  };
}
function collectProgram() {
  const root = $("#programEditor"),
    weeks = Number($('[data-meta="weeks"]', root).value),
    days = $$("[data-day-panel]", root).map((panel) => ({
      name: $("[data-day-name]", panel).value.trim(),
      warmup: $$(".warmup-row", panel)
        .map((row) => ({
          name: $("[data-warm-name]", row).value.trim(),
          prescription: $("[data-warm-rx]", row).value.trim(),
        }))
        .filter((x) => x.name),
      blocks: $$("[data-block]", panel)
        .map((block, bi) => ({
          letter: String.fromCharCode(65 + bi),
          exercises: $$(".exercise-row", block)
            .map((row) => ({
              name: $("[data-ex-name]", row).value.trim(),
              note: $("[data-ex-note]", row).value.trim(),
              sets: Number($("[data-ex-sets]", row).value) || 3,
              reps: Array.from(
                { length: weeks },
                (_, i) => $(`[data-ex-rep="${i}"]`, row)?.value.trim() || "",
              ),
            }))
            .filter((x) => x.name),
        }))
        .filter((x) => x.exercises.length),
    }));
  return { weeks, days };
}
function programEditorAction(e) {
  const day = e.target.closest("[data-day]");
  if (day) {
    showProgramDay(Number(day.dataset.day));
    return;
  }
  if (e.target.closest("[data-remove-row]")) {
    recordProgramEdit();
    e.target.closest(".warmup-row,.exercise-row").remove();
    return;
  }
  const a = e.target.closest("[data-editor]")?.dataset.editor,
    p = state.programs.find((x) => String(x.id) === state.activeProgram);
  if (!a || !p) return;
  if (a === "undo" || a === "redo") return stepProgramHistory(a);
  if (["add-exercise", "add-warmup", "add-block", "add-day"].includes(a))
    recordProgramEdit();
  if (a === "close") $("#programEditor").hidden = true;
  if (a === "print") {
    refreshPrintSheet();
    markProgramPrinted(p.id);
    setTimeout(() => window.print(), 40);
  }
  if (a === "save") saveProgram();
  if (a === "live") startLiveSession(p.client_id, p.id);
  if (a === "template") saveAsStock(p);
  if (a === "use") useStockProgram(p.id);
  if (a === "delete") deleteProgram(p);
  if (a === "add-exercise") {
    const block = e.target.closest("[data-block]"),
      weeks = Number($('[data-meta="weeks"]', $("#programEditor")).value),
      letter = String.fromCharCode(
        65 +
          $$("[data-block]", e.target.closest("[data-day-panel]")).indexOf(
            block,
          ),
      );
    block.insertAdjacentHTML(
      "beforeend",
      exerciseRowHTML(
        { sets: 3, reps: [] },
        letter,
        $$(".exercise-row", block).length,
        weeks,
      ),
    );
  }
  if (a === "add-warmup")
    e.target
      .closest(".warmup-editor")
      .insertAdjacentHTML(
        "beforeend",
        '<div class="warmup-row"><b>＋</b><input data-warm-name placeholder="Warm-up movement"><input data-warm-rx placeholder="2 rounds"><button data-remove-row>×</button></div>',
      );
  if (a === "add-block") {
    const panel = e.target.closest("[data-day-panel]"),
      weeks = Number($('[data-meta="weeks"]', $("#programEditor")).value),
      index = $$("[data-block]", panel).length;
    $(".blocks-editor", panel).insertAdjacentHTML(
      "beforeend",
      blockEditorHTML(
        {
          letter: String.fromCharCode(65 + index),
          exercises: [{ name: "", sets: 3, reps: [] }],
        },
        index,
        weeks,
      ),
    );
  }
  if (a === "remove-day") {
    const panels = $$("[data-day-panel]", $("#programEditor"));
    if (panels.length < 2) return toast("A program needs at least one day");
    recordProgramEdit();
    const plan = collectProgram(),
      idx = panels.indexOf(e.target.closest("[data-day-panel]"));
    plan.days.splice(idx, 1);
    p.content = plan;
    p.days_per_week = plan.days.length;
    openProgram(p.id);
  }
  if (a === "add-day") {
    const plan = collectProgram();
    plan.days.push(defaultProgram(1, plan.weeks).days[0]);
    p.content = plan;
    p.days_per_week = plan.days.length;
    openProgram(p.id);
  }
}
async function saveProgram() {
  const p = state.programs.find((x) => String(x.id) === state.activeProgram);
  if (!p) return;
  const root = $("#programEditor"),
    titleInput = $('[data-meta="name"]', root);
  if (!titleInput.value.trim()) {
    titleInput.focus();
    toast("A program needs a name before it can be saved");
    return;
  }
  const content = collectProgram(),
    clientId = $('[data-meta="clientId"]', root)?.value || null,
    client = state.clients.find((c) => String(c.id) === String(clientId)),
    body = {
      name: $('[data-meta="name"]', root).value.trim(),
      clientId,
      clientName: client?.name || "",
      weeks: content.weeks,
      daysPerWeek: content.days.length,
      status: $('[data-meta="status"]', root).value,
      goal: $('[data-meta="goal"]', root).value.trim(),
      content,
    };
  Object.assign(p, {
    name: body.name,
    client_id: clientId,
    client_name: body.clientName,
    weeks: body.weeks,
    days_per_week: body.daysPerWeek,
    status: body.status,
    goal: body.goal,
    content,
  });
  try {
    const saved = await getJSON(
      `/api/programs?id=${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    Object.assign(p, saved);
    await loadPrograms();
  } catch (err) {
    writeLocal("taskdash_programs", state.programs);
    renderPrograms();
    openProgram(p.id);
    toast(`Saved on this device only — ${err.message}`);
    return;
  }
  renderPrograms();
  openProgram(p.id);
  toast("Program saved");
}
function saveAsStock(p) {
  openDialog({
    kicker: "STOCK LIBRARY",
    title: "Save a reusable copy",
    fields: [
      [
        "name",
        "Template name",
        "text",
        "Template name",
        p.name.replace(/^.*? — /, ""),
      ],
      [
        "level",
        "Training level",
        "select",
        ["General", "Beginner", "Intermediate", "Advanced"],
      ],
      ["sport", "Sport / audience", "text", "Any sport"],
      [
        "emphasis",
        "Emphasis",
        "select",
        ["Strength", "Hypertrophy", "Power", "Speed", "Movement quality"],
      ],
    ],
    submit: async (v) => {
      await saveProgram();
      const body = {
        action: "save_as_stock",
        sourceId: p.id,
        name: v.name,
        level: v.level,
        sport: v.sport,
        emphasis: v.emphasis,
      };
      let saved;
      try {
        saved = await getJSON("/api/programs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadPrograms();
      } catch {
        saved = {
          ...p,
          ...body,
          id: `local-${Date.now()}`,
          name: v.name,
          is_stock: true,
          client_id: null,
          client_name: null,
          content: structuredClone(p.content),
        };
        state.programs.unshift(saved);
        writeLocal("taskdash_programs", state.programs);
      }
      state.programFilter = "stock";
      $$("#programFilters button").forEach((b) =>
        b.classList.toggle("active", b.dataset.filter === "stock"),
      );
      renderPrograms();
      openProgram(saved.id);
      toast("Stock template created");
    },
  });
}
function useStockProgram(id) {
  const source = state.programs.find((x) => String(x.id) === String(id));
  if (!source) return;
  const options = state.clients.map((c) => `${c.id}|${c.name}`);
  if (!options.length)
    return toast("Add a client first, then assign this template");
  openDialog({
    kicker: "STOCK TEMPLATE",
    title: "Copy for a client",
    fields: [
      ["client", "Client", "select", options],
      ["name", "Program title", "text", "Program title", source.name],
    ],
    submit: async (v) => {
      const linked = clientChoice(v.client),
        body = {
          action: "use_template",
          sourceId: source.id,
          ...linked,
          name: `${linked.clientName} — ${v.name}`,
        };
      let saved;
      try {
        saved = await getJSON("/api/programs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadPrograms();
      } catch {
        saved = {
          ...source,
          id: `local-${Date.now()}`,
          name: body.name,
          is_stock: false,
          status: "draft",
          client_id: linked.clientId,
          client_name: linked.clientName,
          source_program_id: source.id,
          content: structuredClone(source.content),
        };
        state.programs.unshift(saved);
        writeLocal("taskdash_programs", state.programs);
      }
      state.programFilter = "clients";
      $$("#programFilters button").forEach((b) =>
        b.classList.toggle("active", b.dataset.filter === "clients"),
      );
      renderPrograms();
      openProgram(saved.id);
      toast("Client copy created");
    },
  });
}
async function deleteProgram(p) {
  if (!confirm(`Delete “${p.name}”?`)) return;
  state.programs = state.programs.filter((x) => String(x.id) !== String(p.id));
  $("#programEditor").hidden = true;
  try {
    await getJSON(`/api/programs?id=${encodeURIComponent(p.id)}`, {
      method: "DELETE",
    });
  } catch {
    writeLocal("taskdash_programs", state.programs);
  }
  renderPrograms();
  toast("Program deleted");
}
function refreshPrintSheet() {
  const p = state.programs.find((x) => String(x.id) === state.activeProgram),
    content = collectProgram();
  $(".program-print-sheet", $("#programEditor")).innerHTML = programPrintHTML(
    {
      ...p,
      name: $('[data-meta="name"]', $("#programEditor")).value,
      goal: $('[data-meta="goal"]', $("#programEditor")).value,
      client_name:
        state.clients.find(
          (c) =>
            String(c.id) ===
            String($('[data-meta="clientId"]', $("#programEditor"))?.value),
        )?.name || p.client_name,
    },
    content,
    content.weeks,
  );
}
function programPrintHTML(p, plan, weeks) {
  return `<div class="print-program-cover"><span>TASK DASH · TRAINING PROGRAM</span><h1>${esc(p.name)}</h1><p>${esc(p.client_name || "Stock program")} · ${weeks} week${weeks === 1 ? "" : "s"}${p.goal ? ` · ${esc(p.goal)}` : ""}</p></div>${plan.days.map((day, di) => `<article class="print-program-day"><header><h2>${esc(day.name || `Day ${di + 1}`)}</h2><span>${esc(p.client_name || "Stock program")}</span></header>${day.warmup?.length ? `<section><h3>Warm-up / Pillar Prep</h3><ol>${day.warmup.map((w) => `<li><strong>${esc(w.name)}</strong> ${esc(w.prescription || "")}</li>`).join("")}</ol></section>` : ""}<table><thead><tr><th>Lift</th><th>Exercise</th><th>Sets</th>${Array.from({ length: weeks }, (_, i) => `<th>Week ${i + 1}<small>Rep / Weight</small></th>`).join("")}</tr></thead><tbody>${(day.blocks || []).flatMap((b) => b.exercises.map((x, i) => `<tr><td><b>${esc(b.letter)}${i + 1}</b></td><td><strong>${esc(x.name)}</strong>${x.note ? `<small>${esc(x.note)}</small>` : ""}</td><td>${x.sets}</td>${Array.from({ length: weeks }, (_, wi) => `<td><span>${esc(x.reps?.[wi] || "")}</span><i></i></td>`).join("")}</tr>`)).join("")}</tbody></table><footer>${esc(state.settings.coach || "William Farparan")} · ${esc(state.settings.footer || "Move well. Train with intent.")}</footer></article>`).join("")}`;
}
function renderClients() {
  const q = $("#clientSearch").value.toLowerCase(),
    type = $("#clientTypeFilter").value,
    list = state.clients.filter(
      (c) =>
        (type === "all" || c.service_type === type) &&
        `${c.name} ${c.email || ""}`.toLowerCase().includes(q),
    );
  $("#clientRows").innerHTML = list.length
    ? list
        .map((c) => {
          const sessions = state.sessions.filter(
            (s) => String(s.client_id) === String(c.id),
          );
          const last = [...sessions].sort((a, b) =>
            String(b.session_date).localeCompare(String(a.session_date)),
          )[0];
          return `<tr data-id="${c.id}"><td><button class="client-name client-link" data-action="profile" aria-label="Open ${attr(c.name)}"><span class="mini-avatar">${initials(c.name)}</span><div><strong>${esc(c.name)}</strong><small style="display:block;color:#999">${esc(c.email || "No email")}</small>${onboardingChipHTML(c)}</div></button></td><td><span class="service-pill">${esc(c.service_type || "PT consult")}</span></td><td>${last ? shortDate(last.session_date) : "—"}</td><td><strong>${sessions.length}</strong></td><td>${c.next_follow_up ? shortDate(c.next_follow_up) : "—"}</td><td><div class="row-actions"><button class="session-btn" data-action="session">＋ Session</button><button class="text-btn" data-action="edit" aria-label="Edit ${attr(c.name)}">Edit</button><button class="text-btn danger-text" data-action="delete" aria-label="Delete ${attr(c.name)}">Delete</button></div></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6"><div class="empty-state compact">No clients match this view.</div></td></tr>';
  const month = todayKey.slice(0, 7);
  $("#clientTotal").textContent = state.clients.length;
  $("#clientPt").textContent = state.clients.filter(
    (c) => c.service_type === "Personal training",
  ).length;
  $("#clientSessions").textContent = state.sessions.filter((s) =>
    String(s.session_date).startsWith(month),
  ).length;
  $("#clientFollowups").textContent = state.clients.filter(
    (c) =>
      c.next_follow_up && String(c.next_follow_up).slice(0, 10) <= todayKey,
  ).length;
  $("#metricClients").textContent = state.clients.length;
  if (state.activeClient) renderClientProfile();
}
function openClientDialog() {
  openDialog({
    kicker: "CLIENT ROSTER",
    title: "Add a client",
    fields: [
      ["name", "Full name", "text", "Client name"],
      ["email", "Email", "email", "name@example.com"],
      ["phone", "Phone", "tel", "Optional"],
      [
        "serviceType",
        "Primary service",
        "select",
        ["PT consult", "InBody scan", "Personal training"],
      ],
      ["firstSession", "First session", "date", ""],
      ["nextFollowUp", "Next follow-up", "date", ""],
    ],
    submit: async (v) => {
      const body = {
        name: v.name,
        email: v.email,
        phone: v.phone,
        serviceType: v.serviceType,
        firstSession: v.firstSession || null,
        nextFollowUp: v.nextFollowUp || null,
      };
      try {
        await getJSON("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadClients();
      } catch {
        state.clients.push({
          ...body,
          id: `local-${Date.now()}`,
          service_type: v.serviceType,
          next_follow_up: v.nextFollowUp,
          first_session: v.firstSession || null,
          onboarding: v.serviceType === "Personal training" ? {} : null,
        });
        writeLocal("taskdash_clients", state.clients);
      }
      renderClients();
      renderDashboard();
      toast(
        v.serviceType === "Personal training"
          ? "Client added · new-client checklist started"
          : "Client added",
      );
    },
  });
}
function clientAction(e) {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const id = b.closest("tr").dataset.id,
    c = state.clients.find((x) => String(x.id) === id);
  if (!c) return;
  if (b.dataset.action === "profile") return openClientProfile(c.id);
  if (b.dataset.action === "edit") return openClientEditDialog(c);
  if (b.dataset.action === "delete") return deleteClient(c);
  if (b.dataset.action !== "session") return;
  openDialog({
    kicker: "SESSION LOG",
    title: `Log ${c.name}`,
    fields: [
      [
        "type",
        "Session type",
        "select",
        ["Personal training", "PT consult", "InBody scan"],
      ],
      ["date", "Date", "date", todayKey],
      ["duration", "Minutes", "number", "60"],
      [
        "notes",
        "Notes",
        "textarea",
        "Key outcomes, measurements, or follow-up",
      ],
      ["next", "Next session", "date", ""],
    ],
    submit: async (v) => {
      const body = {
        clientId: id,
        sessionType: v.type,
        date: v.date,
        durationMinutes: Number(v.duration),
        notes: v.notes,
        nextSession: v.next || null,
      };
      try {
        await getJSON("/api/clients?resource=sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadClients();
      } catch {
        state.sessions.push({
          ...body,
          id: `local-${Date.now()}`,
          client_id: id,
          session_date: v.date,
          session_type: v.type,
        });
        writeLocal("taskdash_sessions", state.sessions);
      }
      renderClients();
      renderDashboard();
      toast("Session logged");
    },
  });
}
// ---- Docs from the manager ----
async function loadDocs() {
  try {
    const d = await getJSON("/api/docs");
    state.docs = d.docs || [];
    state.docCategories = d.categories || [];
  } catch {
    state.docs = readLocal("taskdash_docs", []);
  }
}
function docKindLabel(d) {
  if (d.kind === "link") {
    if (/docs\.google\.com\/document/.test(d.url)) return "DOC";
    if (/docs\.google\.com\/spreadsheets/.test(d.url)) return "SHEET";
    if (/docs\.google\.com\/presentation/.test(d.url)) return "SLIDES";
    if (/drive\.google\.com/.test(d.url)) return "DRIVE";
    return "LINK";
  }
  const ext = String(d.file_name || "")
    .split(".")
    .pop()
    .toUpperCase();
  return ext && ext.length <= 5 ? ext : "FILE";
}
function renderDocs() {
  const list = $("#docList");
  if (!list) return;
  const inbox = state.docs.filter((d) => d.status === "inbox"),
    q = ($("#docSearch")?.value || "").trim().toLowerCase(),
    f = state.docFilter,
    counts = {};
  for (const d of state.docs)
    if (d.category) counts[d.category] = (counts[d.category] || 0) + 1;
  $("#docsBadge").hidden = !inbox.length;
  $("#docsBadge").textContent = inbox.length;
  const chip = (key, label, n) =>
    `<button class="${f === key ? "active" : ""}" data-doc-filter="${attr(key)}">${esc(label)}${n != null ? ` <b>${n}</b>` : ""}</button>`;
  $("#docFilters").innerHTML = [
    chip("all", "All", state.docs.length),
    chip("inbox", "Needs filing", inbox.length),
    chip("pinned", "Pinned", state.docs.filter((d) => d.pinned).length),
    chip(
      "actions",
      "Has action items",
      state.docs.filter((d) => (d.action_items || []).length).length,
    ),
    ...Object.keys(counts)
      .sort()
      .map((c) => chip(`cat:${c}`, c, counts[c])),
  ].join("");
  const shown = state.docs.filter(
    (d) =>
      (f === "all" ||
        (f === "inbox" && d.status === "inbox") ||
        (f === "pinned" && d.pinned) ||
        (f === "actions" && (d.action_items || []).length) ||
        f === `cat:${d.category}`) &&
      (!q ||
        [
          d.title,
          d.summary,
          d.category,
          d.from_person,
          d.file_name,
          ...(d.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  list.innerHTML = shown.length
    ? shown.map(docCardHTML).join("")
    : `<div class="empty-state">${state.docs.length ? "No docs match this view." : "<strong>No docs yet.</strong><br>Add a file or a Google Doc link from your manager and Claude will suggest where it goes."}</div>`;
}
function docCardHTML(d) {
  const actions = d.action_items || [];
  return `<article class="doc-card ${d.status === "inbox" ? "inbox" : ""}" data-doc="${attr(d.id)}"><span class="doc-kind">${esc(docKindLabel(d))}</span><div class="doc-main"><div class="doc-title-row"><button class="doc-title" data-doc-action="open">${esc(d.title)}</button>${d.pinned ? '<span class="doc-pin">PINNED</span>' : ""}</div><div class="doc-meta">${d.status === "inbox" ? '<span class="doc-needs">Needs filing</span>' : d.category ? `<span class="service-pill">${esc(d.category)}</span>` : ""}<span>${esc(d.from_person || "Manager")} · ${shortDate(d.received_on || d.created_at)}</span>${(d.tags || []).map((t) => `<span class="doc-tag">#${esc(t)}</span>`).join("")}</div>${d.summary ? `<p>${esc(d.summary)}</p>` : ""}${
    actions.length
      ? `<ul class="doc-actions-list">${actions
          .map(
            (a, i) =>
              `<li><span>${esc(a.text)}${a.due ? ` <em>· due ${shortDate(a.due)}</em>` : ""}</span><button class="step-link" data-doc-action="task" data-item="${i}">＋ Task</button></li>`,
          )
          .join("")}</ul>`
      : ""
  }</div><div class="doc-buttons"><button class="step-link" data-doc-action="open">Open</button><button class="step-link" data-doc-action="review">${d.status === "inbox" ? "File it" : "Edit"}</button><button class="step-link" data-doc-action="organize" title="Ask Claude to suggest the filing again">✦ Re-sort</button><button class="step-link" data-doc-action="pin">${d.pinned ? "Unpin" : "Pin"}</button><button class="text-btn danger-text" data-doc-action="delete">Delete</button></div></article>`;
}
async function docAction(e) {
  const b = e.target.closest("[data-doc-action]");
  if (!b) return;
  const d = state.docs.find(
    (x) => String(x.id) === b.closest("[data-doc]").dataset.doc,
  );
  if (!d) return;
  const a = b.dataset.docAction,
    patch = (body) =>
      getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  if (a === "open")
    window.open(
      d.kind === "file"
        ? `/api/docs?file=${encodeURIComponent(d.id)}`
        : workAccountUrl(d.url),
      "_blank",
      "noopener",
    );
  if (a === "review") openDocReview(d, null);
  if (a === "organize") {
    b.disabled = true;
    b.textContent = "Reading…";
    try {
      const r = await getJSON(
        `/api/docs?action=organize&id=${encodeURIComponent(d.id)}&dayKey=${todayKey}`,
        { method: "POST" },
      );
      openDocReview(d, r.suggestion);
    } catch (err) {
      toast(err.message || "Claude couldn't sort this doc");
    }
    b.disabled = false;
    b.textContent = "✦ Re-sort";
  }
  if (a === "pin") {
    Object.assign(
      d,
      await patch({ pinned: !d.pinned }).catch(() => ({ pinned: !d.pinned })),
    );
    renderDocs();
    renderLinks();
  }
  if (a === "delete") {
    if (
      !confirm(
        `Delete “${d.title}”?${d.kind === "file" ? " The stored file is deleted too." : ""}`,
      )
    )
      return;
    try {
      await getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "DELETE",
      });
    } catch {}
    state.docs = state.docs.filter((x) => x !== d);
    renderDocs();
    toast("Doc deleted");
  }
  if (a === "task") {
    const item = (d.action_items || [])[Number(b.dataset.item)];
    if (!item) return;
    const day = item.due || todayKey;
    try {
      await getJSON("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "daily_task",
          dayKey: day,
          name: `${item.text} — ${d.title}`.slice(0, 200),
        }),
      });
      if (day === todayKey) await loadTasks();
      renderDashboard();
      toast(
        day === todayKey
          ? "Added to today's tasks"
          : `Added to your tasks for ${shortDate(day)}`,
      );
    } catch (err) {
      toast(err.message || "Could not add the task");
    }
  }
}
function openAddDocDialog() {
  const lastFrom = readLocal("taskdash_doc_from", "");
  openDialog({
    kicker: "DOCS",
    title: "Add a doc",
    fields: [
      [
        "file",
        "Upload a file (PDF, Word, Excel, PowerPoint — up to 4 MB)",
        "file",
        "",
      ],
      [
        "url",
        "…or paste a Google Doc / Drive link",
        "url",
        "https://docs.google.com/…",
      ],
      ["title", "Title (optional)", "text", "Claude will suggest one"],
      ["from", "From", "text", "Who sent it?", lastFrom],
      [
        "note",
        "Note (optional)",
        "textarea",
        "What did your manager say about it?",
      ],
    ],
    submit: async (v) => {
      const file = $("#dialogForm").elements.file.files[0],
        url = v.url.trim();
      if (!file && !url) throw new Error("Choose a file or paste a link");
      if (file && file.size > 4 * 1024 * 1024)
        throw new Error(
          "That file is over 4 MB. Save it to Google Drive and paste the link instead.",
        );
      writeLocal("taskdash_doc_from", v.from.trim());
      const meta = {
        title: v.title.trim(),
        from: v.from.trim(),
        note: v.note.trim(),
      };
      $("#dialogSubmit").textContent = "Reading the doc…";
      const r = file
        ? await getJSON(`/api/docs?dayKey=${todayKey}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Doc-Meta": encodeURIComponent(
                JSON.stringify({ ...meta, name: file.name, type: file.type }),
              ),
            },
            body: file,
          })
        : await getJSON("/api/docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...meta, url, dayKey: todayKey }),
          });
      state.docs.unshift(r.doc);
      renderDocs();
      setTimeout(() => openDocReview(r.doc, r.suggestion), 60);
    },
  });
  $("#dialogSubmit").textContent = "Add doc";
}
// Review (or edit) how a doc is filed. `suggestion` is Claude's, if any.
function openDocReview(d, suggestion) {
  if (suggestion?.error) toast(`Claude couldn't sort it: ${suggestion.error}`);
  const s = suggestion && !suggestion.error ? suggestion : {},
    cats = state.docCategories.length ? state.docCategories : ["Other"],
    items = s.action_items || d.action_items || [];
  openDialog({
    kicker:
      suggestion && !suggestion.error
        ? "CLAUDE'S SUGGESTION · REVIEW"
        : "FILE THIS DOC",
    title: "Where does this go?",
    fields: [
      ["title", "Title", "text", "", s.title || d.title],
      [
        "category",
        "Category",
        "select",
        cats,
        s.category || d.category || cats.at(-1),
      ],
      [
        "summary",
        "Summary",
        "textarea",
        "What it is and why it matters",
        s.summary || d.summary || "",
      ],
      [
        "tags",
        "Tags (comma separated)",
        "text",
        "events, michelle, q4",
        (s.tags || d.tags || []).join(", "),
      ],
      ["from", "From", "text", "Who sent it?", d.from_person || ""],
      [
        "actions",
        "Action items (one per line; add | YYYY-MM-DD for a due date)",
        "textarea",
        "Send RSVP list to Michelle | 2026-10-15",
        items.map((a) => (a.due ? `${a.text} | ${a.due}` : a.text)).join("\n"),
      ],
      [
        "pinned",
        "Pin to the top of Docs and the Resource hub",
        "checkbox",
        !!d.pinned,
      ],
    ],
    submit: async (v) => {
      const body = {
        title: v.title.trim(),
        category: v.category,
        summary: v.summary.trim(),
        tags: v.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        from: v.from.trim(),
        actionItems: v.actions
          .split("\n")
          .map((line) => {
            const [text, due] = line.split("|").map((x) => x.trim());
            return {
              text,
              due: /^\d{4}-\d{2}-\d{2}$/.test(due || "") ? due : "",
            };
          })
          .filter((a) => a.text),
        pinned: v.pinned,
        status: "filed",
      };
      const saved = await getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      Object.assign(d, saved);
      renderDocs();
      renderLinks();
      toast("Doc filed");
    },
  });
  $("#dialogSubmit").textContent = "File it";
}
// ---- New-client checklist, client profile and meal plans ----
const PAYPAL_INVOICE_URL = "https://www.paypal.com/invoice/create",
  PT_LOGGER_URL =
    "https://docs.google.com/spreadsheets/d/1ndaoRKjFlKdJ4QO3CXoCbaJ0XCgncOQJGEVfWOcT4Xg/edit?gid=37481941#gid=37481941",
  ONBOARDING_STEPS = [
    { key: "invoice", title: "Send the invoice via PayPal" },
    { key: "schedule", title: "Send the scheduling link" },
    { key: "program", title: "Create the program and print it" },
    { key: "mealPlan", title: "Create the meal plan" },
    { key: "ptLogger", title: "Add to the Unredeemed PT Session Logger" },
  ];
const clientPrograms = (c) =>
  state.programs.filter(
    (p) => !p.is_stock && String(p.client_id) === String(c.id),
  );
const clientPlanCount = (c) =>
  state.mealPlanIndex.filter((m) => String(m.client_id) === String(c.id))
    .length;
// Checklist progress, or null when the client isn't tracked. The program and
// meal plan steps also complete themselves (printed program / saved plan).
function onboardingStatus(c) {
  const ob = c.onboarding;
  if (!ob || typeof ob !== "object") return null;
  const steps = ONBOARDING_STEPS.map((step) => {
    let when = ob[step.key] || null;
    if (step.key === "program" && !when && clientPrograms(c).length)
      when = ob.programPrinted || null;
    if (step.key === "mealPlan" && !when && clientPlanCount(c)) when = "done";
    return { ...step, done: !!when, when: /^\d{4}/.test(when) ? when : null };
  });
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, next: steps.find((x) => !x.done) };
}
function onboardingChipHTML(c) {
  const st = onboardingStatus(c);
  if (!st) return "";
  return `<span class="onboard-chip ${st.done === st.total ? "complete" : ""}">${st.done === st.total ? "✓ Set up" : `Setup ${st.done}/${st.total}`}</span>`;
}
// First-session countdown label for a tracked client.
function firstSessionLabel(c) {
  if (!c.first_session) return "No first session set";
  const days = Math.round(
    (new Date(String(c.first_session).slice(0, 10) + "T12:00:00") -
      new Date(todayKey + "T12:00:00")) /
      864e5,
  );
  const when = shortDate(c.first_session);
  if (days < 0) return `First session was ${when}`;
  if (days === 0) return "First session today";
  if (days === 1) return "First session tomorrow";
  return `First session ${when} · in ${days} days`;
}
async function setOnboardingStep(c, step, done) {
  const body = { step, done, dayKey: todayKey };
  if (!c.onboarding) c.onboarding = {};
  if (done) c.onboarding[step] = todayKey;
  else delete c.onboarding[step];
  try {
    const saved = await getJSON(
      `/api/clients?resource=onboarding&id=${encodeURIComponent(c.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    Object.assign(c, saved);
  } catch {
    writeLocal("taskdash_clients", state.clients);
  }
  renderClients();
  renderClientProfile();
  renderDashboard();
}
async function setOnboardingTracking(c, track) {
  c.onboarding = track ? c.onboarding || {} : null;
  try {
    const saved = await getJSON(
      `/api/clients?resource=onboarding&id=${encodeURIComponent(c.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track }),
      },
    );
    Object.assign(c, saved);
  } catch {
    writeLocal("taskdash_clients", state.clients);
  }
  renderClients();
  renderClientProfile();
  renderDashboard();
}
// Printing a client's program ticks that half of the program step.
function markProgramPrinted(programId) {
  const p = state.programs.find((x) => String(x.id) === String(programId)),
    c = p && state.clients.find((x) => String(x.id) === String(p.client_id));
  if (c?.onboarding && !c.onboarding.programPrinted)
    setOnboardingStep(c, "programPrinted", true);
}
async function openClientProfile(id) {
  state.activeClient = String(id);
  state.clientMealPlans = [];
  state.clientWorkouts = [];
  state.activeMealPlan = null;
  go("clients");
  renderClientProfile();
  $("#clientProfile").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    state.clientMealPlans =
      (await getJSON(`/api/meal-plans?clientId=${encodeURIComponent(id)}`))
        .mealPlans || [];
  } catch {
    state.clientMealPlans = [];
  }
  try {
    state.clientWorkouts =
      (await getJSON(`/api/workouts?clientId=${encodeURIComponent(id)}`))
        .workouts || [];
  } catch {
    state.clientWorkouts = readLocal(`taskdash_workouts_${id}`, []);
  }
  state.activeMealPlan = state.clientMealPlans[0]?.id ?? null;
  renderClientProfile();
}
function renderClientProfile() {
  const box = $("#clientProfile"),
    c = state.clients.find((x) => String(x.id) === state.activeClient);
  if (!box) return;
  if (!c) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const st = onboardingStatus(c);
  box.innerHTML = `<div class="profile-head"><div class="client-name"><span class="mini-avatar">${initials(c.name)}</span><div><span class="kicker">CLIENT PROFILE</span><h2>${esc(c.name)}</h2><p>${esc(c.service_type || "PT consult")} · ${esc(c.email || "No email")}${c.phone ? ` · ${esc(c.phone)}` : ""}</p></div></div><div class="profile-head-actions"><button class="secondary-btn" data-profile="edit">Edit client</button><button class="icon-btn" data-profile="close" aria-label="Close profile">×</button></div></div>${
    st
      ? `<section class="onboarding"><div class="builder-label"><span>NEW-CLIENT CHECKLIST · ${st.done} OF ${st.total} DONE</span><span class="first-session ${c.first_session && String(c.first_session).slice(0, 10) <= todayKey && st.done < st.total ? "late" : ""}">${esc(firstSessionLabel(c))}</span></div><div class="onboarding-bar"><i style="width:${(st.done / st.total) * 100}%"></i></div>${st.steps.map((step, i) => onboardingStepHTML(c, step, i)).join("")}<button class="text-btn" data-profile="untrack">Stop tracking this checklist</button></section>`
      : `<section class="onboarding empty"><p>The new-client checklist isn't on for this client.</p><button class="secondary-btn" data-profile="track">Start new-client checklist</button></section>`
  }${trainingSectionHTML(c)}<section class="meal-plans"><div class="builder-label"><span>MEAL PLAN</span><button class="step-link" data-profile="intake">${state.clientMealPlans.length ? "＋ New meal plan" : "Fill in questionnaire + generate"}</button></div>${mealPlanSectionHTML(c)}</section>`;
}
function onboardingStepHTML(c, step, i) {
  const programs = clientPrograms(c);
  let actions = "",
    detail = step.when ? `Done ${shortDate(step.when)}` : "";
  if (step.key === "invoice")
    actions = `<a class="step-link" href="${PAYPAL_INVOICE_URL}" target="_blank" rel="noopener noreferrer">Open PayPal invoicing ↗</a>`;
  if (step.key === "schedule")
    actions = `<button class="step-link" data-profile="copy-booking">Copy link</button>${c.email ? `<button class="step-link" data-profile="email-booking">Email it to ${esc(c.email)}</button>` : ""}`;
  if (step.key === "program") {
    actions = programs.length
      ? `<button class="step-link" data-profile="open-program" data-program="${attr(programs[0].id)}">Open “${esc(programs[0].name)}”</button><button class="step-link" data-profile="print-program" data-program="${attr(programs[0].id)}">Print</button>`
      : `<button class="step-link" data-profile="new-program">Create program</button>`;
    if (!step.done) detail = programs.length ? "Created · not printed yet" : "";
  }
  if (step.key === "mealPlan")
    actions = `<button class="step-link" data-profile="intake">${clientPlanCount(c) ? "New plan" : "Questionnaire + generate"}</button>`;
  if (step.key === "ptLogger")
    actions = `<a class="step-link" href="${attr(workAccountUrl(PT_LOGGER_URL))}" target="_blank" rel="noopener noreferrer">Open the logger ↗</a>`;
  return `<div class="onboarding-step ${step.done ? "done" : ""}"><input type="checkbox" data-step="${step.key}" aria-label="${attr(step.title)}" ${step.done ? "checked" : ""}><div><strong>${i + 1}. ${esc(step.title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</div><div class="step-actions">${actions}</div></div>`;
}
function mealPlanSectionHTML(c) {
  const plans = state.clientMealPlans;
  if (!plans.length)
    return `<div class="empty-state compact">No meal plan yet. ${c.nutrition_intake ? "Questionnaire answers are saved; generate when ready." : "Fill in the nutrition questionnaire with the client to generate one."}</div>`;
  const row =
      plans.find((m) => String(m.id) === String(state.activeMealPlan)) ||
      plans[0],
    plan = row.plan || {},
    n = (v) => Math.round(Number(v) || 0);
  return `${plans.length > 1 ? `<div class="plan-history">${plans.map((m) => `<button class="${String(m.id) === String(row.id) ? "active" : ""}" data-profile="show-plan" data-plan="${attr(m.id)}">${shortDate(m.created_at)}</button>`).join("")}</div>` : ""}<div class="plan-totals"><div><strong>${n(plan.daily_calories)}</strong><span>calories</span></div><div><strong>${n(plan.protein_grams_total)}g</strong><span>protein</span></div><div><strong>${n(plan.carbs_grams_total)}g</strong><span>carbs</span></div><div><strong>${n(plan.fat_grams_total)}g</strong><span>fat</span></div></div><div class="plan-meals">${(plan.meals || []).map((m) => `<article class="plan-meal"><header><span>${esc(String(m.meal_type || "").toUpperCase())}</span><strong>${esc(m.meal_name)}</strong></header><p>${esc(m.foods)}</p><footer>${n(m.calories)} cal · P ${n(m.protein_grams)}g · C ${n(m.carbs_grams)}g · F ${n(m.fat_grams)}g</footer>${m.notes ? `<small>${esc(m.notes)}</small>` : ""}</article>`).join("")}</div>${plan.coach_notes ? `<details class="plan-notes"><summary>Coach notes</summary><p>${esc(plan.coach_notes)}</p></details>` : ""}<div class="plan-actions"><button class="text-btn danger-text" data-profile="delete-plan" data-plan="${attr(row.id)}">Delete</button><button class="secondary-btn" data-profile="print-plan" data-plan="${attr(row.id)}">Print meal plan</button></div>`;
}
async function clientProfileAction(e) {
  const c = state.clients.find((x) => String(x.id) === state.activeClient);
  if (!c) return;
  const step = e.target.closest("[data-step]");
  if (step && e.type === "change")
    return setOnboardingStep(c, step.dataset.step, step.checked);
  const b = e.target.closest("[data-profile]");
  if (!b || e.type !== "click") return;
  const a = b.dataset.profile;
  if (a === "close") {
    state.activeClient = null;
    renderClientProfile();
  }
  if (a === "edit") openClientEditDialog(c);
  if (a === "track") setOnboardingTracking(c, true);
  if (a === "untrack" && confirm(`Stop tracking the checklist for ${c.name}?`))
    setOnboardingTracking(c, false);
  if (a === "copy-booking") {
    try {
      await navigator.clipboard.writeText(PUBLIC_BOOKING_URL);
      toast("Scheduling link copied");
    } catch {
      prompt("Copy the scheduling link", PUBLIC_BOOKING_URL);
    }
  }
  if (a === "email-booking") {
    const first = String(c.name).split(/\s+/)[0],
      subject = "Book your first session",
      body = `Hi ${first},\n\nHere's my scheduling link. Pick any open time that works for your first session:\n${PUBLIC_BOOKING_URL}\n\nLooking forward to it!\n${state.settings.coach || "William Farparan"}`;
    window.location.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (!onboardingStatus(c)?.steps.find((x) => x.key === "schedule").done) {
      setOnboardingStep(c, "schedule", true);
      toast("Marked as sent. Untick it if you didn't send the email.");
    }
  }
  if (a === "new-program") openProgramDialog(c);
  if (a === "open-program") {
    go("programs");
    openProgram(b.dataset.program);
  }
  if (a === "print-program") {
    go("programs");
    openProgram(b.dataset.program);
    refreshPrintSheet();
    markProgramPrinted(b.dataset.program);
    setTimeout(() => window.print(), 100);
  }
  if (a === "intake") openMealIntakeDialog(c);
  if (a === "live") startLiveSession(c.id, b.dataset.program);
  if (a === "resume-live") resumeLiveSession(c.id, b.dataset.workout);
  if (a === "show-plan") {
    state.activeMealPlan = b.dataset.plan;
    renderClientProfile();
  }
  if (a === "print-plan") printMealPlan(c, b.dataset.plan);
  if (a === "delete-plan") deleteMealPlan(b.dataset.plan);
}
// ---- Live training session: log every set while coaching ----
function trainingSectionHTML(c) {
  const programs = clientPrograms(c),
    logs = state.clientWorkouts,
    open = logs.find((w) => w.status !== "finished");
  const start = programs.length
    ? programs
        .map(
          (p) =>
            `<button class="primary-btn" data-profile="live" data-program="${attr(p.id)}">▶ Start session${programs.length > 1 ? ` · ${esc(p.name)}` : ""}</button>`,
        )
        .join("")
    : '<span class="muted-note">Create a program for this client to run live sessions.</span>';
  return `<section class="training-log"><div class="builder-label"><span>TRAINING SESSIONS</span></div><div class="training-start">${open ? `<button class="secondary-btn" data-profile="resume-live" data-workout="${attr(open.id)}">Resume ${esc(open.day_name || `Day ${open.day_index + 1}`)} · Week ${open.week_index + 1}</button>` : ""}${start}</div>${
    logs.length
      ? `<div class="log-history">${logs
          .slice(0, 8)
          .map(
            (w) =>
              `<button class="log-row" data-profile="resume-live" data-workout="${attr(w.id)}"><strong>${shortDate(w.started_at)}</strong><span>${esc(w.program_name || "Program")} · ${esc(w.day_name || `Day ${w.day_index + 1}`)} · Week ${w.week_index + 1}</span><em>${w.status === "finished" ? `${workoutSetCount(w)} sets` : "In progress"}</em></button>`,
          )
          .join("")}</div>`
      : ""
  }</section>`;
}
const workoutSetCount = (w) =>
  (w.entries || []).reduce(
    (n, e) =>
      n + (e.sets || []).filter((x) => x.done || x.weight || x.reps).length,
    0,
  );
// Sets and reps for one exercise in one week. A week cell like "4 × 6"
// (the set count changed that week) overrides the exercise's sets.
function weekTarget(x, week) {
  const cell = String(x.reps?.[week] || "").trim(),
    m = /^(\d+)\s*[×x]\s*(.+)$/.exec(cell);
  return m
    ? { sets: Number(m[1]), reps: m[2].trim() }
    : { sets: Number(x.sets) || 3, reps: cell };
}
function liveEntries(program, dayIndex, week) {
  const day = normalizeProgramContent(program).days[dayIndex] || { blocks: [] };
  return (day.blocks || []).flatMap((b) =>
    b.exercises.map((x, i) => {
      const t = weekTarget(x, week);
      return {
        key: `${b.letter}${i + 1}`,
        name: x.name,
        target: t.reps ? `${t.sets} × ${t.reps}` : `${t.sets} sets`,
        note: "",
        coachNote: x.note || "",
        sets: Array.from({ length: Math.max(1, Math.min(t.sets, 12)) }, () => ({
          weight: "",
          reps: "",
          done: false,
        })),
      };
    }),
  );
}
// Next day/week after the client's last finished session on this program.
function nextLiveDay(program, logs) {
  const days = normalizeProgramContent(program).days.length || 1,
    weeks = Number(program.weeks) || 4,
    last = logs.find(
      (w) =>
        w.status === "finished" && String(w.program_id) === String(program.id),
    );
  if (!last) return { day: 0, week: 0 };
  const day = (last.day_index + 1) % days,
    week =
      day === 0 ? Math.min(last.week_index + 1, weeks - 1) : last.week_index;
  return { day, week };
}
async function startLiveSession(clientId, programId) {
  const c = state.clients.find((x) => String(x.id) === String(clientId)),
    p = state.programs.find((x) => String(x.id) === String(programId));
  if (!c || !p) return toast("Open a client program to start a session");
  if (
    String(state.activeClient) !== String(c.id) ||
    !state.clientWorkouts.length
  )
    try {
      state.clientWorkouts =
        (await getJSON(`/api/workouts?clientId=${encodeURIComponent(c.id)}`))
          .workouts || [];
    } catch {}
  const open = state.clientWorkouts.find(
    (w) => w.status !== "finished" && String(w.program_id) === String(p.id),
  );
  if (open) return resumeLiveSession(c.id, open.id);
  const { day, week } = nextLiveDay(p, state.clientWorkouts);
  state.live = {
    client: c,
    program: p,
    log: null,
    dayIndex: day,
    weekIndex: week,
    entries: liveEntries(p, day, week),
    notes: "",
    startedAt: Date.now(),
  };
  showLiveSession();
}
function resumeLiveSession(clientId, workoutId) {
  const c = state.clients.find((x) => String(x.id) === String(clientId)),
    w = state.clientWorkouts.find((x) => String(x.id) === String(workoutId));
  if (!c || !w) return;
  const p = state.programs.find(
    (x) => String(x.id) === String(w.program_id),
  ) || {
    id: w.program_id,
    name: w.program_name,
    content: { days: [] },
    weeks: w.week_index + 1,
  };
  state.live = {
    client: c,
    program: p,
    log: w,
    dayIndex: w.day_index,
    weekIndex: w.week_index,
    entries: structuredClone(w.entries || []),
    notes: w.notes || "",
    startedAt: new Date(w.started_at).getTime(),
  };
  showLiveSession();
}
// Most recent logged numbers for an exercise, from earlier sessions.
function lastTimeFor(name, currentLogId) {
  const key = String(name).trim().toLowerCase();
  for (const w of state.clientWorkouts) {
    if (String(w.id) === String(currentLogId)) continue;
    const e = (w.entries || []).find(
      (x) => String(x.name).trim().toLowerCase() === key,
    );
    const sets = (e?.sets || []).filter((x) => x.weight || x.reps);
    if (sets.length)
      return `Last ${shortDate(w.started_at)}: ${sets
        .map((x) => `${x.weight || "—"}×${x.reps || "—"}`)
        .join(" · ")}`;
  }
  return "";
}
function showLiveSession() {
  const box = $("#liveSession");
  box.hidden = false;
  document.body.classList.add("live-open");
  renderLiveSession();
  clearInterval(state.liveClock);
  state.liveClock = setInterval(updateLiveClock, 1000);
  updateLiveClock();
}
function updateLiveClock() {
  const el = $("#liveClock");
  if (!el || !state.live) return;
  const secs = Math.max(
    0,
    Math.floor((Date.now() - state.live.startedAt) / 1000),
  );
  el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
function renderLiveSession() {
  const L = state.live;
  if (!L) return;
  const plan = normalizeProgramContent(L.program),
    weeks = Number(L.program.weeks) || 4,
    day = plan.days[L.dayIndex] || {},
    done = L.entries.reduce(
      (n, e) => n + e.sets.filter((x) => x.done).length,
      0,
    ),
    total = L.entries.reduce((n, e) => n + e.sets.length, 0);
  let lastBlock = "";
  $("#liveSession").innerHTML =
    `<header class="live-head"><div><span class="kicker">LIVE SESSION · ${esc(L.program.name || "Program")}</span><h2>${esc(L.client.name)}</h2></div><div class="live-pickers"><label>Day<select data-live="day" ${L.log ? "disabled" : ""}>${plan.days.map((d, i) => `<option value="${i}" ${i === L.dayIndex ? "selected" : ""}>${esc(d.name || `Day ${i + 1}`)}</option>`).join("")}</select></label><label>Week<select data-live="week" ${L.log ? "disabled" : ""}>${Array.from({ length: weeks }, (_, i) => `<option value="${i}" ${i === L.weekIndex ? "selected" : ""}>Week ${i + 1}</option>`).join("")}</select></label><div class="live-clock"><span id="liveClock">0:00</span><small>${done}/${total} sets</small></div></div><div class="live-actions"><span class="live-save" id="liveSaveState">${L.log ? "Saved" : "Not started"}</span><button class="secondary-btn" data-live="close">Save &amp; close</button><button class="primary-btn" data-live="finish">Finish session</button></div></header><div class="live-body">${
      day.warmup?.length
        ? `<section class="live-warmup"><span class="kicker">WARM-UP / PILLAR PREP</span>${day.warmup.map((w) => `<span>${esc(w.name)} <em>${esc(w.prescription || "")}</em></span>`).join("")}</section>`
        : ""
    }${L.entries
      .map((e, ei) => {
        const block = e.key.replace(/\d+$/, ""),
          divider =
            block !== lastBlock
              ? `<div class="live-block">BLOCK ${esc(block)}</div>`
              : "",
          last = lastTimeFor(e.name, L.log?.id);
        lastBlock = block;
        return `${divider}<article class="live-ex" data-ex="${ei}"><header><b>${esc(e.key)}</b><div><strong>${esc(e.name)}</strong><span>Target ${esc(e.target)}${e.coachNote ? ` · ${esc(e.coachNote)}` : ""}</span>${last ? `<small>${esc(last)}</small>` : ""}</div></header><div class="live-sets">${e.sets
          .map(
            (x, si) =>
              `<div class="live-set ${x.done ? "done" : ""}" data-set="${si}"><span>Set ${si + 1}</span><input inputmode="decimal" data-field="weight" value="${attr(x.weight)}" placeholder="${attr(si ? e.sets[si - 1].weight || "lbs" : "lbs")}" aria-label="${attr(e.name)} set ${si + 1} weight"><i>×</i><input inputmode="numeric" data-field="reps" value="${attr(x.reps)}" placeholder="${attr(String(e.target).split("×").pop().trim() || "reps")}" aria-label="${attr(e.name)} set ${si + 1} reps"><button class="live-check" data-live="check" aria-label="Set ${si + 1} done">✓</button></div>`,
          )
          .join(
            "",
          )}<button class="live-add" data-live="add-set">＋ Set</button></div><input class="live-note" data-field="note" value="${attr(e.note)}" placeholder="Notes for ${attr(e.name)} (form, pain, tempo…)"></article>`;
      })
      .join(
        "",
      )}<label class="live-notes">Session notes<textarea data-live-notes placeholder="How did the session go?">${esc(L.notes)}</textarea></label></div>`;
  updateLiveClock();
}
function liveInput(e) {
  const L = state.live;
  if (!L) return;
  if (e.target.matches("[data-live-notes]")) L.notes = e.target.value;
  const ex = e.target.closest("[data-ex]");
  if (ex && e.target.dataset.field) {
    const entry = L.entries[Number(ex.dataset.ex)],
      set = e.target.closest("[data-set]");
    if (e.target.dataset.field === "note") entry.note = e.target.value;
    else if (set)
      entry.sets[Number(set.dataset.set)][e.target.dataset.field] =
        e.target.value;
  }
  queueLiveSave();
}
function liveChange(e) {
  const L = state.live,
    which = e.target.dataset.live;
  if (!L || (which !== "day" && which !== "week")) return;
  if (L.entries.some((x) => x.sets.some((s) => s.weight || s.reps || s.done)))
    if (
      !confirm("Switch day or week? Numbers entered so far will be cleared.")
    ) {
      renderLiveSession();
      return;
    }
  if (which === "day") L.dayIndex = Number(e.target.value);
  else L.weekIndex = Number(e.target.value);
  L.entries = liveEntries(L.program, L.dayIndex, L.weekIndex);
  renderLiveSession();
}
async function liveClick(e) {
  const L = state.live,
    b = e.target.closest("[data-live]");
  if (!L || !b || b.tagName === "SELECT") return;
  const a = b.dataset.live,
    ex = b.closest("[data-ex]"),
    entry = ex && L.entries[Number(ex.dataset.ex)];
  if (a === "check") {
    const si = Number(b.closest("[data-set]").dataset.set),
      set = entry.sets[si];
    set.done = !set.done;
    // Ticking an empty set fills in what the placeholders suggested.
    if (set.done && !set.weight && si) set.weight = entry.sets[si - 1].weight;
    if (set.done && !set.reps)
      set.reps = String(entry.target)
        .split("×")
        .pop()
        .trim()
        .replace(/\/side$/, "");
    renderLiveSession();
    queueLiveSave();
  }
  if (a === "add-set") {
    entry.sets.push({
      weight: entry.sets.at(-1)?.weight || "",
      reps: "",
      done: false,
    });
    renderLiveSession();
    queueLiveSave();
  }
  if (a === "close") {
    await saveLiveSession();
    closeLiveSession("Session saved. Resume it from the client's profile.");
  }
  if (a === "finish") {
    if (!confirm("Finish this session and add it to the client's history?"))
      return;
    try {
      await saveLiveSession(true);
    } catch (err) {
      return toast(err.message || "Could not finish the session");
    }
    closeLiveSession("Session finished and logged");
  }
}
function queueLiveSave() {
  const L = state.live;
  if (!L) return;
  // Keep a local copy right away in case the connection drops mid-session.
  writeLocal(`taskdash_live_${L.client.id}`, {
    entries: L.entries,
    notes: L.notes,
    dayIndex: L.dayIndex,
    weekIndex: L.weekIndex,
    programId: L.program.id,
  });
  const status = $("#liveSaveState");
  if (status) status.textContent = "Saving…";
  clearTimeout(state.liveSaveTimer);
  state.liveSaveTimer = setTimeout(
    () => saveLiveSession().catch(() => {}),
    800,
  );
}
async function saveLiveSession(finish = false) {
  const L = state.live;
  if (!L) return;
  clearTimeout(state.liveSaveTimer);
  const status = $("#liveSaveState");
  try {
    if (!L.log) {
      L.log = await getJSON("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: L.client.id,
          programId: L.program.id,
          programName: L.program.name,
          dayIndex: L.dayIndex,
          dayName:
            normalizeProgramContent(L.program).days[L.dayIndex]?.name ||
            `Day ${L.dayIndex + 1}`,
          weekIndex: L.weekIndex,
          entries: L.entries,
        }),
      });
      L.startedAt = new Date(L.log.started_at).getTime() || L.startedAt;
    }
    L.log = await getJSON(`/api/workouts?id=${encodeURIComponent(L.log.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: L.entries,
        notes: L.notes,
        finish,
        dayKey: todayKey,
      }),
    });
    const i = state.clientWorkouts.findIndex(
      (w) => String(w.id) === String(L.log.id),
    );
    if (i >= 0) state.clientWorkouts[i] = L.log;
    else state.clientWorkouts.unshift(L.log);
    if (status) status.textContent = `Saved ${fmtTime(new Date())}`;
    $$("[data-live=day],[data-live=week]").forEach(
      (el) => (el.disabled = true),
    );
  } catch (err) {
    if (status) status.textContent = "Saved on this device only";
    if (finish) throw err;
  }
}
function closeLiveSession(message) {
  const L = state.live;
  clearInterval(state.liveClock);
  $("#liveSession").hidden = true;
  document.body.classList.remove("live-open");
  state.live = null;
  if (message) toast(message);
  if (L) {
    loadClients().then(() => {
      renderClients();
      renderDashboard();
      if (String(state.activeClient) === String(L.client.id))
        renderClientProfile();
    });
  }
}
// The nutrition questionnaire, pre-filled with the client's saved answers.
function openMealIntakeDialog(c) {
  const saved = c.nutrition_intake || {},
    fields = MealIntake.FIELDS.map((f) => {
      const value = saved[f.key];
      if (f.type === "select")
        return [f.key, f.label, "select", ["|—", ...f.options], value ?? "|—"];
      if (f.type === "multi")
        return [f.key, f.label, "multi", f.options, value || []];
      if (f.type === "textarea")
        return [f.key, f.label, "textarea", "", value ?? ""];
      return [f.key, f.label, f.type, "", value ?? ""];
    });
  openDialog({
    kicker: "MEAL PLAN QUESTIONNAIRE",
    title: `${c.name}'s nutrition`,
    fields,
    submit: async (v) => {
      const intake = {};
      for (const f of MealIntake.FIELDS)
        intake[f.key] = f.type === "select" ? optionValue(v[f.key]) : v[f.key];
      const btn = $("#dialogSubmit");
      btn.textContent = "Generating… about a minute";
      try {
        const saved = await getJSON("/api/meal-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: c.id, intake, dayKey: todayKey }),
        });
        state.activeMealPlan = saved.id;
      } finally {
        btn.textContent = "Generate meal plan";
        c.nutrition_intake = MealIntake.cleanIntake(intake);
      }
      await loadClients();
      await openClientProfile(c.id);
      state.activeMealPlan = state.clientMealPlans[0]?.id ?? null;
      renderClientProfile();
      renderDashboard();
      toast("Meal plan ready");
    },
  });
  $("#dialogSubmit").textContent = "Generate meal plan";
}
async function deleteMealPlan(id) {
  if (!confirm("Delete this meal plan?")) return;
  try {
    await getJSON(`/api/meal-plans?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {}
  state.clientMealPlans = state.clientMealPlans.filter(
    (m) => String(m.id) !== String(id),
  );
  state.mealPlanIndex = state.mealPlanIndex.filter(
    (m) => String(m.id) !== String(id),
  );
  state.activeMealPlan = state.clientMealPlans[0]?.id ?? null;
  renderClientProfile();
  toast("Meal plan deleted");
}
// Prints the meal plan from its own window, so the program print styles
// stay untouched.
function printMealPlan(c, id) {
  const row = state.clientMealPlans.find((m) => String(m.id) === String(id));
  if (!row) return;
  const plan = row.plan || {},
    n = (v) => Math.round(Number(v) || 0),
    w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print the meal plan");
  w.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.name)} · Meal plan</title><style>
body{font:13px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#111;margin:32px}
.cover{border-bottom:4px solid #d52b1e;padding-bottom:10px;margin-bottom:16px}
.cover span{font:700 9px ui-monospace,Menlo,monospace;color:#d52b1e;letter-spacing:.08em}
h1{font-size:26px;margin:4px 0}.totals{display:flex;gap:28px;margin:12px 0 18px}
.totals strong{display:block;font-size:20px}.totals span{font-size:10px;color:#666;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;vertical-align:top;text-align:left}
th{font-size:10px;text-transform:uppercase;background:#f3f3f3}td small{display:block;color:#666;margin-top:4px}
.notes{margin-top:16px;white-space:pre-wrap;font-size:12px}footer{margin-top:18px;font-size:10px;color:#666}
@page{margin:.45in}</style></head><body><div class="cover"><span>TASK DASH · MEAL PLAN</span><h1>${esc(c.name)}</h1><div>Week of ${esc(plan.week_start_date || shortDate(row.created_at))}</div></div><div class="totals"><div><strong>${n(plan.daily_calories)}</strong><span>Calories</span></div><div><strong>${n(plan.protein_grams_total)}g</strong><span>Protein</span></div><div><strong>${n(plan.carbs_grams_total)}g</strong><span>Carbs</span></div><div><strong>${n(plan.fat_grams_total)}g</strong><span>Fat</span></div></div><table><thead><tr><th>Meal</th><th>Foods</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr></thead><tbody>${(plan.meals || []).map((m) => `<tr><td><strong>${esc(m.meal_name)}</strong><small>${esc(cap(m.meal_type || ""))}</small></td><td>${esc(m.foods)}${m.notes ? `<small>${esc(m.notes)}</small>` : ""}</td><td>${n(m.calories)}</td><td>${n(m.protein_grams)}g</td><td>${n(m.carbs_grams)}g</td><td>${n(m.fat_grams)}g</td></tr>`).join("")}</tbody></table>${plan.coach_notes ? `<div class="notes"><strong>Coach notes</strong><br>${esc(plan.coach_notes)}</div>` : ""}<footer>${esc(state.settings.coach || "William Farparan")} · ${esc(state.settings.footer || "Move well. Train with intent.")}</footer></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 250);
}
// Dashboard: clients whose checklist isn't finished, soonest first session first.
function renderOnboardingQueue() {
  const box = $("#onboardingQueue");
  if (!box) return;
  const open = state.clients
    .map((c) => ({ c, st: onboardingStatus(c) }))
    .filter((x) => x.st && x.st.done < x.st.total)
    .sort((a, b) =>
      String(a.c.first_session || "9999").localeCompare(
        String(b.c.first_session || "9999"),
      ),
    );
  box.hidden = !open.length;
  box.innerHTML = open.length
    ? `<div class="builder-label"><span>NEW CLIENTS · SETUP BEFORE FIRST SESSION</span></div>${open
        .map(
          ({ c, st }) =>
            `<button class="onboard-row" data-client="${attr(c.id)}"><span class="onboard-ring">${st.done}/${st.total}</span><span><strong>${esc(c.name)}</strong><small>Next: ${esc(st.next.title)} · ${esc(firstSessionLabel(c))}</small></span><span aria-hidden="true">›</span></button>`,
        )
        .join("")}`
    : "";
}
function openClientEditDialog(c) {
  openDialog({
    kicker: "CLIENT ROSTER",
    title: `Edit ${c.name}`,
    fields: [
      ["name", "Full name", "text", "Client name", c.name],
      ["email", "Email", "email", "name@example.com", c.email || ""],
      ["phone", "Phone", "tel", "Optional", c.phone || ""],
      [
        "serviceType",
        "Primary service",
        "select",
        ["PT consult", "InBody scan", "Personal training"],
        c.service_type || "PT consult",
      ],
      [
        "status",
        "Status",
        "select",
        ["active", "inactive"],
        c.status || "active",
      ],
      [
        "firstSession",
        "First session",
        "date",
        "",
        c.first_session ? String(c.first_session).slice(0, 10) : "",
      ],
      [
        "nextFollowUp",
        "Next follow-up",
        "date",
        "",
        c.next_follow_up ? String(c.next_follow_up).slice(0, 10) : "",
      ],
      [
        "notes",
        "Notes",
        "textarea",
        "Goals, injuries, preferences",
        c.notes || "",
      ],
    ],
    submit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error("A client needs a name");
      const body = {
        name,
        email: v.email.trim(),
        phone: v.phone.trim(),
        serviceType: v.serviceType,
        status: v.status,
        firstSession: v.firstSession || null,
        nextFollowUp: v.nextFollowUp || null,
        notes: v.notes.trim(),
      };
      if (String(c.id).startsWith("local-")) {
        Object.assign(c, body, {
          service_type: body.serviceType,
          next_follow_up: body.nextFollowUp,
          first_session: body.firstSession,
        });
        writeLocal("taskdash_clients", state.clients);
      } else {
        await getJSON(`/api/clients?id=${encodeURIComponent(c.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadClients();
      }
      renderClients();
      renderDashboard();
      toast("Client updated");
    },
  });
}
async function deleteClient(c) {
  const count = state.sessions.filter(
    (s) => String(s.client_id) === String(c.id),
  ).length;
  const warning = count
    ? `Delete ${c.name} and their ${count} logged session${count === 1 ? "" : "s"}? Linked programs are kept but unlinked. This can't be undone.`
    : `Delete ${c.name}? This can't be undone.`;
  if (!confirm(warning)) return;
  try {
    if (!String(c.id).startsWith("local-"))
      await getJSON(`/api/clients?id=${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
    state.clients = state.clients.filter((x) => x !== c);
    state.sessions = state.sessions.filter(
      (s) => String(s.client_id) !== String(c.id),
    );
    writeLocal("taskdash_clients", state.clients);
    await loadPrograms();
    renderClients();
    renderPrograms();
    renderDashboard();
    toast("Client deleted");
  } catch (err) {
    toast(err.message || "Could not delete client");
  }
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
function normalizeEvent(raw) {
  const date = new Date(
    String(raw.event_date || raw.date).slice(0, 10) + "T12:00:00",
  );
  return {
    raw,
    name: raw.name,
    date,
    days: Math.round((date - startOfDay(today)) / 864e5),
  };
}
function eventSteps(raw) {
  const ev = normalizeEvent(raw);
  let map = raw.pipeline_state || {};
  if (typeof map === "string")
    try {
      map = JSON.parse(map);
    } catch {
      map = {};
    }
  return PIPE.filter(
    (s) => !s.vendor || raw.needs_vendor || raw.needsVendor,
  ).map((s) => {
    const due = new Date(ev.date);
    due.setDate(due.getDate() - s.offset);
    const delta = Math.round((due - startOfDay(today)) / 864e5);
    return {
      ...s,
      due,
      delta,
      done: !!map[s.key],
      compressed: ev.days >= 0 && ev.days < 14 && s.parallel,
    };
  });
}
function renderEvents() {
  document
    .querySelectorAll(".draft-panel[open]")
    .forEach((d) => state.openDrafts.add(d.closest(".event-card").dataset.id));
  document
    .querySelectorAll(".draft-panel:not([open])")
    .forEach((d) =>
      state.openDrafts.delete(d.closest(".event-card").dataset.id),
    );
  const list = state.events.map(normalizeEvent).sort((a, b) => a.date - b.date);
  $("#eventBoard").innerHTML = list.length
    ? list
        .map((e) => {
          const steps = eventSteps(e.raw),
            compressed = e.days >= 0 && e.days < 14;
          return `<article class="event-card" data-id="${e.raw.id}"><header><div><span class="kicker">${esc(e.raw.pillar || "WELLNESS EVENT")}</span><h2>${esc(e.name)}</h2><div class="event-meta">${fmtDate(e.date)}${eventTimeLabel(e.raw)}${e.raw.location ? ` · ${esc(e.raw.location)}` : ""} · ${steps.filter((s) => s.done).length} of ${steps.length} steps complete</div></div><div class="event-days"><strong>${Math.abs(e.days)}</strong><span>${e.days >= 0 ? "DAYS OUT" : "DAYS PAST"}</span></div></header>${compressed ? '<div class="compressed-alert"><strong>Compressed timeline.</strong> Book the room, build the flyer, and publish the initial Slack post in parallel.</div>' : ""}<div class="pipeline">${steps.map((s) => `<div class="pipeline-step ${s.done ? "done" : ""}"><input class="step-check" type="checkbox" data-step="${s.key}" ${s.done ? "checked" : ""}><span class="step-date">${fmtDate(s.due, { short: true })}</span><div><span class="step-name">${esc(s.name)}</span><span class="step-owner"> · ${esc(s.owner)}</span></div><span class="step-state ${s.done ? "" : s.compressed ? "now" : s.delta < 0 ? "overdue" : ""}">${s.done ? "DONE" : s.compressed ? "DO NOW" : s.delta < 0 ? "OVERDUE" : s.delta === 0 ? "TODAY" : `${s.delta}D`}</span></div>`).join("")}<div style="display:flex;justify-content:flex-end;padding-top:12px"><button class="text-btn" data-event-action="delete">Delete event</button></div></div>${draftPanelHTML(e.raw, steps)}</article>`;
        })
        .join("")
    : '<div class="empty-state">No events are in motion. Add an event date and Task Dash will calculate every SOP deadline.</div>';
  renderEventPreview();
}
function openEventDialog() {
  openDialog({
    kicker: "EVENT SOP",
    title: "Plan an event",
    fields: [
      ["name", "Event name", "text", "e.g. Press Pause"],
      ["date", "Event date", "date", ""],
      ["startTime", "Start time", "time", ""],
      ["endTime", "End time", "time", ""],
      ["location", "Location", "text", "e.g. Hooper Wellness Center"],
      [
        "pillar",
        "Exos pillar",
        "select",
        ["Movement", "Mindset", "Nutrition", "Recovery"],
      ],
      [
        "description",
        "What's happening",
        "textarea",
        "Who it's for, what they'll do, and the hook. The drafts are written from this.",
      ],
      ["attendance", "Expected attendance", "number", "20"],
      ["equipment", "Equipment needed", "text", "", "1x Table, 2x Chairs"],
      ["link", "Registration or info link", "url", "Optional"],
      ["catering", "Needs catering", "checkbox", false],
      ["cateringBudget", "Catering budget", "text", "e.g. Approximately $450"],
      [
        "menuIdeas",
        "Menu ideas",
        "textarea",
        "Optional. Leave blank and the draft suggests a menu that fits the pillar.",
      ],
      ["vendor", "New vendor / no SOP", "checkbox", false],
    ],
    submit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error("Give the event a name");
      if (!v.date) throw new Error("Choose the event date");
      if (v.startTime && v.endTime && v.endTime <= v.startTime)
        throw new Error("End time must be after start time");
      const body = {
        name,
        date: v.date,
        startTime: v.startTime || null,
        endTime: v.endTime || null,
        location: v.location.trim(),
        pillar: v.pillar,
        description: v.description.trim(),
        expectedAttendance: Number(v.attendance) || null,
        equipment: v.equipment.trim(),
        eventLink: v.link.trim(),
        cateringNeeded: !!v.catering,
        cateringBudget: v.catering ? v.cateringBudget.trim() : "",
        menuIdeas: v.catering ? v.menuIdeas.trim() : "",
        needsVendor: !!v.vendor,
      };
      let created = null;
      try {
        created = await getJSON("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        await loadEvents();
      } catch (err) {
        if (
          state.authRequired ||
          /\((400|401|403)\)|required|must/i.test(err.message)
        )
          throw err;
        state.events.push({
          ...body,
          id: `local-${Date.now()}`,
          event_date: v.date,
          needs_vendor: body.needsVendor,
          pipeline_state: {},
          drafts: {},
        });
        writeLocal("taskdash_events", state.events);
      }
      if (created) state.openDrafts.add(String(created.id));
      renderEvents();
      renderDashboard();
      toast(
        created
          ? "Event timeline built · drafting messages"
          : "Server unreachable — event saved on this device only",
      );
      if (created) generateEventDrafts(created.id);
    },
  });
}
function eventTimeLabel(raw) {
  const label = (t) => {
    if (!/^\d{2}:\d{2}$/.test(String(t || ""))) return "";
    const [h, m] = t.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };
  const start = label(raw.start_time),
    end = label(raw.end_time);
  return start ? ` · ${start}${end ? ` – ${end}` : ""}` : "";
}
function eventDrafts(raw) {
  let drafts = raw.drafts || {};
  if (typeof drafts === "string")
    try {
      drafts = JSON.parse(drafts);
    } catch {
      drafts = {};
    }
  return drafts;
}
function applicableDrafts(raw) {
  return DRAFT_TYPES.filter((t) => !t.needsCatering || raw.catering_needed);
}
function draftPanelHTML(raw, steps) {
  const id = String(raw.id),
    types = applicableDrafts(raw),
    drafts = eventDrafts(raw),
    ready = types.filter((t) => drafts[t.key]?.text).length,
    busy = types.some((t) => state.draftStatus[`${id}:${t.key}`] === "pending");
  if (id.startsWith("local-"))
    return `<details class="draft-panel"><summary><span>Messaging drafts</span><em>Available once this event is saved to the server</em></summary></details>`;
  return `<details class="draft-panel" ${state.openDrafts.has(id) ? "open" : ""}><summary><span>Messaging drafts</span><em data-draft-count>${busy ? "Drafting…" : `${ready} of ${types.length} ready`}</em></summary><div class="draft-list">${types.map((t) => draftSlotHTML(raw, t, steps)).join("")}</div><div class="draft-footer"><button class="secondary-btn" data-event-action="draft-all">${ready ? "Regenerate all drafts" : "Generate all drafts"}</button></div></details>`;
}
function draftSlotHTML(raw, type, steps = eventSteps(raw)) {
  const id = String(raw.id),
    draft = eventDrafts(raw)[type.key],
    status = state.draftStatus[`${id}:${type.key}`] || "",
    step = steps.find((s) => s.key === type.step),
    due = step
      ? ` · ${step.done ? "done" : `due ${fmtDate(step.due, { short: true })}`}`
      : "";
  let body;
  if (status === "pending")
    body = `<div class="draft-status">Drafting with Claude…</div>`;
  else if (status.startsWith("error:"))
    body = `<div class="draft-status error">${esc(status.slice(6))}</div>`;
  else if (draft?.text)
    body = `<textarea data-draft-text spellcheck="true" rows="${Math.min(18, Math.max(6, draft.text.split("\n").length + 1))}" aria-label="${attr(type.label)}">${esc(draft.text)}</textarea>`;
  else body = `<div class="draft-status">Not drafted yet.</div>`;
  const actions =
    draft?.text && status !== "pending"
      ? `<button class="text-btn" data-draft-action="copy">Copy</button>${type.email ? '<button class="text-btn" data-draft-action="mail">Open in mail</button>' : ""}<button class="text-btn" data-draft-action="regen">Regenerate</button>`
      : status === "pending"
        ? ""
        : `<button class="text-btn" data-draft-action="regen">${status ? "Retry" : "Generate"}</button>`;
  return `<section class="draft" data-draft="${type.key}"><header><div><strong>${esc(type.label)}</strong><small>${esc(type.hint)}${due}${draft?.edited ? " · edited" : ""}</small></div><div class="draft-actions">${actions}</div></header>${body}</section>`;
}
function refreshDraftSlot(eventId, key) {
  const raw = state.events.find((x) => String(x.id) === String(eventId)),
    card = document.querySelector(
      `.event-card[data-id="${CSS.escape(String(eventId))}"]`,
    );
  if (!raw || !card) return;
  const type = DRAFT_TYPES.find((t) => t.key === key),
    slot = card.querySelector(`[data-draft="${key}"]`);
  if (type && slot) slot.outerHTML = draftSlotHTML(raw, type);
  const types = applicableDrafts(raw),
    ready = types.filter((t) => eventDrafts(raw)[t.key]?.text).length,
    busy = types.some(
      (t) => state.draftStatus[`${raw.id}:${t.key}`] === "pending",
    ),
    count = card.querySelector("[data-draft-count]");
  if (count)
    count.textContent = busy
      ? "Drafting…"
      : `${ready} of ${types.length} ready`;
}
async function generateDraft(eventId, key) {
  const statusKey = `${eventId}:${key}`;
  state.draftStatus[statusKey] = "pending";
  refreshDraftSlot(eventId, key);
  try {
    const result = await getJSON(
      `/api/events?action=draft&id=${encodeURIComponent(eventId)}&key=${encodeURIComponent(key)}`,
      { method: "POST" },
    );
    const raw = state.events.find((x) => String(x.id) === String(eventId));
    if (raw) raw.drafts = { ...eventDrafts(raw), [key]: result.draft };
    delete state.draftStatus[statusKey];
  } catch (err) {
    state.draftStatus[statusKey] =
      `error:${err.message || "Could not draft this message"}`;
  }
  refreshDraftSlot(eventId, key);
}
async function generateEventDrafts(eventId) {
  const raw = state.events.find((x) => String(x.id) === String(eventId));
  if (!raw) return;
  await Promise.all(
    applicableDrafts(raw).map((t) => generateDraft(eventId, t.key)),
  );
  const failed = applicableDrafts(raw).filter((t) =>
    String(state.draftStatus[`${eventId}:${t.key}`] || "").startsWith("error:"),
  ).length;
  toast(
    failed
      ? `${failed} draft${failed === 1 ? "" : "s"} failed — use Retry`
      : `Drafts ready for ${raw.name}`,
  );
}
async function saveDraftEdit(e) {
  const card = e.target.closest(".event-card"),
    key = e.target.closest("[data-draft]")?.dataset.draft,
    raw = state.events.find((x) => String(x.id) === card?.dataset.id);
  if (!raw || !key) return;
  const previous = eventDrafts(raw)[key] || {};
  try {
    const result = await getJSON(
      `/api/events?id=${encodeURIComponent(raw.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: {
            key,
            text: e.target.value,
            generatedAt: previous.generatedAt,
          },
        }),
      },
    );
    raw.drafts = { ...eventDrafts(raw), [key]: result.draft };
    const small = e.target
      .closest("[data-draft]")
      .querySelector("header small");
    if (small && !small.textContent.endsWith(" · edited"))
      small.textContent += " · edited";
    toast("Draft saved");
  } catch (err) {
    toast(`Draft not saved — ${err.message}`);
  }
}
async function draftAction(b) {
  const card = b.closest(".event-card"),
    key = b.closest("[data-draft]").dataset.draft,
    raw = state.events.find((x) => String(x.id) === card.dataset.id);
  if (!raw) return;
  const textarea = card.querySelector(
      `[data-draft="${key}"] [data-draft-text]`,
    ),
    value = textarea?.value || "";
  if (b.dataset.draftAction === "regen") {
    if (
      eventDrafts(raw)[key]?.edited &&
      !confirm("Replace your edited draft with a new one?")
    )
      return;
    return generateDraft(raw.id, key);
  }
  if (b.dataset.draftAction === "copy") {
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied");
    } catch {
      textarea.select();
      toast("Press ⌘C to copy");
    }
    return;
  }
  if (b.dataset.draftAction === "mail") {
    const match = value.match(/^Subject:\s*(.*)\n+/i),
      subject = match ? match[1].trim() : raw.name,
      body = match ? value.slice(match[0].length) : value;
    location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}
async function eventStepChange(e) {
  const card = e.target.closest(".event-card");
  if (!card) return;
  const raw = state.events.find((x) => String(x.id) === card.dataset.id);
  if (!raw) return;
  let map = raw.pipeline_state || {};
  if (typeof map === "string")
    try {
      map = JSON.parse(map);
    } catch {
      map = {};
    }
  map[e.target.dataset.step] = e.target.checked;
  raw.pipeline_state = map;
  renderEvents();
  try {
    await getJSON(`/api/events?id=${encodeURIComponent(raw.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineState: map }),
    });
  } catch {
    writeLocal("taskdash_events", state.events);
  }
}
async function eventAction(e) {
  const draftButton = e.target.closest("[data-draft-action]");
  if (draftButton) return draftAction(draftButton);
  const all = e.target.closest('[data-event-action="draft-all"]');
  if (all) {
    const raw = state.events.find(
      (x) => String(x.id) === all.closest(".event-card").dataset.id,
    );
    const edited = applicableDrafts(raw).some(
      (t) => eventDrafts(raw)[t.key]?.edited,
    );
    if (
      edited &&
      !confirm("Regenerate every draft? Your edits will be replaced.")
    )
      return;
    return generateEventDrafts(raw.id);
  }
  const b = e.target.closest('[data-event-action="delete"]');
  if (!b) return;
  if (!confirm("Delete this event and its drafts?")) return;
  const card = b.closest(".event-card"),
    id = card.dataset.id;
  state.events = state.events.filter((x) => String(x.id) !== id);
  renderEvents();
  try {
    await getJSON(`/api/events?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {
    writeLocal("taskdash_events", state.events);
  }
  toast("Event removed");
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
function openDialog({ kicker, title, fields, submit }) {
  const d = $("#formDialog"),
    body = $("#dialogFields");
  $("#dialogKicker").textContent = kicker;
  $("#dialogTitle").textContent = title;
  $("#dialogSubmit").textContent = "Save";
  body.onclick = null;
  body.innerHTML = fields.map(fieldHTML).join("");
  const form = $("#dialogForm");
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (e.submitter?.value === "cancel") {
      d.close();
      return;
    }
    const values = {};
    for (const f of fields) {
      const el = form.elements[f[0]];
      values[f[0]] =
        f[2] === "checkbox"
          ? el.checked
          : f[2] === "multi"
            ? $$(`[name="${f[0]}"]:checked`, form).map((i) => i.value)
            : el.value;
    }
    const btn = $("#dialogSubmit");
    btn.disabled = true;
    try {
      await submit(values);
      d.close();
    } catch (err) {
      toast(err.message || "Could not save");
    } finally {
      btn.disabled = false;
    }
  };
  if (!d.open) d.showModal();
  setTimeout(
    () =>
      body.querySelector("input:not([type=checkbox]),select,textarea")?.focus(),
    50,
  );
}
function fieldHTML(f) {
  const [name, label, type, value, defaultValue] = f,
    full = type === "textarea" || type === "checkbox",
    required = ["name", "email"].includes(name);
  if (type === "select")
    return `<label class="${full ? "full" : ""}">${label}<select name="${name}" required>${value
      .map((v) => {
        const bits = String(v).split("|");
        return `<option value="${attr(v)}" ${defaultValue != null && String(v) === String(defaultValue) ? "selected" : ""}>${esc(bits.length > 1 ? bits.slice(1).join("|") : v)}</option>`;
      })
      .join("")}</select></label>`;
  if (type === "textarea")
    return `<label class="full">${label}<textarea name="${name}" placeholder="${attr(value || "")}">${esc(defaultValue || "")}</textarea></label>`;
  if (type === "multi")
    return `<fieldset class="full multi-field"><legend>${label}</legend>${value
      .map(
        (o) =>
          `<label class="chip-check"><input type="checkbox" name="${name}" value="${attr(o)}" ${(defaultValue || []).includes(o) ? "checked" : ""}><span>${esc(o)}</span></label>`,
      )
      .join("")}</fieldset>`;
  if (type === "checkbox")
    return `<label class="full toggle-row"><span>${label}</span><input name="${name}" type="checkbox" ${value ? "checked" : ""}></label>`;
  return `<label>${label}<input name="${name}" type="${type}" ${required ? "required" : ""} ${defaultValue != null ? `value="${attr(defaultValue)}"` : type === "date" || type === "time" || type === "number" ? `value="${attr(value || "")}"` : `placeholder="${attr(value || "")}"`}></label>`;
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
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function fmtDate(d, opt = {}) {
  return d.toLocaleDateString(
    "en-US",
    opt.short
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" },
  );
}
function fmtTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function shortDate(v) {
  if (!v) return "—";
  const d = new Date(String(v).slice(0, 10) + "T12:00:00");
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}
function initials(s) {
  return String(s)
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function attr(s = "") {
  return esc(s);
}
function readLocal(k, f) {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? f;
  } catch {
    return f;
  }
}
function writeLocal(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
