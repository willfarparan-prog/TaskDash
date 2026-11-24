// The client app: a phone-first page each client opens from the private
// link William sends them (client.html#k=<key>). It shows their training
// plan, lets them log weights and reps, tracks their progress and books
// sessions. Everything goes through /api/portal with the key in a header.
// Uses window.Progress (js/progress.js) for history, PRs and suggestions.

const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY_STORE = "td_client_key",
  DRAFT_STORE = "td_client_draft",
  TZ = "America/Los_Angeles";

const app = {
  key: "",
  data: null,
  tab: "home",
  plan: { programId: null, week: null },
  progressFilter: "",
  openExercise: null,
  booking: { days: [], settings: null, day: null, slot: null, loaded: false },
  installPrompt: null,
};

document.addEventListener("DOMContentLoaded", init);

// ---------- start-up ----------
function readKey() {
  const fromHash = /[#&]k=([A-Za-z0-9_-]{32,64})/.exec(location.hash)?.[1];
  let stored = "";
  try {
    stored = localStorage.getItem(KEY_STORE) || "";
  } catch {}
  const key = fromHash || stored;
  if (fromHash && fromHash !== stored)
    try {
      localStorage.setItem(KEY_STORE, fromHash);
    } catch {}
  // Keep the key in the address so "Add to Home Screen" saves a link that
  // still opens this client's app (iPhone home-screen apps have their own
  // storage and start from the saved address).
  if (key && !fromHash) history.replaceState(null, "", `#k=${key}`);
  return key;
}

function isIOS() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
function isStandalone() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  );
}

async function init() {
  // Android installs from the manifest and shares storage with Chrome, so the
  // saved key carries over. iPhone ignores it and saves the current address.
  if (!isIOS()) {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/client-manifest.json";
    document.head.append(link);
  }
  // Opening a different personal link in the same tab switches to it.
  addEventListener("hashchange", () => {
    const k = /[#&]k=([A-Za-z0-9_-]{32,64})/.exec(location.hash)?.[1];
    if (k && k !== app.key) location.reload();
  });
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    app.installPrompt = e;
    if (app.tab === "home" && app.data) render();
  });
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) go(b.dataset.tab);
  });
  $("#view").addEventListener("click", onClick);
  $("#view").addEventListener("input", onInput);
  $("#view").addEventListener("change", onChange);
  $("#view").addEventListener("submit", onSubmit);
  app.key = readKey();
  if (!app.key) return renderNoKey();
  await loadData();
  if (!app.data) return;
  if (readDraft()) app.tab = "log";
  render();
}

async function loadData() {
  try {
    app.data = await api("me");
    $("#meBadge").textContent = initials(app.data.client.name);
    $("#meBadge").hidden = false;
    $("#tabs").hidden = false;
  } catch (err) {
    if (err.status === 401) renderNoKey(err.message);
    else
      $("#view").innerHTML =
        `<section class="card center"><h2>Couldn't load your training</h2><p class="muted">${esc(err.message)}</p><button class="btn primary" data-act="reload">Try again</button></section>`;
  }
}

async function api(resource, { method = "GET", body, query = "" } = {}) {
  const res = await fetch(
    `/api/portal?resource=${resource}${query ? `&${query}` : ""}`,
    {
      method,
      headers: {
        Accept: "application/json",
        "X-Client-Key": app.key,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify({ resource, ...body }) : undefined,
    },
  );
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

function go(tab) {
  app.tab = tab;
  render();
  scrollTo({ top: 0 });
}

function render() {
  $$("#tabs [data-tab]").forEach((b) =>
    b.toggleAttribute("aria-current", b.dataset.tab === app.tab),
  );
  const view = $("#view");
  if (app.tab === "home") view.innerHTML = homeHTML();
  if (app.tab === "plan") view.innerHTML = planHTML();
  if (app.tab === "log") view.innerHTML = logHTML();
  if (app.tab === "progress") view.innerHTML = progressHTML();
  if (app.tab === "book") {
    view.innerHTML = bookHTML();
    if (!app.booking.loaded) loadAvailability();
  }
  if (app.tab === "log") tickClock();
}

function renderNoKey(message) {
  $("#tabs").hidden = true;
  $("#view").innerHTML =
    `<section class="card center"><span class="kicker">YOUR TRAINING APP</span><h2>Open your personal link</h2><p class="muted">${esc(message || "This app opens from the private link William sent you. Tap that link again, or paste your code below.")}</p><form data-form="key" class="stack"><input name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your link or code" aria-label="Your link or code"><button class="btn primary">Open my training</button></form></section>`;
}

// ---------- program helpers ----------
function content(p) {
  let v = p?.content;
  try {
    if (typeof v === "string") v = JSON.parse(v);
  } catch {}
  return v && Array.isArray(v.days) ? v : { days: [] };
}
const programs = () => app.data?.programs || [];
const workouts = () => app.data?.workouts || [];
const findProgram = (id) =>
  programs().find((p) => String(p.id) === String(id)) || null;

// Sets and reps for one week. A cell like "4 × 6" overrides the set count.
function weekTarget(x, week) {
  const cell = String(x.reps?.[week] || "").trim(),
    m = /^(\d+)\s*[×x]\s*(.+)$/.exec(cell);
  return m
    ? { sets: Number(m[1]), reps: m[2].trim() }
    : { sets: Number(x.sets) || 3, reps: cell };
}
const targetText = (t) =>
  t.reps ? `${t.sets} × ${t.reps}` : `${t.sets} set${t.sets === 1 ? "" : "s"}`;

function nextFor(p) {
  return Progress.nextDay(
    content(p).days.length || 1,
    Number(p.weeks) || 4,
    workouts(),
    p.id,
  );
}

// "135 × 8" from the client's latest finished session with this exercise.
function lastTime(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase();
  for (const w of workouts()) {
    if (w.status !== "finished") continue;
    const e = (w.entries || []).find(
      (x) =>
        String(x.name || "")
          .trim()
          .toLowerCase() === key,
    );
    const sets = (e?.sets || []).filter((s) => s.weight || s.reps);
    if (!sets.length) continue;
    const top = [...sets].sort(
      (a, b) =>
        (Progress.weightOf(b.weight) || 0) - (Progress.weightOf(a.weight) || 0),
    )[0];
    return { text: setText(top), date: w.started_at };
  }
  return null;
}
function setText(s) {
  const w = String(s.weight || "").trim(),
    r = String(s.reps || "").trim();
  if (w && r)
    return `${w}${/^\d/.test(w) && !/[a-z]/i.test(w) ? " lb" : ""} × ${r}`;
  if (w) return `${w}${/^[\d.]+$/.test(w) ? " lb" : ""}`;
  return r ? `${r} reps` : "logged";
}

// ---------- home ----------
function homeHTML() {
  const d = app.data,
    c = d.client,
    hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    ),
    hello =
      hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening",
    next = d.bookings[0],
    draft = readDraft(),
    history = Progress.exerciseHistory(workouts()),
    prs = history.filter((h) => h.pr).slice(0, 4),
    monthKey = new Date().toISOString().slice(0, 7),
    thisMonth = workouts().filter(
      (w) =>
        w.status === "finished" &&
        String(w.started_at).slice(0, 7) === monthKey,
    ).length;
  const nextCard = next
    ? `<section class="card next"><span class="kicker">NEXT SESSION</span><h2>${esc(fmtDay(next.startsAt))}</h2><p>${esc(fmtTime(next.startsAt))} · ${esc(next.reason)}</p>${d.bookings.length > 1 ? `<small class="muted">+ ${d.bookings.length - 1} more booked</small>` : ""}</section>`
    : `<section class="card next empty"><span class="kicker">NEXT SESSION</span><h2>Nothing booked yet</h2><p class="muted">Pick a time that works for you.</p><button class="btn primary" data-act="go" data-tab="book">Book a session</button></section>`;
  const workoutCards = draft
    ? `<section class="card"><span class="kicker">IN PROGRESS</span><h3>${esc(draft.programName)} · ${esc(draft.dayName)}</h3><p class="muted">${draftSetCount(draft)} sets logged so far</p><button class="btn primary" data-act="go" data-tab="log">Resume workout</button></section>`
    : programs()
        .slice(0, 2)
        .map((p) => {
          const n = nextFor(p),
            day = content(p).days[n.day];
          return `<section class="card"><span class="kicker">UP NEXT · ${esc(p.name.toUpperCase())}</span><h3>${esc(day?.name || `Day ${n.day + 1}`)} · Week ${n.week + 1}</h3><p class="muted">${n.complete ? "You've finished every week. Repeat the last week until William updates your plan." : `${(day?.blocks || []).reduce((a, b) => a + b.exercises.length, 0)} exercises`}</p><div class="row"><button class="btn primary" data-act="start" data-program="${p.id}" data-day="${n.day}" data-week="${n.week}">Start workout</button><button class="btn ghost" data-act="view-day" data-program="${p.id}" data-week="${n.week}">See the plan</button></div></section>`;
        })
        .join("") ||
      `<section class="card"><span class="kicker">YOUR PLAN</span><h3>Your program is on its way</h3><p class="muted">William will add your training plan here. You can still log any workout now.</p><button class="btn ghost" data-act="free">Log a workout</button></section>`;
  const pkg = c.package
    ? `<div class="stat"><strong>${c.package.left}</strong><span>session${c.package.left === 1 ? "" : "s"} left of ${c.package.size}</span><i class="bar"><b style="width:${Math.min(100, (c.package.used / c.package.size) * 100)}%"></b></i></div>`
    : "";
  return `<section class="hello"><span class="kicker">${esc(hello.toUpperCase())}</span><h1>${esc(c.firstName || c.name)}.</h1></section>${installHTML()}${nextCard}${workoutCards}<section class="stats">${pkg}<div class="stat"><strong>${thisMonth}</strong><span>workout${thisMonth === 1 ? "" : "s"} this month</span></div><div class="stat"><strong>${history.length}</strong><span>exercise${history.length === 1 ? "" : "s"} tracked</span></div></section>${
    prs.length
      ? `<section class="card"><span class="kicker">RECENT PRS</span><ul class="prs">${prs.map((h) => `<li><span>${esc(h.name)}</span><strong>${h.last.weight} lb${h.last.reps ? ` × ${h.last.reps}` : ""}</strong></li>`).join("")}</ul></section>`
      : ""
  }`;
}

function installHTML() {
  if (isStandalone()) return "";
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("td_install_hidden") === "1";
  } catch {}
  if (dismissed) return "";
  const how = isIOS()
    ? 'Tap <b>Share</b> <span class="share-ico" aria-hidden="true">⇧</span> in Safari, then <b>Add to Home Screen</b>.'
    : app.installPrompt
      ? "Install it like an app, with its own icon."
      : "In your browser menu <b>⋮</b>, tap <b>Add to Home screen</b>.";
  return `<section class="card install"><div><strong>Put this on your home screen</strong><p>${how}</p></div><div class="row">${app.installPrompt ? '<button class="btn primary small" data-act="install">Install</button>' : ""}<button class="btn ghost small" data-act="hide-install">Got it</button></div></section>`;
}

// ---------- plan ----------
function planHTML() {
  if (!programs().length)
    return `<section class="card center"><span class="kicker">YOUR PLAN</span><h2>No program yet</h2><p class="muted">William will add your training plan here. Until then you can log any workout from the Log tab.</p></section>`;
  const p = findProgram(app.plan.programId) || programs()[0],
    plan = content(p),
    weeks = Number(p.weeks) || 4,
    n = nextFor(p),
    week = app.plan.week ?? n.week;
  app.plan.programId = p.id;
  const picker =
    programs().length > 1
      ? `<div class="chips">${programs()
          .map(
            (x) =>
              `<button class="chip ${String(x.id) === String(p.id) ? "on" : ""}" data-act="pick-program" data-program="${x.id}">${esc(x.name)}</button>`,
          )
          .join("")}</div>`
      : "";
  const weekChips = `<div class="chips weeks" role="tablist" aria-label="Week">${Array.from({ length: weeks }, (_, i) => `<button class="chip ${i === week ? "on" : ""}" data-act="pick-week" data-week="${i}" role="tab" aria-selected="${i === week}">Week ${i + 1}</button>`).join("")}</div>`;
  const days = plan.days
    .map((day, d) => {
      const done = workouts().some(
        (w) =>
          w.status === "finished" &&
          String(w.program_id) === String(p.id) &&
          w.day_index === d &&
          w.week_index === week,
      );
      const isNext = !n.complete && n.day === d && n.week === week;
      return `<details class="card day" ${isNext || plan.days.length === 1 ? "open" : ""}><summary><div><span class="kicker">${isNext ? "UP NEXT" : done ? "DONE ✓" : `DAY ${d + 1}`}</span><h3>${esc(day.name || `Day ${d + 1}`)}</h3></div><span class="count">${(day.blocks || []).reduce((a, b) => a + b.exercises.length, 0)} exercises</span></summary>${
        (day.warmup || []).length
          ? `<div class="warmup"><span class="label">WARM-UP</span><ul>${day.warmup.map((w) => `<li><span>${esc(w.name)}</span><em>${esc(w.prescription || "")}</em></li>`).join("")}</ul></div>`
          : ""
      }${(day.blocks || [])
        .map(
          (b) =>
            `<div class="block"><span class="letter">${esc(b.letter)}</span><ul>${b.exercises
              .map((x, i) => {
                const t = weekTarget(x, week),
                  last = lastTime(x.name);
                return `<li><div><strong>${esc(b.letter)}${i + 1} · ${esc(x.name)}</strong>${x.note ? `<small>${esc(x.note)}</small>` : ""}${last ? `<small class="last">Last: ${esc(last.text)}</small>` : ""}</div><em>${esc(targetText(t))}</em></li>`;
              })
              .join("")}</ul></div>`,
        )
        .join(
          "",
        )}<button class="btn primary wide" data-act="start" data-program="${p.id}" data-day="${d}" data-week="${week}">Log ${esc(day.name || `Day ${d + 1}`)} · Week ${week + 1}</button></details>`;
    })
    .join("");
  return `<section class="hello"><span class="kicker">YOUR PLAN</span><h1>${esc(p.name)}</h1>${p.goal ? `<p class="muted">${esc(p.goal)}</p>` : ""}</section>${picker}${weekChips}${days}`;
}

// ---------- log ----------
function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_STORE) || "null");
  } catch {
    return null;
  }
}
function writeDraft(d) {
  try {
    if (d) localStorage.setItem(DRAFT_STORE, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_STORE);
  } catch {}
}
const draftSetCount = (d) =>
  d.entries.reduce(
    (n, e) => n + e.sets.filter((s) => s.done || s.weight || s.reps).length,
    0,
  );

function requestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function startDraft(programId, dayIndex, weekIndex) {
  const p = findProgram(programId);
  let entries = [],
    dayName = "Workout",
    programName = "Workout";
  if (p) {
    const day = content(p).days[dayIndex] || { blocks: [] };
    dayName = day.name || `Day ${dayIndex + 1}`;
    programName = p.name;
    entries = (day.blocks || []).flatMap((b) =>
      b.exercises.map((x, i) => {
        const t = weekTarget(x, weekIndex),
          count = Math.max(1, Math.min(t.sets, 12)),
          suggest = Progress.suggestWeights(x.name, workouts(), count);
        return {
          key: `${b.letter}${i + 1}`,
          name: x.name,
          target: t.reps ? `${t.sets} × ${t.reps}` : `${t.sets} sets`,
          reps: t.reps,
          coachNote: x.note || "",
          note: "",
          sets: Array.from({ length: count }, (_, si) => ({
            weight: "",
            reps: "",
            suggest: suggest[si] || "",
            done: false,
          })),
        };
      }),
    );
  }
  const draft = {
    programId: p ? p.id : null,
    programName,
    dayIndex: p ? dayIndex : 0,
    dayName,
    weekIndex: p ? weekIndex : 0,
    startedAt: new Date().toISOString(),
    requestKey: requestKey(),
    notes: "",
    entries,
  };
  writeDraft(draft);
  go("log");
  if (!entries.length) setTimeout(() => $("#newExercise")?.focus(), 50);
}

function logHTML() {
  const draft = readDraft();
  if (!draft) return logStartHTML();
  return `<section class="log-head"><div><span class="kicker">${esc(draft.programName.toUpperCase())}${draft.programId ? ` · WEEK ${draft.weekIndex + 1}` : ""}</span><h1>${esc(draft.dayName)}</h1></div><div class="clock"><span id="clock">0:00</span><small>${draftSetCount(draft)} sets</small></div></section>${draft.entries
    .map((e, ei) => {
      const last = lastTime(e.name),
        repsHint = String(e.reps || "").match(/\d+/)?.[0] || "reps";
      return `<section class="card exercise" data-entry="${ei}"><header><div><span class="key">${esc(e.key || "+")}</span><strong>${esc(e.name)}</strong></div><em>${esc(e.target || "")}</em></header>${e.coachNote ? `<p class="coach-note">${esc(e.coachNote)}</p>` : ""}${last ? `<p class="last">Last time: ${esc(last.text)}</p>` : ""}<div class="sets">${e.sets
        .map(
          (s, si) =>
            `<div class="set ${s.done ? "done" : ""}" data-set="${si}"><span>${si + 1}</span><label><input inputmode="decimal" data-field="weight" value="${attr(s.weight)}" placeholder="${attr(s.suggest || (si && e.sets[si - 1].weight) || "–")}" aria-label="${attr(e.name)} set ${si + 1} weight"><small>lb</small></label><i>×</i><label><input inputmode="numeric" data-field="reps" value="${attr(s.reps)}" placeholder="${attr(repsHint)}" aria-label="${attr(e.name)} set ${si + 1} reps"><small>reps</small></label><button class="check" data-act="check" aria-label="Set ${si + 1} done" aria-pressed="${s.done}">✓</button></div>`,
        )
        .join(
          "",
        )}</div><div class="row tight"><button class="link" data-act="add-set">+ Add set</button>${e.sets.length > 1 ? '<button class="link" data-act="drop-set">− Remove set</button>' : ""}${e.key ? "" : '<button class="link danger" data-act="drop-exercise">Remove exercise</button>'}</div></section>`;
    })
    .join(
      "",
    )}<form class="card add-exercise" data-form="add-exercise"><label for="newExercise" class="kicker">ADD AN EXERCISE</label><div class="row"><input id="newExercise" name="name" maxlength="120" placeholder="e.g. Dumbbell row" autocomplete="off" list="exerciseNames"><button class="btn ghost">Add</button></div><datalist id="exerciseNames">${knownExercises()
    .map((n) => `<option value="${attr(n)}"></option>`)
    .join(
      "",
    )}</datalist></form><section class="card"><label class="kicker" for="workoutNotes">NOTES FOR WILLIAM</label><textarea id="workoutNotes" data-field="notes" maxlength="2000" placeholder="How did it feel? Anything hurt?">${esc(draft.notes || "")}</textarea></section><div class="finish"><button class="btn primary wide" data-act="finish" id="finishBtn">Finish &amp; save workout</button><button class="link danger" data-act="discard">Discard this workout</button></div>`;
}

function logStartHTML() {
  if (!programs().length)
    return `<section class="hello"><span class="kicker">LOG A WORKOUT</span><h1>What did you train?</h1><p class="muted">Add each exercise and log your weights and reps. William sees everything you log.</p></section><button class="btn primary wide" data-act="free">Start a workout</button>`;
  const p = findProgram(app.plan.programId) || programs()[0],
    n = nextFor(p),
    plan = content(p);
  return `<section class="hello"><span class="kicker">LOG A WORKOUT</span><h1>Ready to train?</h1><p class="muted">Pick the day you're doing. Your last weights are filled in as hints.</p></section><form class="card stack" data-form="start"><label>Program<select name="program">${programs()
    .map(
      (x) =>
        `<option value="${x.id}" ${String(x.id) === String(p.id) ? "selected" : ""}>${esc(x.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><div class="row"><label>Day<select name="day">${plan.days.map((d, i) => `<option value="${i}" ${i === n.day ? "selected" : ""}>${esc(d.name || `Day ${i + 1}`)}</option>`).join("")}</select></label><label>Week<select name="week">${Array.from({ length: Number(p.weeks) || 4 }, (_, i) => `<option value="${i}" ${i === n.week ? "selected" : ""}>Week ${i + 1}</option>`).join("")}</select></label></div><button class="btn primary wide">Start workout</button></form><button class="btn ghost wide" data-act="free">Log something else</button>`;
}

function knownExercises() {
  const names = new Set();
  for (const p of programs())
    for (const d of content(p).days)
      for (const b of d.blocks || [])
        for (const x of b.exercises) names.add(x.name);
  for (const w of workouts())
    for (const e of w.entries || []) names.add(e.name);
  return [...names].filter(Boolean).sort();
}

let clockTimer;
function tickClock() {
  clearInterval(clockTimer);
  const draft = readDraft();
  if (!draft) return;
  const paint = () => {
    const el = $("#clock");
    if (!el) return clearInterval(clockTimer);
    const s = Math.max(
      0,
      Math.floor((Date.now() - new Date(draft.startedAt)) / 1000),
    );
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  paint();
  clockTimer = setInterval(paint, 1000);
}

function updateDraft(fn, rerender = true) {
  const draft = readDraft();
  if (!draft) return;
  fn(draft);
  writeDraft(draft);
  if (rerender) {
    const y = scrollY;
    render();
    scrollTo({ top: y });
  }
}

async function finishWorkout() {
  const draft = readDraft();
  if (!draft) return;
  if (!draftSetCount(draft))
    return toast("Log at least one set first (weight, reps or ✓).");
  const btn = $("#finishBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await api("workout", {
      method: "POST",
      body: {
        programId: draft.programId,
        programName: draft.programName,
        dayIndex: draft.dayIndex,
        dayName: draft.dayName,
        weekIndex: draft.weekIndex,
        startedAt: draft.startedAt,
        requestKey: draft.requestKey,
        notes: draft.notes,
        entries: draft.entries.map((e) => ({
          key: e.key,
          name: e.name,
          target: e.target,
          coachNote: e.coachNote,
          note: e.note,
          sets: e.sets.filter((s) => s.done || s.weight || s.reps),
        })),
      },
    });
    writeDraft(null);
    await loadData();
    toast("Workout saved. Nice work!");
    go("progress");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Finish & save workout";
    toast(
      err.status
        ? err.message
        : "No connection. Your workout is saved on this phone; try again.",
    );
  }
}

// ---------- progress ----------
function progressHTML() {
  const done = workouts().filter((w) => w.status === "finished"),
    history = Progress.exerciseHistory(workouts()),
    q = app.progressFilter.trim().toLowerCase(),
    shown = q
      ? history.filter((h) => h.name.toLowerCase().includes(q))
      : history;
  if (!done.length)
    return `<section class="hello"><span class="kicker">PROGRESS</span><h1>Your lifts live here</h1><p class="muted">Every weight you log shows up here with your best, your last and your trend.</p></section><button class="btn primary wide" data-act="go" data-tab="log">Log your first workout</button>`;
  return `<section class="hello"><span class="kicker">PROGRESS</span><h1>${done.length} workout${done.length === 1 ? "" : "s"} logged</h1></section><section class="stats"><div class="stat"><strong>${history.length}</strong><span>exercises</span></div><div class="stat"><strong>${history.filter((h) => h.pr).length}</strong><span>new PRs</span></div><div class="stat"><strong>${done.reduce((n, w) => n + (w.entries || []).reduce((m, e) => m + (e.sets || []).filter((s) => s.done || s.weight || s.reps).length, 0), 0)}</strong><span>sets</span></div></section>${
    history.length > 6
      ? `<input class="search" type="search" data-field="filter" value="${attr(app.progressFilter)}" placeholder="Find an exercise" aria-label="Find an exercise">`
      : ""
  }<div class="lifts">${shown
    .map((h) => {
      const open = app.openExercise === h.name,
        pts = Progress.sparkPoints(h.trend, 96, 28);
      return `<section class="card lift ${open ? "open" : ""}"><button class="lift-head" data-act="toggle-lift" data-name="${attr(h.name)}" aria-expanded="${open}"><div><strong>${esc(h.name)}</strong>${h.pr ? '<em class="pr">PR</em>' : ""}<small>Last ${esc(h.last.weight != null ? `${h.last.weight} lb${h.last.reps ? ` × ${h.last.reps}` : ""}` : h.last.reps ? `${h.last.reps} reps` : "logged")} · ${esc(shortDate(h.last.date))}</small></div><div class="best">${pts ? `<svg viewBox="0 0 96 28" aria-hidden="true"><polyline points="${pts}" /></svg>` : ""}<span>${h.best != null ? `${h.best} lb` : "—"}<small>best</small></span></div></button>${
        open
          ? `<ol class="sessions">${[...h.sessions]
              .reverse()
              .map(
                (s) =>
                  `<li><span>${esc(shortDate(s.date))}</span><strong>${s.weight != null ? `${s.weight} lb` : "BW"}${s.reps ? ` × ${s.reps}` : ""}</strong><small>${s.sets} set${s.sets === 1 ? "" : "s"}</small></li>`,
              )
              .join("")}</ol>`
          : ""
      }</section>`;
    })
    .join(
      "",
    )}</div><h2 class="section-title">Recent workouts</h2><div class="card list">${done
    .slice(0, 15)
    .map(
      (w) =>
        `<div class="list-row"><div><strong>${esc(shortDate(w.started_at))} · ${esc(w.day_name || w.program_name || "Workout")}</strong><small>${esc(w.program_name || "")}${w.program_id ? ` · Week ${w.week_index + 1}` : ""} · ${w.source === "client" ? "logged by you" : "with William"}</small></div>${w.source === "client" ? `<button class="link danger" data-act="delete-workout" data-id="${w.id}" aria-label="Delete workout from ${attr(shortDate(w.started_at))}">Delete</button>` : ""}</div>`,
    )
    .join("")}</div>`;
}

// ---------- book ----------
function bookHTML() {
  const d = app.data,
    b = app.booking;
  const mine = d.bookings.length
    ? `<section class="card list"><span class="kicker">YOU'RE BOOKED</span>${d.bookings.map((x) => `<div class="list-row"><div><strong>${esc(fmtDay(x.startsAt))}</strong><small>${esc(fmtTime(x.startsAt))} · ${esc(x.reason)}</small></div></div>`).join("")}<p class="muted small">Need to change a time? Text or email William.</p></section>`
    : "";
  let picker;
  if (!b.loaded) picker = '<div class="loading">Loading open times…</div>';
  else if (b.error)
    picker = `<section class="card"><p class="muted">${esc(b.error)}</p><button class="btn ghost" data-act="reload-times">Try again</button></section>`;
  else if (b.paused)
    picker = `<section class="card"><p class="muted">Booking is paused for a moment while William's calendar reconnects. Check back shortly.</p></section>`;
  else if (!b.days.some((x) => x.openCount))
    picker = `<section class="card"><p class="muted">No open times in the next few weeks. Check back soon or message William.</p></section>`;
  else {
    const day = b.days.find((x) => x.date === b.day);
    picker = `<div class="days">${b.days
      .map((x) => {
        const date = new Date(`${x.date}T12:00:00`);
        return `<button class="day-btn ${x.date === b.day ? "on" : ""}" data-act="pick-day" data-date="${x.date}" ${x.openCount ? "" : "disabled"}><small>${date.toLocaleDateString("en-US", { weekday: "short" })}</small><strong>${date.getDate()}</strong><em>${x.openCount ? `${x.openCount} open` : "Full"}</em></button>`;
      })
      .join("")}</div>${
      day
        ? `<h2 class="section-title">${esc(day.label)}</h2><div class="times">${
            day.slots
              .filter((s) => s.open)
              .map(
                (s) =>
                  `<button class="time-btn ${b.slot?.startsAt === s.startsAt ? "on" : ""}" data-act="pick-slot" data-start="${s.startsAt}">${esc(s.label)}</button>`,
              )
              .join("") || '<p class="muted">No open times this day.</p>'
          }</div>`
        : ""
    }${
      b.slot
        ? `<form class="card stack confirm" data-form="book"><span class="kicker">CONFIRM</span><h3>${esc(fmtDay(b.slot.startsAt))} · ${esc(fmtTime(b.slot.startsAt))}</h3><label>What's it for?<select name="reason" required>${(b.settings.reasons || ["Personal training session"]).map((r) => `<option ${/personal training/i.test(r) ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label><label>Anything William should know? <small>optional</small><textarea name="notes" maxlength="1000" placeholder="Goals for the session, how you're feeling…"></textarea></label><button class="btn primary wide" id="bookBtn">Book ${esc(fmtTime(b.slot.startsAt))}</button><p class="muted small">Booking as ${esc(d.client.name)}${b.settings.location ? ` · ${esc(b.settings.location)}` : ""}</p></form>`
        : ""
    }`;
  }
  return `<section class="hello"><span class="kicker">BOOK A SESSION</span><h1>Find a time</h1>${b.settings ? `<p class="muted">${esc(b.settings.sessionMinutes || 60)} min · Pacific time${b.settings.location ? ` · ${esc(b.settings.location)}` : ""}</p>` : ""}</section>${mine}${picker}`;
}

async function loadAvailability() {
  const b = app.booking;
  b.error = "";
  try {
    const res = await fetch("/api/calendar-manual?resource=availability", {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || "Open times couldn't be loaded.");
    b.days = data.days || [];
    b.settings = data.settings || {};
    b.paused = !!data.paused;
    if (!b.days.some((x) => x.date === b.day && x.openCount))
      b.day = b.days.find((x) => x.openCount)?.date || null;
  } catch (err) {
    b.error = err.message;
  }
  b.loaded = true;
  if (app.tab === "book") render();
}

async function submitBooking(form) {
  const b = app.booking,
    btn = $("#bookBtn"),
    data = new FormData(form);
  btn.disabled = true;
  btn.textContent = "Booking…";
  try {
    const result = await api("book", {
      method: "POST",
      body: {
        startsAt: b.slot.startsAt,
        reason: data.get("reason"),
        notes: data.get("notes"),
      },
    });
    b.slot = null;
    b.loaded = false;
    await loadData();
    toast(
      `Booked: ${fmtDay(result.booking.startsAt)} at ${fmtTime(result.booking.startsAt)}`,
    );
    go("home");
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = "Book";
    if (/no longer|just booked/i.test(err.message)) {
      b.slot = null;
      b.loaded = false;
      render();
    }
  }
}

// ---------- events ----------
async function onClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "reload") location.reload();
  if (act === "go") go(b.dataset.tab);
  if (act === "install" && app.installPrompt) {
    app.installPrompt.prompt();
    await app.installPrompt.userChoice.catch(() => {});
    app.installPrompt = null;
    render();
  }
  if (act === "hide-install") {
    try {
      localStorage.setItem("td_install_hidden", "1");
    } catch {}
    render();
  }
  if (act === "pick-program") {
    app.plan = { programId: b.dataset.program, week: null };
    render();
  }
  if (act === "pick-week") {
    app.plan.week = Number(b.dataset.week);
    render();
  }
  if (act === "view-day") {
    app.plan = { programId: b.dataset.program, week: Number(b.dataset.week) };
    go("plan");
  }
  if (act === "start") {
    if (
      readDraft() &&
      !confirm("You have a workout in progress. Discard it and start this one?")
    )
      return go("log");
    startDraft(
      b.dataset.program,
      Number(b.dataset.day),
      Number(b.dataset.week),
    );
  }
  if (act === "free") {
    if (readDraft()) return go("log");
    startDraft(null, 0, 0);
  }
  const entry = b.closest("[data-entry]"),
    ei = entry ? Number(entry.dataset.entry) : -1;
  if (act === "check") {
    const si = Number(b.closest("[data-set]").dataset.set);
    updateDraft((d) => {
      const e = d.entries[ei],
        s = e.sets[si];
      s.done = !s.done;
      // Ticking an empty set fills in the hint: last weight, target reps.
      if (s.done && !s.weight)
        s.weight = s.suggest || (si ? e.sets[si - 1].weight : "");
      if (s.done && !s.reps)
        s.reps =
          String(e.reps || "").match(/^\d+$/)?.[0] ||
          (si ? e.sets[si - 1].reps : "");
    });
  }
  if (act === "add-set")
    updateDraft((d) => {
      const e = d.entries[ei],
        prev = e.sets.at(-1) || {};
      e.sets.push({
        weight: "",
        reps: "",
        suggest: prev.weight || prev.suggest || "",
        done: false,
      });
    });
  if (act === "drop-set") updateDraft((d) => d.entries[ei].sets.pop());
  if (act === "drop-exercise") updateDraft((d) => d.entries.splice(ei, 1));
  if (act === "finish") finishWorkout();
  if (
    act === "discard" &&
    confirm("Discard this workout? Nothing will be saved.")
  ) {
    writeDraft(null);
    render();
  }
  if (act === "toggle-lift") {
    app.openExercise =
      app.openExercise === b.dataset.name ? null : b.dataset.name;
    render();
  }
  if (
    act === "delete-workout" &&
    confirm("Delete this workout? Its weights come out of your progress.")
  ) {
    try {
      await api("workout", {
        method: "DELETE",
        query: `id=${encodeURIComponent(b.dataset.id)}`,
      });
      await loadData();
      render();
      toast("Workout deleted");
    } catch (err) {
      toast(err.message);
    }
  }
  if (act === "pick-day") {
    app.booking.day = b.dataset.date;
    app.booking.slot = null;
    render();
  }
  if (act === "pick-slot") {
    const day = app.booking.days.find((x) => x.date === app.booking.day);
    app.booking.slot =
      day?.slots.find((s) => s.startsAt === b.dataset.start) || null;
    render();
    $(".confirm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (act === "reload-times") {
    app.booking.loaded = false;
    render();
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.field === "filter") {
    app.progressFilter = t.value;
    const pos = t.selectionStart;
    render();
    const again = $('[data-field="filter"]');
    again?.focus();
    again?.setSelectionRange(pos, pos);
    return;
  }
  if (t.dataset.field === "notes")
    return updateDraft((d) => (d.notes = t.value), false);
  const set = t.closest("[data-set]"),
    entry = t.closest("[data-entry]");
  if (!set || !entry) return;
  updateDraft((d) => {
    d.entries[Number(entry.dataset.entry)].sets[Number(set.dataset.set)][
      t.dataset.field
    ] = t.value.trim().slice(0, 20);
  }, false);
}

function onChange(e) {
  const form = e.target.closest('[data-form="start"]');
  if (!form || e.target.name !== "program") return;
  app.plan = { programId: e.target.value, week: null };
  render();
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target,
    kind = form.dataset.form;
  if (kind === "key") {
    const raw = String(new FormData(form).get("key") || "");
    const key = /([A-Za-z0-9_-]{32,64})\s*$/.exec(raw.trim())?.[1];
    if (!key)
      return toast("That doesn't look like your link. Copy the whole thing.");
    try {
      localStorage.setItem(KEY_STORE, key);
    } catch {}
    location.hash = `k=${key}`;
    location.reload();
  }
  if (kind === "start") {
    const v = new FormData(form);
    startDraft(v.get("program"), Number(v.get("day")), Number(v.get("week")));
  }
  if (kind === "add-exercise") {
    const name = String(new FormData(form).get("name") || "")
      .trim()
      .slice(0, 120);
    if (!name) return;
    const suggest = Progress.suggestWeights(name, workouts(), 3);
    updateDraft((d) =>
      d.entries.push({
        key: "",
        name,
        target: "",
        reps: "",
        coachNote: "",
        note: "",
        sets: Array.from({ length: 3 }, (_, i) => ({
          weight: "",
          reps: "",
          suggest: suggest[i] || "",
          done: false,
        })),
      }),
    );
  }
  if (kind === "book") submitBooking(form);
}

// ---------- formatting ----------
function fmtDay(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}
function shortDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  });
}
function initials(s) {
  return String(s || "")
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0] || "")
    .join("")
    .toUpperCase();
}
function esc(v = "") {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const attr = esc;
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
