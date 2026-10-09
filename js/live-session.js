// Live training sessions: logging sets while coaching.
function trainingSectionHTML(c) {
  const programs = clientPrograms(c),
    logs = state.clientWorkouts,
    open = logs.find((w) => w.status !== "finished"),
    history = Progress.exerciseHistory(logs);
  const add = `<div class="program-add"><button class="secondary-btn" data-profile="add-stock">＋ From stock library</button><button class="secondary-btn" data-profile="add-copy">＋ Copy another client's program</button><button class="text-btn" data-profile="new-program">Blank program</button></div>`;
  return `<section class="training-log"><div class="builder-label"><span>TRAINING PROGRAMS</span></div>${
    programs.length
      ? programs.map((p) => clientProgramHTML(c, p, open)).join("")
      : '<p class="muted-note">No program yet. Copy one from the stock library (the original stays untouched) or build a blank one, then run it live from here.</p>'
  }${add}${
    open && !programs.some((p) => String(p.id) === String(open.program_id))
      ? `<div class="training-start"><button class="secondary-btn" data-profile="resume-live" data-workout="${attr(open.id)}">Resume ${esc(open.day_name || `Day ${open.day_index + 1}`)} · Week ${open.week_index + 1}</button></div>`
      : ""
  }${progressHTML(history)}${
    logs.length
      ? `<div class="builder-label"><span>SESSION HISTORY</span></div><div class="log-history">${logs
          .slice(0, 8)
          .map(
            (w) =>
              `<button class="log-row" data-profile="resume-live" data-workout="${attr(w.id)}"><strong>${shortDate(w.started_at)}</strong><span>${esc(w.program_name || "Program")} · ${esc(w.day_name || `Day ${w.day_index + 1}`)} · Week ${w.week_index + 1}</span><em>${w.status === "finished" ? `${workoutSetCount(w)} sets` : "In progress"}</em></button>`,
          )
          .join("")}</div>`
      : ""
  }</section>`;
}
// One attached program: where the client is up to, and a day × week grid
// that starts any session in a tap.
function clientProgramHTML(c, p, open) {
  const plan = normalizeProgramContent(p),
    prog = Progress.programProgress(p, state.clientWorkouts, plan),
    next = prog.next,
    dayName = prog.days[next.day] || `Day ${next.day + 1}`,
    source = p.source_program_id
      ? state.programs.find((x) => String(x.id) === String(p.source_program_id))
      : null,
    mine = open && String(open.program_id) === String(p.id);
  const grid = `<table class="run-grid"><thead><tr><th></th>${Array.from({ length: prog.weeks }, (_, w) => `<th>W${w + 1}</th>`).join("")}</tr></thead><tbody>${prog.days
    .map(
      (name, d) =>
        `<tr><th>${esc(name)}</th>${prog.cells[d]
          .map((cell, w) => {
            const isNext = !next.complete && next.day === d && next.week === w,
              cls = [
                cell.finished ? "done" : "",
                cell.open ? "open" : "",
                isNext ? "next" : "",
              ].join(" ");
            return `<td><button class="${cls}" data-profile="live" data-program="${attr(p.id)}" data-day="${d}" data-week="${w}" aria-label="${attr(`${name}, week ${w + 1}${cell.finished ? ", done" : isNext ? ", up next" : ""}`)}">${cell.finished ? "✓" : cell.open ? "•" : ""}</button></td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
  return `<article class="client-program" data-program="${attr(p.id)}"><header><div><strong>${esc(p.name)}</strong><small>${esc(cap(p.status || "draft"))} · ${plan.days.length} day${plan.days.length === 1 ? "" : "s"} × ${prog.weeks} week${prog.weeks === 1 ? "" : "s"}${source ? ` · copied from “${esc(source.name)}”` : ""}</small></div><div class="client-program-tools"><button class="text-btn" data-profile="open-program" data-program="${attr(p.id)}">Open</button><button class="text-btn" data-profile="print-program" data-program="${attr(p.id)}">Print</button><button class="text-btn danger-text" data-profile="remove-program" data-program="${attr(p.id)}">Remove</button></div></header><div class="client-program-run">${
    mine
      ? `<button class="primary-btn" data-profile="resume-live" data-workout="${attr(open.id)}">▶ Resume ${esc(open.day_name || `Day ${open.day_index + 1}`)} · Week ${open.week_index + 1}</button>`
      : `<button class="primary-btn" data-profile="live" data-program="${attr(p.id)}">▶ ${next.complete ? "Run again" : "Start"} ${esc(dayName)} · Week ${next.week + 1}</button>`
  }<span>${prog.done} of ${prog.total} sessions done${next.complete ? " · program complete" : ""}</span></div>${grid}</article>`;
}
// Every exercise the client has logged: last and best weight, trend, PRs.
function progressHTML(history) {
  if (!history.length) return "";
  const row = (h) => {
    const last = h.last,
      lastText =
        last.weight != null
          ? `${last.weight} lb${last.reps ? ` × ${last.reps}` : ""}`
          : last.reps
            ? `BW × ${last.reps}`
            : "logged",
      points = Progress.sparkPoints(h.trend);
    return `<tr><td><strong>${esc(h.name)}</strong>${h.pr ? ' <em class="pr">PR</em>' : ""}</td><td>${esc(lastText)}<small>${shortDate(last.date)}</small></td><td>${h.best != null ? `${h.best} lb` : "—"}</td><td>${points ? `<svg class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>` : ""}</td><td>${h.sessions.length}</td></tr>`;
  };
  return `<details class="progress-panel"><summary>Progress · ${history.length} exercise${history.length === 1 ? "" : "s"} logged</summary><div class="data-table-wrap"><table class="progress-table"><thead><tr><th>Exercise</th><th>Last</th><th>Best</th><th>Trend</th><th>Sessions</th></tr></thead><tbody>${history.map(row).join("")}</tbody></table></div></details>`;
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
function liveEntries(program, dayIndex, week, history = [], excludeId = null) {
  const day = normalizeProgramContent(program).days[dayIndex] || { blocks: [] };
  return (day.blocks || []).flatMap((b) =>
    b.exercises.map((x, i) => {
      const t = weekTarget(x, week),
        count = Math.max(1, Math.min(t.sets, 12)),
        suggest = Progress.suggestWeights(x.name, history, count, excludeId);
      return {
        key: `${b.letter}${i + 1}`,
        name: x.name,
        target: t.reps ? `${t.sets} × ${t.reps}` : `${t.sets} sets`,
        note: "",
        coachNote: x.note || "",
        // Last session's weights are offered, never logged until confirmed.
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
// Next day/week after the client's last finished session on this program.
function nextLiveDay(program, logs) {
  const next = Progress.nextDay(
    normalizeProgramContent(program).days.length || 1,
    Number(program.weeks) || 4,
    logs,
    program.id,
  );
  return { day: next.day, week: next.week };
}
async function startLiveSession(clientId, programId, dayIndex, weekIndex) {
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
    } catch (err) {
      return toast(
        err.message ||
          "Could not check for an unfinished session. Retry before starting.",
      );
    }
  const chosen = Number.isInteger(dayIndex) && Number.isInteger(weekIndex),
    open = state.clientWorkouts.find(
      (w) => w.status !== "finished" && String(w.program_id) === String(p.id),
    );
  // An unfinished session is resumed, unless a different day was picked and
  // William would rather start that one.
  if (open) {
    const same =
      !chosen || (open.day_index === dayIndex && open.week_index === weekIndex);
    if (
      same ||
      confirm(
        `Resume the unfinished ${open.day_name || `Day ${open.day_index + 1}`} · Week ${open.week_index + 1} session first?\n\nOK resumes it. Cancel starts the one you picked.`,
      )
    )
      return resumeLiveSession(c.id, open.id);
  }
  const { day, week } = chosen
    ? { day: dayIndex, week: weekIndex }
    : nextLiveDay(p, state.clientWorkouts);
  state.live = {
    client: c,
    program: p,
    log: null,
    dayIndex: day,
    weekIndex: week,
    entries: liveEntries(p, day, week, state.clientWorkouts),
    notes: "",
    startedAt: Date.now(),
  };
  restoreLiveDraft();
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
  restoreLiveDraft();
  showLiveSession();
}
function restoreLiveDraft() {
  const L = state.live,
    draft = readLocal(`taskdash_live_${L.client.id}`, null);
  if (
    !draft ||
    draft.unsaved === false ||
    String(draft.programId) !== String(L.program.id)
  )
    return;
  if (draft.logId && String(draft.logId) !== String(L.log?.id)) return;
  if (draft.dayIndex !== L.dayIndex || draft.weekIndex !== L.weekIndex) return;
  L.requestKey = draft.requestKey || L.requestKey;
  L.entries = draft.entries;
  L.notes = draft.notes || "";
  L.unsaved = true;
  pendingDrafts.add(L);
  L.saveState = "Recovered device draft — retry to sync";
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
  state.live.requestKey ||= crypto.randomUUID();
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
    `<header class="live-head"><div><span class="kicker">LIVE SESSION · ${esc(L.program.name || "Program")}</span><h2>${esc(L.client.name)}</h2></div><div class="live-pickers"><label>Day<select data-live="day" ${L.log ? "disabled" : ""}>${plan.days.map((d, i) => `<option value="${i}" ${i === L.dayIndex ? "selected" : ""}>${esc(d.name || `Day ${i + 1}`)}</option>`).join("")}</select></label><label>Week<select data-live="week" ${L.log ? "disabled" : ""}>${Array.from({ length: weeks }, (_, i) => `<option value="${i}" ${i === L.weekIndex ? "selected" : ""}>Week ${i + 1}</option>`).join("")}</select></label><div class="live-clock"><span id="liveClock">0:00</span><small>${done}/${total} sets</small></div></div><div class="live-actions"><span class="live-save" id="liveSaveState">${esc(L.saveState || (L.unsaved ? "Saved on this device only — retry to sync" : L.log ? "Saved" : "Not started"))}</span>${L.entries.some((e) => e.sets.some((x) => x.suggest && !x.weight)) ? '<button class="secondary-btn" data-live="use-last">Use last weights</button>' : ""}<button class="text-btn" data-live="retry">Retry save</button><button class="secondary-btn" data-live="close">Save &amp; close</button><button class="primary-btn" data-live="finish">Finish session</button></div></header><div class="live-body">${
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
        return `${divider}<article class="live-ex" data-ex="${ei}"><header><b>${esc(e.key)}</b><div><strong>${esc(e.name)}</strong><span>Target ${esc(e.target)}${e.coachNote ? ` · ${esc(e.coachNote)}` : ""}</span>${last ? `<small>${esc(last)}</small>` : ""}</div><button class="live-more" data-live="menu" aria-label="Change ${attr(e.name)}" aria-expanded="${L.menu === ei}">⋯</button></header>${L.menu === ei ? `<div class="live-tools"><button class="secondary-btn" data-live="swap">Swap exercise</button><button class="text-btn danger-text" data-live="remove">Remove</button></div>` : ""}<div class="live-sets">${e.sets
          .map(
            (x, si) =>
              `<div class="live-set ${x.done ? "done" : ""}" data-set="${si}"><span>Set ${si + 1}</span><input inputmode="decimal" data-field="weight" value="${attr(x.weight)}" class="${x.suggest && !x.weight ? "suggested" : ""}" placeholder="${attr(x.suggest || (si ? e.sets[si - 1].weight || "lbs" : "lbs"))}" aria-label="${attr(e.name)} set ${si + 1} weight${x.suggest ? `, last time ${attr(x.suggest)}` : ""}"><i>×</i><input inputmode="numeric" data-field="reps" value="${attr(x.reps)}" placeholder="${attr(String(e.target).split("×").pop().trim() || "reps")}" aria-label="${attr(e.name)} set ${si + 1} reps"><button class="live-check" data-live="check" aria-label="Set ${si + 1} done">✓</button></div>`,
          )
          .join(
            "",
          )}<button class="live-add" data-live="add-set">＋ Set</button></div><input class="live-note" data-field="note" value="${attr(e.note)}" placeholder="Notes for ${attr(e.name)} (form, pain, tempo…)"></article>`;
      })
      .join(
        "",
      )}<button class="secondary-btn live-add-exercise" data-live="add-exercise">＋ Add exercise</button><label class="live-notes">Session notes<textarea data-live-notes placeholder="How did the session go?">${esc(L.notes)}</textarea></label></div>`;
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
  L.entries = liveEntries(
    L.program,
    L.dayIndex,
    L.weekIndex,
    state.clientWorkouts,
    L.log?.id,
  );
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
    if (set.done && !set.weight)
      set.weight = set.suggest || (si ? entry.sets[si - 1].weight : "");
    if (set.done && !set.reps)
      set.reps = String(entry.target)
        .split("×")
        .pop()
        .trim()
        .replace(/\/side$/, "");
    renderLiveSession();
    queueLiveSave();
  }
  if (a === "use-last") {
    for (const e of L.entries)
      for (const x of e.sets) if (!x.weight && x.suggest) x.weight = x.suggest;
    renderLiveSession();
    queueLiveSave();
    return toast("Filled in last session's weights. Change what moved.");
  }
  if (a === "menu") {
    L.menu = L.menu === Number(ex.dataset.ex) ? null : Number(ex.dataset.ex);
    return renderLiveSession();
  }
  if (a === "swap") return openSwapExercise(entry, Number(ex.dataset.ex));
  if (a === "remove") return openRemoveExercise(entry, Number(ex.dataset.ex));
  if (a === "add-exercise") return openAddExercise();
  if (a === "add-set") {
    entry.sets.push({
      weight: entry.sets.at(-1)?.weight || "",
      reps: "",
      done: false,
    });
    renderLiveSession();
    queueLiveSave();
  }
  if (a === "retry") {
    try {
      await saveLiveSession();
    } catch (err) {
      toast(err.message || "Could not save");
    }
    return;
  }
  if (a === "close") {
    try {
      await saveLiveSession();
    } catch (err) {
      return toast(err.message || "Could not save; your session is still open");
    }
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
    closeLiveSession(
      "Session finished and logged",
      state.live?.log?.session_id,
    );
  }
}
function queueLiveSave() {
  const L = state.live;
  if (!L) return;
  L.unsaved = true;
  L.saveState = "Saving…";
  pendingDrafts.add(L);
  // Keep a local copy right away in case the connection drops mid-session.
  writeLocal(`taskdash_live_${L.client.id}`, {
    entries: L.entries,
    notes: L.notes,
    dayIndex: L.dayIndex,
    weekIndex: L.weekIndex,
    programId: L.program.id,
    requestKey: L.requestKey,
    logId: L.log?.id,
    unsaved: true,
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
  if (L.finishing) return L.finishing;
  clearTimeout(state.liveSaveTimer);
  const snapshot = () =>
    structuredClone({ entries: L.entries, notes: L.notes });
  const persist = (unsaved) =>
    writeLocal(`taskdash_live_${L.client.id}`, {
      ...snapshot(),
      dayIndex: L.dayIndex,
      weekIndex: L.weekIndex,
      programId: L.program.id,
      requestKey: L.requestKey,
      logId: L.log?.id,
      unsaved,
    });
  const save = () =>
    saveDraftRecord(L, {
      snapshot,
      persist,
      send: (payload) => persistLiveSession(L, payload, false),
      status: (message) => {
        if (state.live === L && $("#liveSaveState"))
          $("#liveSaveState").textContent = message;
      },
    });
  if (!finish) return save();
  // Prevent further edits between flushing the draft and completing the log.
  $("#liveSession").inert = true;
  L.finishing = (async () => {
    try {
      await save();
      await persistLiveSession(L, snapshot(), true);
      localStorage.removeItem(`taskdash_live_${L.client.id}`);
    } catch (err) {
      L.unsaved = true;
      pendingDrafts.add(L);
      persist(true);
      L.saveState = "Session not finished — retry";
      if ($("#liveSaveState")) $("#liveSaveState").textContent = L.saveState;
      throw err;
    } finally {
      $("#liveSession").inert = false;
      L.finishing = null;
    }
  })();
  return L.finishing;
}
async function persistLiveSession(L, payload, finish) {
  $$("[data-live=day],[data-live=week]").forEach((el) => (el.disabled = true));
  if (!L.log) {
    L.log = await getJSON("/api/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: L.client.id,
        requestKey: L.requestKey,
        programId: L.program.id,
        programName: L.program.name,
        dayIndex: L.dayIndex,
        dayName:
          normalizeProgramContent(L.program).days[L.dayIndex]?.name ||
          `Day ${L.dayIndex + 1}`,
        weekIndex: L.weekIndex,
        entries: payload.entries,
      }),
    });
    L.startedAt = new Date(L.log.started_at).getTime() || L.startedAt;
  }
  L.log = await getJSON(`/api/workouts?id=${encodeURIComponent(L.log.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entries: payload.entries,
      notes: payload.notes,
      finish,
      dayKey: todayKey,
    }),
  });
  const i = state.clientWorkouts.findIndex(
    (w) => String(w.id) === String(L.log.id),
  );
  if (i >= 0) state.clientWorkouts[i] = L.log;
  else state.clientWorkouts.unshift(L.log);
  $$("[data-live=day],[data-live=week]").forEach((el) => (el.disabled = true));
}

function closeLiveSession(message, wrapSessionId) {
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
      // A finished session goes straight to its wrap-up steps.
      if (wrapSessionId && wrapupSession(wrapSessionId))
        openWrapUp(wrapSessionId);
    });
  }
}

// ----- Changing the plan mid-session -----
// Each change is for today only (this session's log) or also saved into this
// client's own copy of the program. A stock template is never touched.
const exerciseNames = () => {
  const names = new Set();
  for (const p of state.programs)
    for (const d of normalizeProgramContent(p).days || [])
      for (const b of d.blocks || [])
        for (const x of b.exercises || []) if (x.name) names.add(x.name);
  return [...names].sort((a, b) => a.localeCompare(b));
};
// Gives the dialog's name field an autocomplete of known exercises.
function suggestExerciseNames() {
  const input = $('#dialogFields input[name="name"]');
  if (!input) return;
  input.setAttribute("list", "exerciseNames");
  input.autocomplete = "off";
  $("#dialogFields").insertAdjacentHTML(
    "beforeend",
    `<datalist id="exerciseNames">${exerciseNames()
      .map((n) => `<option value="${attr(n)}"></option>`)
      .join("")}</datalist>`,
  );
}
const scopeField = () => {
  const L = state.live,
    p = L.program,
    canSave = p && !p.is_stock && !String(p.id).startsWith("local-");
  return [
    "scope",
    "Apply to",
    "select",
    canSave
      ? [
          "today|Just today",
          `program|Also update ${String(L.client.name).split(/\s+/)[0]}'s program`,
        ]
      : ["today|Just today"],
  ];
};
// Saves a plan change into the client's program copy.
async function saveEditToProgram(edit) {
  const L = state.live,
    p = L.program,
    content = Progress.applyLiveEdit(
      normalizeProgramContent(p),
      L.dayIndex,
      edit,
      Number(p.weeks) || 4,
    );
  if (!content) throw new Error("couldn't find that exercise in the program");
  const saved = await getJSON(`/api/programs?id=${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      weeks: Number(p.weeks) || 4,
      daysPerWeek: content.days.length,
    }),
  });
  Object.assign(p, saved);
  writeLocal("taskdash_programs", state.programs);
}
async function commitLiveEdit(scope, edit, doneMessage) {
  renderLiveSession();
  queueLiveSave();
  if (!String(scope).startsWith("program"))
    return toast(`${doneMessage} for today`);
  try {
    await saveEditToProgram(edit);
    toast(`${doneMessage} · ${state.live.client.name}'s program updated`);
  } catch (err) {
    toast(`${doneMessage} for today only: ${err.message}`);
  }
}
function openSwapExercise(entry, index) {
  openDialog({
    kicker: "LIVE SESSION",
    title: `Swap ${entry.name}`,
    fields: [
      ["name", "Exercise to do instead", "text", "e.g. Goblet Squat"],
      scopeField(),
    ],
    submit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error("Name the exercise");
      const edit = { type: "swap", key: entry.key, from: entry.name, name };
      entry.name = name;
      state.live.menu = null;
      await commitLiveEdit(v.scope, edit, `Swapped to ${name}`);
    },
  });
  suggestExerciseNames();
}
function openRemoveExercise(entry, index) {
  openDialog({
    kicker: "LIVE SESSION",
    title: `Remove ${entry.name}?`,
    fields: [scopeField()],
    submit: async (v) => {
      const L = state.live,
        edit = { type: "remove", key: entry.key, from: entry.name };
      L.entries.splice(index, 1);
      L.menu = null;
      await commitLiveEdit(v.scope, edit, `Removed ${entry.name}`);
    },
  });
}
function openAddExercise() {
  openDialog({
    kicker: "LIVE SESSION",
    title: "Add an exercise",
    fields: [
      ["name", "Exercise", "text", "e.g. Face Pull"],
      ["sets", "Sets", "number", "3"],
      ["reps", "Reps", "text", "e.g. 10"],
      scopeField(),
    ],
    submit: async (v) => {
      const L = state.live,
        name = v.name.trim(),
        sets = Math.max(1, Math.min(Number(v.sets) || 3, 10)),
        reps = v.reps.trim();
      if (!name) throw new Error("Name the exercise");
      const block = (L.entries.at(-1)?.key || "A1").replace(/\d+$/, ""),
        suggest = Progress.suggestWeights(
          name,
          state.clientWorkouts,
          sets,
          L.log?.id,
        );
      L.entries.push({
        key: Progress.nextEntryKey(L.entries, block),
        name,
        target: reps ? `${sets} × ${reps}` : `${sets} sets`,
        note: "",
        coachNote: "",
        sets: Array.from({ length: sets }, (_, i) => ({
          weight: "",
          reps: "",
          suggest: suggest[i] || "",
          done: false,
        })),
      });
      await commitLiveEdit(
        v.scope,
        { type: "add", name, sets, reps, block },
        `Added ${name}`,
      );
    },
  });
  suggestExerciseNames();
}
