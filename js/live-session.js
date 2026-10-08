// Live training sessions: logging sets while coaching.
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
