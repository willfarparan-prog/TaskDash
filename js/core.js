// Task Dash shared basics: DOM helpers, app state, the API fetch helper,
// dialogs, formatting and local storage. Loaded first; every other file
// in js/ uses these.
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
const DEMO_MODE = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
  location.hostname,
);
function allowLocalFallback(error) {
  if (!DEMO_MODE) throw error;
}
const today = new Date(),
  todayKey = ymd(today);
const DEFAULT_BOOKING_SCHEDULE = {
  timezone: "America/Los_Angeles",
  requireCalendar: true,
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
  sops: [],
  sopTabs: [],
  sopTab: "daily",
  sopQuery: "",
  hubChat: [],
  hubBusy: false,
  sopError: "",
  linkFilter: "all",
  linkError: "",
  programFilter: "clients",
  mailFilter: "all",
  calendarOffset: 0,
  activeProgram: null,
  programDirty: false,
  programSaving: false,
  editorVersion: null,
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
async function requestJSON(url, opts) {
  const method = String(opts?.method || "GET").toUpperCase();
  let r;
  try {
    r = await fetch(url, {
      ...opts,
      signal: opts?.signal || AbortSignal.timeout(20000),
    });
  } catch (err) {
    if (method !== "GET") throw err;
    await new Promise((done) => setTimeout(done, 600));
    r = await fetch(url, {
      ...opts,
      signal: opts?.signal || AbortSignal.timeout(20000),
    }); // one retry for a dropped connection
  }
  if (method === "GET" && r.status >= 500) {
    await new Promise((done) => setTimeout(done, 600));
    r = await fetch(url, {
      ...opts,
      signal: opts?.signal || AbortSignal.timeout(20000),
    });
  }
  let data = {};
  try {
    data = await r.json();
  } catch {
    if (r.ok)
      throw new Error(
        "The server returned an unreadable response. Please retry.",
      );
  }
  if (!r.ok) {
    if (r.status === 401) state.authRequired = true;
    throw new Error(data.error || `Request failed (${r.status})`);
  }
  return data;
}
// Dialog selects use "value|label" options; these map between the two.
const optionFor = (options, value) =>
  options.find((o) => o.split("|")[0] === String(value)) || options[0];
const optionValue = (choice) => String(choice).split("|")[0];
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
    required = name === "name"; // only a name is ever mandatory
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
    return true;
  } catch {
    return false;
  }
}
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// Serialize autosaves and drain edits made while a request was in flight.
// A successful response acknowledges only the snapshot it actually saved.
const draftSaves = new WeakMap();
const pendingDrafts = new Set();
function saveDraftRecord(record, { snapshot, persist, send, status }) {
  if (draftSaves.has(record)) return draftSaves.get(record);
  const work = (async () => {
    record.unsaved = true;
    pendingDrafts.add(record);
    try {
      while (true) {
        const payload = snapshot(),
          version = JSON.stringify(payload);
        persist(true);
        record.saveState = "Saving…";
        status(record.saveState);
        await send(payload);
        if (JSON.stringify(snapshot()) !== version) continue;
        record.unsaved = false;
        pendingDrafts.delete(record);
        persist(false);
        record.saveState = `Saved ${fmtTime(new Date())}`;
        status(record.saveState);
        return true;
      }
    } catch (err) {
      record.saveState =
        persist(true) === false
          ? "Not saved — keep this page open and retry"
          : "Saved on this device only — retry to sync";
      status(record.saveState);
      throw err;
    }
  })();
  draftSaves.set(record, work);
  work.finally(() => draftSaves.delete(record)).catch(() => {});
  return work;
}

const readFailures = new Map();
async function getJSON(url, opts) {
  const read = !opts?.method || opts.method.toUpperCase() === "GET";
  const resource = String(url).split("?")[0];
  try {
    const data = await requestJSON(url, opts);
    if (read) readFailures.delete(resource);
    renderDataStatus();
    return data;
  } catch (err) {
    if (read) readFailures.set(resource, err.message);
    renderDataStatus();
    throw err;
  }
}
function renderDataStatus() {
  const gate = $("#ownerGate");
  if (gate) gate.hidden = !state.authRequired;
  const el = $("#dataStatus");
  if (!el) return;
  el.hidden = state.authRequired || !readFailures.size;
  if (!el.hidden)
    el.textContent = `Live data unavailable for ${[...readFailures.keys()].map((x) => x.split("/").pop().replaceAll("-", " ")).join(", ")}. Showing the last loaded data where available. Use Refresh to reconnect.`;
}
