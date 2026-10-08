// Events: the event SOP pipeline and AI messaging drafts.
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
  // Survey sends run on windows after the event; see js/survey-followup.js.
  {
    key: "survey",
    name: "Send Microsoft Forms NPS survey",
    offset: -3,
    owner: "William",
    survey: true,
  },
  {
    key: "survey-2",
    name: "Resend survey if under 30% responded",
    offset: -7,
    owner: "William",
    survey: true,
  },
  {
    key: "survey-3",
    name: "Final survey send if still under 30%",
    offset: -15,
    owner: "William",
    survey: true,
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
    email: true,
  },
  {
    key: "npsReminderEmail",
    step: "survey-2",
    label: "Survey reminder email",
    hint: "Only if under 30% responded · BCC attendees",
    email: true,
  },
  {
    key: "npsFinalEmail",
    step: "survey-3",
    label: "Final survey email",
    hint: "Only if still under 30% · BCC attendees",
    email: true,
  },
];
async function loadEvents() {
  try {
    state.events = (await getJSON("/api/events")).events || [];
  } catch {
    state.events = readLocal("taskdash_events", []);
  }
}
function normalizeEvent(raw) {
  const date = new Date(
    String(raw.event_date || raw.date).slice(0, 10) + "T12:00:00",
  );
  return {
    raw,
    name: raw.name,
    date,
    // Whole calendar days: compare midnights (the date itself is held at noon).
    days: Math.round((startOfDay(date) - startOfDay(today)) / 864e5),
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
  const done = Object.fromEntries(PIPE.map((s) => [s.key, !!map[s.key]]));
  return PIPE.filter(
    (s) => !s.vendor || raw.needs_vendor || raw.needsVendor,
  ).map((s) => {
    const due = new Date(ev.date);
    due.setDate(due.getDate() - s.offset);
    const delta = Math.round((startOfDay(due) - startOfDay(today)) / 864e5);
    const survey = s.survey
      ? SurveyFollowup.sendState(s.key, done, map._survey, -ev.days)
      : null;
    return {
      ...s,
      due,
      delta,
      done: !!map[s.key],
      // A resend that isn't needed (30%+ responded) counts as complete.
      skipped: survey?.state === "skipped",
      survey,
      compressed: ev.days >= 0 && ev.days < 14 && s.parallel,
    };
  });
}
function surveyStats(raw) {
  let map = raw.pipeline_state || {};
  if (typeof map === "string")
    try {
      map = JSON.parse(map);
    } catch {
      map = {};
    }
  return map._survey || {};
}
function stepDateLabel(s, eventDate) {
  const send = s.survey && SurveyFollowup.SENDS.find((x) => x.key === s.key);
  if (!send) return fmtDate(s.due, { short: true });
  const from = new Date(eventDate);
  from.setDate(from.getDate() + send.window[0]);
  const label = fmtDate(from, { short: true }),
    end = fmtDate(s.due, { short: true });
  return from.getMonth() === s.due.getMonth()
    ? `${label}–${s.due.getDate()}`
    : `${label}–${end}`;
}
function stepStateHTML(s) {
  if (s.done) return `<span class="step-state">DONE</span>`;
  const st = s.survey?.state;
  if (st === "skipped")
    return `<span class="step-state skipped" title="${Math.round(s.survey.rate * 100)}% responded">NOT NEEDED</span>`;
  if (st === "waiting")
    return `<span class="step-state waiting">AFTER ${s.key === "survey-2" ? "1ST" : "2ND"} SEND</span>`;
  if (st === "log") return `<span class="step-state now">LOG RESPONSES</span>`;
  if (st === "now") return `<span class="step-state now">SEND NOW</span>`;
  if (st === "overdue") return `<span class="step-state overdue">OVERDUE</span>`;
  if (st === "upcoming") return `<span class="step-state">${s.survey.inDays}D</span>`;
  return `<span class="step-state ${s.compressed ? "now" : s.delta < 0 ? "overdue" : ""}">${s.compressed ? "DO NOW" : s.delta < 0 ? "OVERDUE" : s.delta === 0 ? "TODAY" : `${s.delta}D`}</span>`;
}
// Logged after the first send: how many got the survey and how many answered.
function surveyTrackerHTML(e, steps) {
  if (e.days > 0) return "";
  const stats = surveyStats(e.raw),
    rate = SurveyFollowup.responseRate(stats),
    pct = rate == null ? null : Math.round(rate * 100),
    next = steps.find(
      (s) => s.survey && !s.done && !s.skipped && s.key !== "survey",
    ),
    verdict =
      rate == null
        ? "Log how many were emailed and how many responded."
        : rate < SurveyFollowup.RESEND_BELOW
          ? next
            ? `Under 30% — ${next.key === "survey-2" ? "resend" : "send the final survey"} ${next.survey?.state === "upcoming" ? `in ${next.survey.inDays} day${next.survey.inDays === 1 ? "" : "s"}` : "now"}.`
            : "Under 30%, and every send is done."
          : "30% or more responded — no more sends needed.";
  return `<div class="survey-tracker"><strong>NPS survey</strong><label>Emailed<input type="number" min="0" inputmode="numeric" data-survey-field="sent" value="${attr(stats.sent ?? "")}" placeholder="${attr(e.raw.expected_attendance || "")}"></label><label>Responses<input type="number" min="0" inputmode="numeric" data-survey-field="responses" value="${attr(stats.responses ?? "")}"></label><span class="survey-rate ${rate == null ? "" : rate < SurveyFollowup.RESEND_BELOW ? "low" : "ok"}">${pct == null ? "—" : `${pct}%`}</span><span class="survey-verdict">${esc(verdict)}</span></div>`;
}
async function surveyStatsChange(e) {
  const card = e.target.closest(".event-card"),
    raw = state.events.find((x) => String(x.id) === card?.dataset.id);
  if (!raw) return;
  let map = raw.pipeline_state || {};
  if (typeof map === "string")
    try {
      map = JSON.parse(map);
    } catch {
      map = {};
    }
  const value = e.target.value.trim(),
    n = Math.max(0, Math.floor(Number(value)));
  map._survey = {
    ...(map._survey || {}),
    [e.target.dataset.surveyField]: value === "" || !Number.isFinite(n) ? "" : n,
  };
  raw.pipeline_state = map;
  // The redraw replaces the inputs; put focus back where Tab/click moved it.
  setTimeout(() => {
    const next = document.activeElement?.dataset?.surveyField,
      sameCard = document.activeElement?.closest(".event-card") === card;
    renderEvents();
    if (next && sameCard)
      document
        .querySelector(
          `.event-card[data-id="${CSS.escape(String(raw.id))}"] [data-survey-field="${next}"]`,
        )
        ?.focus();
  });
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
          return `<article class="event-card" data-id="${e.raw.id}"><header><div><span class="kicker">${esc(e.raw.pillar || "WELLNESS EVENT")}</span><h2>${esc(e.name)}</h2><div class="event-meta">${fmtDate(e.date)}${eventTimeLabel(e.raw)}${e.raw.location ? ` · ${esc(e.raw.location)}` : ""} · ${steps.filter((s) => s.done || s.skipped).length} of ${steps.length} steps complete</div></div><div class="event-days"><strong>${Math.abs(e.days)}</strong><span>${e.days >= 0 ? "DAYS OUT" : "DAYS PAST"}</span></div></header>${compressed ? '<div class="compressed-alert"><strong>Compressed timeline.</strong> Book the room, build the flyer, and publish the initial Slack post in parallel.</div>' : ""}<div class="pipeline">${steps.map((s) => `<div class="pipeline-step ${s.done ? "done" : ""} ${s.skipped ? "skipped" : ""}"><input class="step-check" type="checkbox" data-step="${s.key}" ${s.done ? "checked" : ""}><span class="step-date">${stepDateLabel(s, e.date)}</span><div><span class="step-name">${esc(s.name)}</span><span class="step-owner"> · ${esc(s.owner)}</span></div>${stepStateHTML(s)}</div>`).join("")}${surveyTrackerHTML(e, steps)}<div style="display:flex;justify-content:flex-end;padding-top:12px"><button class="text-btn" data-event-action="delete">Delete event</button></div></div>${draftPanelHTML(e.raw, steps)}</article>`;
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
      ? ` · ${step.done ? "done" : step.skipped ? "not needed" : `due ${fmtDate(step.due, { short: true })}`}`
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
