// PT consult: the intake form William fills in with a prospect, the "are you
// starting personal training?" step, and the program suggestions that follow.
// Field list: js/consult-intake.js. Stock matching: js/consult-program-core.js.
state.clientConsults ||= [];
state.consult = null; // { id, client, answers, status, decision, ... }
const CONSULT_NEXT = {
  yes: "Starting personal training",
  not_now: "Not yet",
  undecided: "Still deciding",
};

// ----- Starting a consult -----
async function startConsult(body) {
  try {
    const out = await getJSON("/api/consults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!state.clients.some((c) => String(c.id) === String(out.client.id)))
      await loadClients();
    if (out.resumed) toast("Resuming this person's open consult");
    location.hash = `consult/${out.consult.id}`;
  } catch (err) {
    toast(err.message || "Could not start the consult");
  }
}
function openNewConsultDialog(prefill = {}) {
  openDialog({
    kicker: "PT CONSULT",
    title: "Who is the consult with?",
    fields: [
      ["name", "Name", "text", "Full name", prefill.name],
      ["email", "Email (optional)", "email", "name@example.com", prefill.email],
    ],
    submit: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error("Enter their name to start");
      await startConsult({
        name,
        email: v.email.trim(),
        bookingCode: prefill.bookingCode,
      });
    },
  });
  $("#dialogSubmit").textContent = "Start consult";
}
const startConsultFor = (client) => startConsult({ clientId: client.id });

// ----- Opening and saving -----
async function openConsult(id) {
  id = String(id);
  state.view = "consult";
  if (state.consult && String(state.consult.id) !== id) state.consult = null;
  renderRoute();
  if (!state.consult) {
    $("#consultView").innerHTML = '<div class="empty-state">Opening the consult…</div>';
    try {
      const out = await getJSON(`/api/consults?id=${encodeURIComponent(id)}`);
      const local = readLocal(`taskdash_consult_${id}`, null);
      state.consult = {
        ...out.consult,
        client: out.client,
        // A copy saved on this device that never reached the server wins.
        answers: local?.unsaved ? local.answers : out.consult.answers || {},
        unsaved: !!local?.unsaved,
      };
    } catch (err) {
      $("#consultView").innerHTML = `<div class="empty-state">${esc(err.message || "Couldn't open this consult.")}</div>`;
      return;
    }
  }
  renderConsult();
  if (state.consult.unsaved) queueConsultSave();
}
const consultAnswers = () => state.consult?.answers || {};

function queueConsultSave(now = false) {
  const C = state.consult;
  if (!C) return;
  // Keep a copy on this device first, in case the connection drops mid-consult.
  writeLocal(`taskdash_consult_${C.id}`, { answers: C.answers, unsaved: true });
  const status = $("#consultSaveState");
  if (status) status.textContent = "Saving…";
  clearTimeout(state.consultTimer);
  state.consultTimer = setTimeout(saveConsult, now ? 0 : 800);
}
async function saveConsult() {
  const C = state.consult;
  if (!C) return;
  clearTimeout(state.consultTimer);
  const status = $("#consultSaveState");
  try {
    await getJSON(`/api/consults?id=${encodeURIComponent(C.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: C.answers }),
    });
    C.unsaved = false;
    writeLocal(`taskdash_consult_${C.id}`, { answers: C.answers, unsaved: false });
    if (status) status.textContent = `Saved ${fmtTime(new Date())}`;
  } catch {
    if (status) status.textContent = "Saved on this device only";
  }
}

// ----- The form -----
function consultFieldHTML(f, value) {
  const id = `cf-${f.key}`,
    note = f.note ? `<small>${esc(f.note)}</small>` : "",
    cls = f.type === "textarea" ? "wide" : "";
  let input;
  if (f.type === "select")
    input = `<select id="${id}" data-cf="${f.key}"><option value="">—</option>${f.options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  else if (f.type === "textarea")
    input = `<textarea id="${id}" data-cf="${f.key}" rows="${f.tall ? 5 : 3}">${esc(value ?? "")}</textarea>`;
  else
    input = `<input id="${id}" data-cf="${f.key}" type="${f.type}" ${f.type === "number" ? 'inputmode="decimal" min="0"' : ""} value="${attr(value ?? "")}">`;
  return `<div class="consult-field ${cls}"><label for="${id}">${esc(f.label)}</label>${input}${note}</div>`;
}
function renderConsult() {
  const C = state.consult,
    box = $("#consultView");
  if (!C || !box) return;
  const done = C.status === "completed",
    answers = consultAnswers();
  const sections = ConsultIntake.SECTIONS.map((s) => {
    const fields = ConsultIntake.FIELDS.filter((f) => f.section === s.key);
    return `<section class="consult-section"><h3>${esc(s.title)}</h3><div class="consult-grid">${fields.map((f) => consultFieldHTML(f, answers[f.key])).join("")}</div></section>`;
  }).join("");
  box.innerHTML = `<div class="profile-head"><div class="client-name"><span class="mini-avatar">${initials(C.client.name)}</span><div><span class="kicker">PT CONSULT${done ? " · COMPLETED" : ""}</span><h2>${esc(answers.name || C.client.name)}</h2><p>${done ? esc(`${CONSULT_NEXT[C.decision] || "Finished"} · ${shortDate(C.completed_at || C.created_at)}`) : "Fill this in with them. It saves as you go."}</p></div></div><div class="profile-head-actions"><span class="live-save" id="consultSaveState">${C.unsaved ? "Saved on this device only" : "Saved"}</span><button class="secondary-btn" data-consult="profile">Client profile</button><button class="primary-btn" data-consult="finish">${done ? "Update the decision" : "Finish consult"}</button></div></div>${done && C.decision === "yes" ? '<div id="consultNext"></div>' : ""}<div class="consult-form">${sections}</div><div class="consult-foot"><button class="primary-btn" data-consult="finish">${done ? "Update the decision" : "Finish consult"}</button></div>`;
  if (done && C.decision === "yes") renderConsultNext();
}
function consultInput(e) {
  const key = e.target.dataset.cf,
    C = state.consult;
  if (!key || !C) return;
  C.answers[key] = e.target.value;
  queueConsultSave(e.type === "change");
}

// ----- Finishing: the decision -----
function openFinishConsult() {
  const C = state.consult;
  if (!C) return;
  openDialog({
    kicker: "PT CONSULT",
    title: "Are they starting personal training?",
    fields: [
      [
        "decision",
        "Decision",
        "select",
        [
          `yes|Yes, they're starting`,
          `not_now|Not yet`,
          `undecided|Still deciding`,
        ],
        C.decision || "yes",
      ],
      [
        "followUp",
        "Follow up on (if not starting now)",
        "date",
        "",
        C.follow_up ? String(C.follow_up).slice(0, 10) : "",
      ],
    ],
    submit: async (v) => {
      const decision = optionValue(v.decision);
      if (decision === "yes") {
        setTimeout(() => openStartTrainingDialog(), 120);
        return;
      }
      await completeConsult({ decision, followUp: v.followUp || null });
      toast("Consult saved");
    },
  });
  $("#dialogSubmit").textContent = "Continue";
}
function openStartTrainingDialog() {
  const C = state.consult,
    days = ["1", "2", "3", "4", "5", "6"],
    minutes = ["30", "45", "60", "75"];
  openDialog({
    kicker: "PT CONSULT",
    title: `Starting ${String(C.client.name).split(/\s+/)[0]} on personal training`,
    fields: [
      ["daysPerWeek", "Training days per week", "select", days, String(C.days_per_week || 3)],
      ["sessionMinutes", "Session length (minutes)", "select", minutes, String(C.session_minutes || 60)],
      ["packageSize", "Package size (sessions)", "number", "e.g. 10", C.client?.package_size ?? ""],
      ["packagePrice", "Package price paid, before tax ($)", "number", "e.g. 630", C.client?.package_price ?? ""],
      ["firstSession", "First session", "date", "", C.first_session ? String(C.first_session).slice(0, 10) : ""],
      ["makePt", "Mark as a Personal training client and start the new-client checklist", "checkbox", true],
    ],
    submit: async (v) => {
      await completeConsult({
        decision: "yes",
        daysPerWeek: Number(v.daysPerWeek),
        sessionMinutes: Number(v.sessionMinutes),
        firstSession: v.firstSession || null,
        packageSize: v.packageSize ? Number(v.packageSize) : null,
        packagePrice: v.packagePrice ? Number(v.packagePrice) : null,
        dayKey: todayKey,
        makePersonalTraining: !!v.makePt,
      });
      toast("Consult saved. Pick a program next.");
    },
  });
  $("#dialogSubmit").textContent = "Save and choose a program";
}
async function completeConsult(body) {
  const C = state.consult;
  clearTimeout(state.consultTimer);
  const out = await getJSON(
    `/api/consults?id=${encodeURIComponent(C.id)}&action=complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, answers: C.answers }),
    },
  );
  state.consult = { ...C, ...out.consult, client: out.client, unsaved: false };
  writeLocal(`taskdash_consult_${C.id}`, { answers: C.answers, unsaved: false });
  await loadClients();
  state.consultProgram = null;
  renderConsult();
  if (body.decision === "yes")
    $("#consultNext")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ----- After Yes: program, meal plan -----
function consultDays() {
  return Number(state.consult?.days_per_week) || 3;
}
function renderConsultNext() {
  const C = state.consult,
    box = $("#consultNext");
  if (!box) return;
  const client = state.clients.find((c) => String(c.id) === String(C.client_id)) || C.client,
    matches = ConsultProgram.rankStockPrograms(
      consultAnswers(),
      state.programs,
      consultDays(),
    ),
    attached = C.program_id
      ? state.programs.find((p) => String(p.id) === String(C.program_id))
      : null,
    cp = state.consultProgram;
  const matchCards = matches.length
    ? matches
        .map(
          (m) =>
            `<article class="match-card"><div><strong>${esc(m.program.name)}</strong><small>${esc([m.program.days_per_week && `${m.program.days_per_week} days`, m.program.emphasis, m.program.level].filter(Boolean).join(" · "))}</small><p>${esc(m.reason)}</p></div><div class="match-actions"><button class="text-btn" data-consult="preview-stock" data-program="${attr(m.program.id)}">Preview</button><button class="secondary-btn" data-consult="attach-stock" data-program="${attr(m.program.id)}">Attach a copy</button></div></article>`,
        )
        .join("")
    : '<div class="empty-state compact">No stock templates are available yet.</div>';
  const custom = cp?.busy
    ? '<div class="custom-program"><p class="muted-note">Claude is building a program from the consult… about a minute.</p></div>'
    : cp?.error
      ? `<div class="custom-program"><p class="load-error">${esc(cp.error)}</p></div>`
      : cp?.content
        ? customProgramHTML(cp)
        : "";
  box.innerHTML = `<section class="consult-next"><div class="builder-label"><span>NEXT STEPS FOR ${esc(String(client.name).toUpperCase())}</span></div>${
    attached
      ? `<div class="consult-attached">✓ Program attached: <strong>${esc(attached.name)}</strong><button class="text-btn" data-consult="open-program" data-program="${attr(attached.id)}">Open it</button></div>`
      : ""
  }<h3>Suggested program</h3><p class="muted-note">${consultDays()} days a week. Nothing is added to ${esc(client.name)} until you attach it, and you can edit it afterwards.</p><div class="match-list">${matchCards}</div><div class="custom-row"><button class="primary-btn" data-consult="build" ${cp?.busy ? "disabled" : ""}>${cp?.content ? "Rebuild a custom program" : "Build a custom program with Claude"}</button><span class="muted-note">Written around their goal, injuries and what they like.</span></div>${custom}<h3>PT Session Logger</h3><div class="custom-row"><button class="secondary-btn" data-consult="logger-row">Row for the new package</button><a class="step-link" href="${attr(workAccountUrl(state.wrapupSettings.logger.url))}" target="_blank" rel="noopener noreferrer">Open the logger ↗</a><span class="muted-note">Two quick pastes add them to the Unredeemed PT Session Log.</span></div><h3>Meal plan</h3><div class="custom-row"><button class="secondary-btn" data-consult="meal">Open the nutrition questionnaire</button><span class="muted-note">Age, height, weight, sex, training days and their average day are filled in from the consult.</span></div></section>`;
}
function customProgramHTML(cp) {
  const days = (cp.content.days || [])
    .map(
      (d, i) =>
        `<div class="cp-day"><strong>${esc(d.name || `Day ${i + 1}`)}</strong><ol>${(d.blocks || []).flatMap((b) => b.exercises.map((x) => `<li><b>${esc(b.letter)}</b> ${esc(x.name)} <em>${x.sets} × ${esc(x.reps?.[0] || "")}</em></li>`)).join("")}</ol></div>`,
    )
    .join("");
  return `<div class="custom-program"><header><strong>${esc(cp.name)}</strong><small>${esc(cp.goal)}</small></header>${cp.cautions.length ? `<div class="cp-cautions"><strong>Check before training</strong><ul>${cp.cautions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}${cp.rationale.length ? `<div class="cp-why"><strong>Why this program</strong><ul>${cp.rationale.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}<div class="cp-days">${days}</div><div class="custom-row"><button class="primary-btn" data-consult="attach-custom">Attach to ${esc(String(state.consult.client.name).split(/\s+/)[0])}</button><button class="text-btn" data-consult="build">Regenerate</button></div></div>`;
}
async function buildCustomProgram() {
  const C = state.consult;
  state.consultProgram = { busy: true };
  renderConsultNext();
  try {
    const out = await getJSON(
      `/api/consults?id=${encodeURIComponent(C.id)}&action=program`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daysPerWeek: consultDays(),
          sessionMinutes: C.session_minutes,
          answers: C.answers,
        }),
      },
    );
    state.consultProgram = out;
  } catch (err) {
    state.consultProgram = { error: err.message || "Could not build the program" };
  }
  renderConsultNext();
}
async function attachProgramToConsult(program) {
  const C = state.consult;
  await getJSON(`/api/consults?id=${encodeURIComponent(C.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ programId: program.id }),
  }).catch(() => {});
  C.program_id = program.id;
  await loadClients();
  toast(`Attached to ${C.client.name}. Opening it so you can adjust.`);
  go("programs");
  openProgram(program.id);
}
async function attachStockMatch(programId) {
  const source = state.programs.find((p) => String(p.id) === String(programId)),
    C = state.consult,
    client = state.clients.find((c) => String(c.id) === String(C.client_id)) || C.client;
  if (!source) return;
  try {
    const saved = await copyProgramForClient(
      source,
      client,
      `${client.name} — ${source.name}`,
      { status: "active" },
    );
    await attachProgramToConsult(saved);
  } catch (err) {
    toast(err.message || "Could not attach the program");
  }
}
async function attachCustomProgram() {
  const C = state.consult,
    cp = state.consultProgram;
  if (!cp?.content) return;
  try {
    const saved = await getJSON("/api/programs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: cp.name || `${C.client.name} · Program`,
        clientId: C.client_id,
        clientName: C.client.name,
        goal: cp.goal,
        daysPerWeek: cp.daysPerWeek,
        weeks: cp.weeks,
        status: "active",
        content: cp.content,
      }),
    });
    await loadPrograms();
    await attachProgramToConsult(saved);
  } catch (err) {
    toast(err.message || "Could not attach the program");
  }
}
function openConsultMealPlan() {
  const C = state.consult,
    client = state.clients.find((c) => String(c.id) === String(C.client_id)) || C.client,
    prefill = ConsultIntake.mealIntakeFrom(C.answers, Number(C.days_per_week) || null);
  openMealIntakeDialog({
    ...client,
    nutrition_intake: { ...prefill, ...(client.nutrition_intake || {}) },
  });
}

// ----- Click routing for the consult page -----
async function consultClick(e) {
  const b = e.target.closest("[data-consult]");
  if (!b || !state.consult) return;
  const a = b.dataset.consult;
  if (a === "profile") {
    await saveConsult();
    return openClientProfile(state.consult.client_id);
  }
  if (a === "finish") return openFinishConsult();
  if (a === "build") return buildCustomProgram();
  if (a === "attach-custom") return attachCustomProgram();
  if (a === "attach-stock") return attachStockMatch(b.dataset.program);
  if (a === "meal") return openConsultMealPlan();
  if (a === "logger-row") {
    const c =
      state.clients.find((x) => String(x.id) === String(state.consult.client_id)) ||
      state.consult.client;
    return openLoggerRows(c.id);
  }
  if (a === "open-program") {
    go("programs");
    return openProgram(b.dataset.program);
  }
  if (a === "preview-stock") {
    go("programs");
    return openProgram(b.dataset.program);
  }
}

// ----- On the client's profile -----
function consultSectionHTML(c) {
  const list = state.clientConsults,
    draft = list.find((x) => x.status === "draft");
  const rows = list
    .map((x) => {
      const goal = x.answers?.goal || "",
        label =
          x.status === "draft"
            ? "In progress"
            : CONSULT_NEXT[x.decision] || "Finished";
      return `<div class="log-row consult-row"><button class="consult-open" data-profile="open-consult" data-consult-id="${attr(x.id)}"><strong>${shortDate(x.created_at)}</strong><span>${esc(goal ? goal.slice(0, 90) : "PT consult")}</span><em>${esc(label)}</em></button>${x.status === "completed" && x.decision === "yes" ? `<button class="text-btn" data-profile="open-consult" data-consult-id="${attr(x.id)}">Program &amp; next steps</button>` : ""}</div>`;
    })
    .join("");
  return `<section class="consults"><div class="builder-label"><span>CONSULTS</span><button class="step-link" data-profile="start-consult">${draft ? "Resume consult" : "＋ Start consult"}</button></div>${rows || '<p class="muted-note">No consult on file. Start one to record their goals, history and what they want from training.</p>'}</section>`;
}
