// Training programs: the library, stock templates, the program builder
// (with undo), printing.
async function loadPrograms() {
  try {
    state.programs = (await getJSON("/api/programs")).programs || [];
  } catch {
    state.programs = readLocal("taskdash_programs", []);
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
