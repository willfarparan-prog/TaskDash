// Clients: the roster, client pages, the new-client checklist and meal
// plans.
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
          return `<tr data-id="${c.id}"><td><button class="client-name client-link" data-action="profile" aria-label="Open ${attr(c.name)}"><span class="mini-avatar">${initials(c.name)}</span><div><strong>${esc(c.name)}</strong><small class="client-email">${esc(c.email || "No email")}</small>${onboardingChipHTML(c)}</div></button></td><td><span class="service-pill">${esc(c.service_type || "PT consult")}</span></td><td data-label="Last session">${last ? shortDate(last.session_date) : "—"}</td><td data-label="Sessions"><strong>${sessions.length}</strong></td><td data-label="Next step">${c.next_follow_up ? shortDate(c.next_follow_up) : "—"}</td><td><div class="row-actions"><button class="session-btn" data-action="session">＋ Session</button><button class="text-btn" data-action="edit" aria-label="Edit ${attr(c.name)}">Edit</button><button class="text-btn danger-text" data-action="delete" aria-label="Delete ${attr(c.name)}">Delete</button></div></td></tr>`;
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
      let loggedId = null;
      try {
        const logged = await getJSON("/api/clients?resource=sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        loggedId = logged.id;
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
      if (v.type === "Personal training" && loggedId && wrapupSession(loggedId))
        setTimeout(() => openWrapUp(loggedId), 120);
    },
  });
}
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
// Opens (or refreshes) a client's own page at #client/<id>.
async function openClientProfile(id) {
  id = String(id);
  if (id !== state.activeClient) {
    state.activeClient = id;
    state.clientMealPlans = [];
    state.clientWorkouts = [];
    state.clientConsults = [];
    state.activeMealPlan = null;
    document.scrollingElement.scrollTop = 0;
  }
  state.view = "client";
  if (location.hash !== `#client/${id}`) location.hash = `client/${id}`;
  renderRoute();
  toggleRail(false);
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
  try {
    state.clientConsults =
      (await getJSON(`/api/consults?clientId=${encodeURIComponent(id)}`))
        .consults || [];
  } catch {
    state.clientConsults = [];
  }
  state.activeMealPlan = state.clientMealPlans[0]?.id ?? null;
  renderClientProfile();
}
function renderClientProfile() {
  const box = $("#clientProfile"),
    c = state.clients.find((x) => String(x.id) === state.activeClient);
  if (!box) return;
  if (!c) {
    box.innerHTML =
      '<div class="empty-state">This client isn\'t in your roster. They may have been deleted.</div>';
    return;
  }
  const st = onboardingStatus(c);
  box.innerHTML = `<div class="profile-head"><div class="client-name"><span class="mini-avatar">${initials(c.name)}</span><div><span class="kicker">CLIENT PROFILE</span><h2>${esc(c.name)}</h2><p>${esc(c.service_type || "PT consult")} · ${esc(c.email || "No email")}${c.phone ? ` · ${esc(c.phone)}` : ""}</p></div></div><div class="profile-head-actions"><button class="secondary-btn" data-profile="edit">Edit client</button></div></div>${
    st
      ? `<section class="onboarding"><div class="builder-label"><span>NEW-CLIENT CHECKLIST · ${st.done} OF ${st.total} DONE</span><span class="first-session ${c.first_session && String(c.first_session).slice(0, 10) <= todayKey && st.done < st.total ? "late" : ""}">${esc(firstSessionLabel(c))}</span></div><div class="onboarding-bar"><i style="width:${(st.done / st.total) * 100}%"></i></div>${st.steps.map((step, i) => onboardingStepHTML(c, step, i)).join("")}<button class="text-btn" data-profile="untrack">Stop tracking this checklist</button></section>`
      : `<section class="onboarding empty"><p>The new-client checklist isn't on for this client.</p><button class="secondary-btn" data-profile="track">Start new-client checklist</button></section>`
  }${consultSectionHTML(c)}${wrapupSectionHTML(c)}${trainingSectionHTML(c)}<section class="meal-plans"><div class="builder-label"><span>MEAL PLAN</span><button class="step-link" data-profile="intake">${state.clientMealPlans.length ? "＋ New meal plan" : "Fill in questionnaire + generate"}</button></div>${mealPlanSectionHTML(c)}</section>`;
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
      : `<button class="step-link" data-profile="add-stock">Copy from stock library</button><button class="step-link" data-profile="new-program">Create program</button>`;
    if (!step.done) detail = programs.length ? "Created · not printed yet" : "";
  }
  if (step.key === "mealPlan")
    actions = `<button class="step-link" data-profile="intake">${clientPlanCount(c) ? "New plan" : "Questionnaire + generate"}</button>`;
  if (step.key === "ptLogger")
    actions = `<button class="step-link" data-profile="copy-logger-row">Copy new-client row</button><a class="step-link" href="${attr(workAccountUrl(state.wrapupSettings.logger.url || PT_LOGGER_URL))}" target="_blank" rel="noopener noreferrer">Open the logger ↗</a>`;
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
  if (a === "wrapup") openWrapUp(b.dataset.session);
  if (a === "copy-logger-row") copyLoggerRow(c);
  if (a === "start-consult") startConsultFor(c);
  if (a === "open-consult") location.hash = `consult/${b.dataset.consultId}`;
  if (a === "add-stock") openAttachProgramDialog(c, "stock");
  if (a === "add-copy") openAttachProgramDialog(c, "copy");
  if (a === "remove-program") {
    const p = state.programs.find((x) => String(x.id) === b.dataset.program);
    if (p) {
      await deleteProgram(
        p,
        `Remove “${p.name}” from ${c.name}?\n\nSessions already logged are kept. The template it was copied from isn't affected.`,
      );
      renderClientProfile();
    }
  }
  if (a === "live")
    startLiveSession(
      c.id,
      b.dataset.program,
      b.dataset.day == null ? undefined : Number(b.dataset.day),
      b.dataset.week == null ? undefined : Number(b.dataset.week),
    );
  if (a === "resume-live") resumeLiveSession(c.id, b.dataset.workout);
  if (a === "show-plan") {
    state.activeMealPlan = b.dataset.plan;
    renderClientProfile();
  }
  if (a === "print-plan") printMealPlan(c, b.dataset.plan);
  if (a === "delete-plan") deleteMealPlan(b.dataset.plan);
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
      ["packageSize", "Package size (sessions)", "number", "e.g. 10", c.package_size ?? ""],
      [
        "packageStart",
        "Package started",
        "date",
        "",
        c.package_start ? String(c.package_start).slice(0, 10) : "",
      ],
      ["sessionMinutes", "Usual session length (minutes)", "number", "e.g. 50", c.session_minutes ?? ""],
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
        packageSize: v.packageSize ? Number(v.packageSize) : null,
        packageStart: v.packageStart || null,
        sessionMinutes: v.sessionMinutes ? Number(v.sessionMinutes) : null,
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
