// Wellbeing Strategy report: the last step on an event card. William pastes
// the survey results and the head count; the numbers are computed here, Claude
// writes the description and takeaways, and the finished sheet text is one
// Copy away. Logic lives in js/event-report-core.js.
const REPORT_SETTINGS_KEY = "taskdash_report_settings";
const reportSettings = () => ({
  site: "SF",
  strategy: "",
  ...readLocal(REPORT_SETTINGS_KEY, {}),
});
// Pasted comments are used for drafting and never saved to the database.
const reportMemory = {};
const memory = (id) => (reportMemory[id] ||= { paste: "", comments: [] });

function eventReportOf(raw) {
  let r = raw.report || {};
  if (typeof r === "string")
    try {
      r = JSON.parse(r);
    } catch {
      r = {};
    }
  return {
    actual: null,
    goal: null,
    goalManual: false,
    nps: null,
    notes: "",
    ...r,
    // Until an objective is entered here, it's the event's expected attendance.
    objective: r.objective ?? raw.expected_attendance ?? null,
    strategy: { answer: null, reason: "", ...(r.strategy || {}) },
    description: r.description || [],
    takeaways: r.takeaways || [],
  };
}
const reportStarted = (raw) => {
  const r = eventReportOf(raw);
  return !!(
    r.actual != null ||
    r.nps ||
    r.description.length ||
    r.takeaways.length
  );
};
// "Draft ready" once the write-up exists; the step is done when ticked.
const reportReady = (raw) => {
  const r = eventReportOf(raw);
  return !!(r.nps && r.description.length && r.strategy.answer);
};
const reportDateLabel = (e) =>
  e.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function reportText(raw, e) {
  return EventReport.buildReportText({
    name: raw.name,
    dateLabel: reportDateLabel(e),
    site: reportSettings().site,
    report: eventReportOf(raw),
  });
}

function reportPanelHTML(raw, e) {
  const id = String(raw.id);
  if (id.startsWith("local-") || e.days > 0) return "";
  const r = eventReportOf(raw),
    mem = memory(id),
    cfg = reportSettings(),
    nps = r.nps,
    busy = state.reportBusy?.[id],
    status = busy
      ? "Drafting…"
      : reportReady(raw)
        ? "Draft ready"
        : reportStarted(raw)
          ? "In progress"
          : "Not started",
    seg = (field, value, label, current) =>
      `<button type="button" class="seg ${current === value ? "on" : ""}" data-report-action="${field}" data-value="${value}">${label}</button>`;
  return `<details class="report-panel" ${state.openReports.has(id) ? "open" : ""}><summary><span>Wellbeing Strategy report</span><em data-report-status>${raw.unsaved ? esc(raw.saveState || "Saved on this device only — retry to sync") : status}</em></summary><div class="report-body" ${busy ? "inert" : ""}><button class="text-btn" data-report-action="retry">Retry save</button>
<div class="report-grid">
<label>Objective<small>participants</small><input type="number" min="0" inputmode="numeric" data-report-field="objective" value="${attr(r.objective ?? "")}"></label>
<label>Actual attendance<small>from the badge reader</small><input type="number" min="0" inputmode="numeric" data-report-field="actual" value="${attr(r.actual ?? "")}"></label>
</div>
<label class="report-wide">Survey results<small>Open the Microsoft Forms results in Excel, copy the table with its header row, and paste it here. Names and emails are ignored.</small><textarea rows="4" data-report-field="paste" placeholder="Paste the results table…">${esc(mem.paste)}</textarea></label>
<div class="report-actions"><button type="button" class="secondary-btn" data-report-action="read">Read results</button>${nps ? `<span class="report-nps"><b>NPS ${nps.score ?? "—"}</b> · ${nps.responses} response${nps.responses === 1 ? "" : "s"} (${nps.promoters} promoters, ${nps.passives} passives, ${nps.detractors} detractors)${mem.comments.length ? ` · ${mem.comments.length} comment${mem.comments.length === 1 ? "" : "s"} read` : ""}</span>` : ""}</div>
<label class="report-wide">Your notes<small>Optional: what went well, what didn't, anything the survey won't say.</small><textarea rows="2" data-report-field="notes">${esc(r.notes)}</textarea></label>
<div class="report-actions"><button type="button" class="primary-btn" data-report-action="draft" ${busy ? "disabled" : ""}>${r.description.length ? "Redraft with Claude" : "Draft the write-up with Claude"}</button><span class="muted-note">Writes the description, takeaways and a Yes/No suggestion. The numbers above are never changed.</span></div>
<div class="report-answers">
<div class="report-choice"><strong>Meets the wellbeing strategy?</strong><div>${seg("strategy", "yes", "Yes", r.strategy.answer)}${seg("strategy", "no", "No", r.strategy.answer)}</div>${r.strategy.reason ? `<small>Claude: ${esc(r.strategy.reason)}</small>` : ""}</div>
<div class="report-choice"><strong>Goal</strong><div>${seg("goal", "met", "Met", r.goal)}${seg("goal", "not_met", "Not met", r.goal)}</div><small>${r.goalManual ? "Set by you." : r.goal ? "Suggested from attendance vs. objective." : "Enter the objective and attendance."}</small></div>
</div>
<label class="report-wide">Description<small>One bullet per line</small><textarea rows="4" data-report-field="description">${esc(r.description.join("\n"))}</textarea></label>
<label class="report-wide">Key takeaways<small>One bullet per line</small><textarea rows="4" data-report-field="takeaways">${esc(r.takeaways.join("\n"))}</textarea></label>
<div class="report-preview-head"><strong>Ready to paste into the sheet</strong><div><button type="button" class="secondary-btn" data-report-action="copy">Copy</button></div></div>
<pre class="report-preview" data-report-preview>${esc(reportText(raw, e))}</pre>
<details class="report-settings"><summary>Report settings</summary><label>Site name<input data-report-setting="site" value="${attr(cfg.site)}" placeholder="e.g. SF"></label><label class="report-wide">Wellbeing strategy wording<small>Paste what the strategy says. Claude judges Yes/No against it.</small><textarea rows="4" data-report-setting="strategy" placeholder="Paste the wellbeing strategy here…">${esc(cfg.strategy)}</textarea></label></details>
</div></details>`;
}

const lineList = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.replace(/^[*•\-\s]+/, "").trim())
    .filter(Boolean);

function reportContext(el) {
  const card = el.closest(".event-card"),
    raw = state.events.find((x) => String(x.id) === card?.dataset.id);
  return raw ? { raw, card, e: normalizeEvent(raw) } : null;
}
function refreshReport(raw) {
  const card = document.querySelector(
      `.event-card[data-id="${CSS.escape(String(raw.id))}"]`,
    ),
    old = card?.querySelector(".report-panel");
  if (!old) return;
  const wasOpen = old.open;
  if (wasOpen) state.openReports.add(String(raw.id));
  old.outerHTML = reportPanelHTML(raw, normalizeEvent(raw));
}
function refreshReportPreview(raw, card) {
  const pre = card.querySelector("[data-report-preview]");
  if (pre) pre.textContent = reportText(raw, normalizeEvent(raw));
  const status = card.querySelector("[data-report-status]");
  if (status && !state.reportBusy?.[raw.id])
    status.textContent = raw.unsaved
      ? raw.saveState || "Saved on this device only — retry to sync"
      : reportReady(raw)
        ? "Draft ready"
        : reportStarted(raw)
          ? "In progress"
          : "Not started";
}
function stageReport(raw) {
  raw.unsaved = true;
  pendingDrafts.add(raw);
  raw.saveState = writeLocal(`taskdash_report_${raw.id}`, raw.report)
    ? "Saved on this device only — retry to sync"
    : "Not saved — keep this page open and retry";
}
async function saveReport(raw) {
  stageReport(raw);
  try {
    await saveDraftRecord(raw, {
      snapshot: () => structuredClone(raw.report),
      persist: (unsaved) => {
        if (!unsaved) {
          localStorage.removeItem(`taskdash_report_${raw.id}`);
          return true;
        }
        return writeLocal(`taskdash_report_${raw.id}`, raw.report);
      },
      send: (report) =>
        getJSON(`/api/events?id=${encodeURIComponent(raw.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report }),
        }),
      status: (message) => {
        const card = document.querySelector(
          `.event-card[data-id="${CSS.escape(String(raw.id))}"] [data-report-status]`,
        );
        if (card) card.textContent = message;
      },
    });
    return true;
  } catch (err) {
    toast(`Report not saved — ${err.message}`);
    return false;
  }
}

// Keeps the Met / Not met suggestion in step with the head counts until
// William picks one himself.
function syncGoal(r) {
  if (!r.goalManual) r.goal = EventReport.suggestGoal(r.objective, r.actual);
}

async function reportChange(e, inputOnly = false) {
  const ctx = reportContext(e.target);
  if (e.target.dataset.reportSetting) {
    writeLocal(REPORT_SETTINGS_KEY, {
      ...reportSettings(),
      [e.target.dataset.reportSetting]: e.target.value.trim(),
    });
    if (ctx) refreshReportPreview(ctx.raw, ctx.card);
    return toast("Report setting saved");
  }
  if (!ctx) return;
  const { raw, card } = ctx,
    field = e.target.dataset.reportField,
    value = e.target.value;
  if (field === "paste") {
    memory(raw.id).paste = value;
    return;
  }
  const r = eventReportOf(raw);
  if (field === "objective" || field === "actual")
    r[field] = value === "" ? null : Math.max(0, Math.floor(Number(value)));
  if (field === "notes") r.notes = value.trim();
  if (field === "description") r.description = lineList(value);
  if (field === "takeaways") r.takeaways = lineList(value);
  syncGoal(r);
  raw.report = r;
  stageReport(raw);
  if (inputOnly) {
    refreshReportPreview(raw, card);
    return;
  }
  refreshReport(raw);
  await saveReport(raw);
}

// Points the survey tracker at the same response count the results show.
async function syncSurveyResponses(raw, responses) {
  let map = raw.pipeline_state || {};
  if (typeof map === "string")
    try {
      map = JSON.parse(map);
    } catch {
      map = {};
    }
  map._survey = { ...(map._survey || {}), responses };
  raw.pipeline_state = map;
  try {
    await getJSON(`/api/events?id=${encodeURIComponent(raw.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineState: map }),
    });
  } catch {
    toast(
      "Survey response count not saved — retry by reading the results again",
    );
  }
}

async function reportClick(b) {
  const ctx = reportContext(b);
  if (!ctx) return;
  const { raw, card } = ctx,
    action = b.dataset.reportAction,
    r = eventReportOf(raw),
    mem = memory(raw.id);
  if (action === "retry") return saveReport(raw);
  if (action === "read") {
    const text = card.querySelector('[data-report-field="paste"]').value;
    mem.paste = text;
    const parsed = EventReport.parseResults(text);
    if (parsed.error) return toast(parsed.error);
    r.nps = {
      promoters: parsed.promoters,
      passives: parsed.passives,
      detractors: parsed.detractors,
      responses: parsed.responses,
      score: parsed.nps,
    };
    mem.comments = parsed.comments;
    raw.report = r;
    state.openReports.add(String(raw.id));
    renderEvents();
    toast(`NPS ${parsed.nps} from ${parsed.responses} responses`);
    await Promise.all([
      saveReport(raw),
      syncSurveyResponses(raw, parsed.responses),
    ]);
    return;
  }
  if (action === "strategy") {
    r.strategy = { ...r.strategy, answer: b.dataset.value };
  } else if (action === "goal") {
    r.goal = b.dataset.value;
    r.goalManual = true;
  } else if (action === "copy") {
    const text = reportText(raw, ctx.e);
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it into the sheet.");
    } catch {
      const pre = card.querySelector("[data-report-preview]");
      getSelection().selectAllChildren(pre);
      toast("Press ⌘C to copy");
    }
    return;
  } else if (action === "draft") {
    if (
      (r.description.length || r.takeaways.length) &&
      !confirm(
        "Redraft with Claude? Your edits to the description and takeaways will be replaced.",
      )
    )
      return;
    state.reportBusy = { ...(state.reportBusy || {}), [raw.id]: true };
    refreshReport(raw);
    try {
      const out = await getJSON(
        `/api/events?action=report&id=${encodeURIComponent(raw.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...r,
            comments: mem.comments,
            strategyWording: reportSettings().strategy,
          }),
        },
      );
      r.description = out.description;
      r.takeaways = out.takeaways;
      r.strategy = out.strategy;
      r.generatedAt = new Date().toISOString();
      syncGoal(r);
      raw.report = r;
      toast("Write-up drafted. Check the Yes/No and the wording.");
    } catch (err) {
      toast(err.message || "Could not draft the report");
    } finally {
      delete state.reportBusy[raw.id];
    }
  } else return;
  raw.report = r;
  refreshReport(raw);
  await saveReport(raw);
}
