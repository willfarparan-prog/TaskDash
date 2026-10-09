// Session wrap-up: after a personal-training session, the four things that
// follow it. Task Dash builds the exact row or line and tracks what's done;
// the sheets, Workday and the paper form stay where they are.
// Logic: js/wrapup-core.js.
state.wrapupSettings = Wrapup.cleanSettings(
  readLocal("taskdash_wrapup_settings", {}),
);
state.wrapupSession = null;

async function loadWrapupSettings() {
  try {
    const out = await getJSON("/api/settings");
    state.wrapupSettings = Wrapup.cleanSettings(out.settings?.wrapup);
    writeLocal("taskdash_wrapup_settings", state.wrapupSettings);
  } catch {
    // Keep whatever this browser last saw.
  }
}
const wrapupClient = (s) =>
  state.clients.find((c) => String(c.id) === String(s.client_id));
const wrapupContext = (s) =>
  Wrapup.context({
    client: wrapupClient(s) || { id: s.client_id },
    session: s,
    sessions: state.sessions,
    settings: state.wrapupSettings,
    trainer: state.settings.coach || "William Farparan",
  });
const wrapupSession = (id) =>
  state.sessions.find((s) => String(s.id) === String(id));

// ----- The wrap-up window -----
function openWrapUp(sessionId) {
  const s = wrapupSession(sessionId);
  if (!s) return toast("Couldn't find that session");
  state.wrapupSession = String(sessionId);
  renderWrapUp();
  const d = $("#wrapUpDialog");
  if (!d.open) d.showModal();
}
function wrapupStepHTML(step, s, ctx) {
  const set = state.wrapupSettings,
    done = s.wrapup?.[step.key],
    check = `<input type="checkbox" data-wu-step="${step.key}" aria-label="${attr(step.title)} done" ${done ? "checked" : ""}>`,
    open = (url, label) =>
      `<a class="step-link" href="${attr(step.key === "workday" ? url : workAccountUrl(url))}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
  let body = "",
    actions = "";
  if (step.key === "sf") {
    body = "";
    actions = `${open(set.sf.url, "Open the Working Doc")}<span class="muted-note">Enter your number there.</span>`;
  } else if (step.key === "logger") {
    body = Wrapup.rowText(set.logger.columns, ctx);
    actions = `<button class="step-link" data-wu="copy" data-what="logger">Copy Total Used + Date</button>${open(set.logger.url, "Open the logger")}<span class="muted-note">Find <b>${esc(ctx.lastFirst)}</b>, then paste into <b>Total Used</b> and <b>Date of Last Session Redeemed</b>.</span>`;
  } else if (step.key === "workday") {
    body = Wrapup.workdayText(ctx);
    actions = `<button class="step-link" data-wu="copy" data-what="workday">Copy entry</button>${open(set.workdayUrl, "Open Workday")}`;
  } else
    actions = `<span class="muted-note">Have them sign the paper EXOS PT Client Signature Form before they leave.</span>`;
  return `<div class="wu-step ${done ? "done" : ""}"><div class="wu-check">${check}</div><div class="wu-main"><strong>${esc(step.title)}</strong>${done ? `<small>Done ${esc(shortDate(done))}</small>` : ""}${body ? `<pre class="wu-text" data-wu-text="${step.key}">${esc(body)}</pre>` : ""}<div class="wu-actions">${actions}</div></div></div>`;
}
function renderWrapUp() {
  const s = wrapupSession(state.wrapupSession),
    d = $("#wrapUpDialog");
  if (!s || !d) return;
  const c = wrapupClient(s) || { name: "Client" },
    ctx = wrapupContext(s),
    lengths = [
      ...new Set([...state.wrapupSettings.rates.map((r) => r.minutes), ctx.length]),
    ].sort((a, b) => a - b),
    gaps = Wrapup.gaps(ctx),
    n = Wrapup.stepsDone(s);
  d.innerHTML = `<div class="modal-head"><div><span class="kicker">SESSION WRAP-UP · ${n} OF ${Wrapup.STEPS.length} DONE</span><h2>${esc(c.name)}${ctx.session ? ` · session ${esc(ctx.session)}` : ""}</h2><small>${esc(shortDate(s.session_date))}</small></div><button class="icon-btn" data-wu="close" aria-label="Close">×</button></div><div class="wu-body"><div class="wu-length"><label>Session length<select data-wu-length>${lengths.map((m) => `<option value="${m}" ${m === ctx.length ? "selected" : ""}>${m} minutes</option>`).join("")}</select></label>${ctx.rate ? `<span class="muted-note">Workday pay $${esc(ctx.pay)} · override ${esc(ctx.override)}</span>` : ""}</div>${gaps.length ? `<div class="wu-gaps">${gaps.map((g) => `<div>${esc(g)}</div>`).join("")}</div>` : ""}${Wrapup.STEPS.map((step) => wrapupStepHTML(step, s, ctx)).join("")}</div><div class="modal-actions"><button class="secondary-btn" data-wu="client">Client profile</button><button class="primary-btn" data-wu="close">${n === Wrapup.STEPS.length ? "All done" : "Close"}</button></div>`;
}
function refreshWrapupViews() {
  if ($("#wrapUpDialog")?.open) renderWrapUp();
  renderDashboard();
  if (state.view === "client") renderClientProfile();
}
async function saveWrapupStep(sessionId, body) {
  const s = wrapupSession(sessionId);
  const saved = await getJSON(
    `/api/clients?resource=wrapup&id=${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, dayKey: todayKey }),
    },
  );
  Object.assign(s, saved);
  refreshWrapupViews();
}
async function wrapupChange(e) {
  const id = state.wrapupSession;
  if (!id) return;
  try {
    if (e.target.matches("[data-wu-step]"))
      await saveWrapupStep(id, {
        step: e.target.dataset.wuStep,
        done: e.target.checked,
      });
    else if (e.target.matches("[data-wu-length]"))
      await saveWrapupStep(id, { lengthMinutes: Number(e.target.value) });
  } catch (err) {
    toast(err.message || "Couldn't save that");
    renderWrapUp();
  }
}
async function wrapupClick(e) {
  const b = e.target.closest("[data-wu]");
  if (!b) return;
  const a = b.dataset.wu;
  if (a === "close") return $("#wrapUpDialog").close();
  if (a === "client") {
    const s = wrapupSession(state.wrapupSession);
    $("#wrapUpDialog").close();
    return openClientProfile(s.client_id);
  }
  if (a === "copy") {
    const pre = $(`[data-wu-text="${b.dataset.what}"]`);
    try {
      await navigator.clipboard.writeText(pre.textContent);
      toast("Copied. Paste it where it belongs, then tick the step.");
    } catch {
      getSelection().selectAllChildren(pre);
      toast("Press ⌘C to copy");
    }
  }
}

// ----- New package in the PT Session Logger -----
// Two pastes, because a formula column sits between the two groups of inputs.
function openLoggerRows(clientId) {
  const c = state.clients.find((x) => String(x.id) === String(clientId));
  if (!c) return toast("Couldn't find that client");
  state.wrapupSession = null;
  const set = state.wrapupSettings,
    day = c.package_start
      ? String(c.package_start).slice(0, 10)
      : c.first_session
        ? String(c.first_session).slice(0, 10)
        : todayKey,
    ctx = Wrapup.context({
      client: { ...c, package_start: c.package_start || day },
      session: { session_date: day },
      sessions: state.sessions,
      settings: set,
      trainer: state.settings.coach,
    }),
    missing = [
      !c.package_size && "package size",
      !c.package_price && "package price",
    ].filter(Boolean),
    block = (key, title, hint, columns) =>
      `<div class="wu-step"><div class="wu-check"></div><div class="wu-main"><strong>${esc(title)}</strong><small class="wu-hint">${esc(hint)}</small><pre class="wu-text" data-wu-text="${key}">${esc(Wrapup.rowText(columns, ctx))}</pre><div class="wu-actions"><button class="step-link" data-wu="copy" data-what="${key}">Copy</button></div></div></div>`;
  $("#wrapUpDialog").innerHTML = `<div class="modal-head"><div><span class="kicker">PT SESSION LOGGER · NEW PACKAGE</span><h2>${esc(c.name)}</h2><small>Add a row, then paste in two steps</small></div><button class="icon-btn" data-wu="close" aria-label="Close">×</button></div><div class="wu-body">${missing.length ? `<div class="wu-gaps">Add the ${esc(missing.join(" and "))} in Edit client so the row is complete.</div>` : ""}${block("newA", "1. Member Name → Original Date of Purchase", "Click the empty Member Name cell on a new row, then paste.", set.logger.newClientColumns)}${block("newB", "2. Total Sessions Purchased", "Click that cell (the column after the green Expiration Date), then paste.", set.logger.newClientSessionsColumns)}<p class="muted-note">The green columns (Expiration, Fee per Session, Unused) calculate themselves, so nothing is pasted over them.</p><div class="wu-actions"><a class="step-link" href="${attr(workAccountUrl(set.logger.url))}" target="_blank" rel="noopener noreferrer">Open the logger ↗</a></div></div><div class="modal-actions"><button class="primary-btn" data-wu="close">Done</button></div>`;
  const d = $("#wrapUpDialog");
  if (!d.open) d.showModal();
}

// ----- On the client's profile and the dashboard -----
function wrapupSectionHTML(c) {
  const info = Wrapup.packageInfo(c, state.sessions),
    todo = Wrapup.pending(
      state.sessions.filter((s) => String(s.client_id) === String(c.id)),
    ).slice(0, 5);
  if (c.service_type !== "Personal training" && !todo.length && !info.size)
    return "";
  const pkg = info.size
      ? `Package: ${info.used} of ${info.size} sessions used${info.left === 0 ? " · used up, set the next package" : info.left <= 2 ? ` · ${info.left} left` : ""}`
      : "No package set. Add the package size in Edit client so session numbers fill in.",
    rows = todo
      .map((s) => {
        const ctx = wrapupContext(s);
        return `<button class="log-row" data-profile="wrapup" data-session="${attr(s.id)}"><strong>${esc(shortDate(s.session_date))}</strong><span>Session ${esc(ctx.session || "—")} · ${Wrapup.stepsDone(s)} of ${Wrapup.STEPS.length} wrap-up steps</span><em>Finish</em></button>`;
      })
      .join("");
  return `<section class="wrapup-section"><div class="builder-label"><span>SESSION WRAP-UP</span></div><p class="muted-note">${esc(pkg)}</p>${rows || (info.size ? '<p class="muted-note">Every session is wrapped up.</p>' : "")}</section>`;
}
// Dashboard: sessions that still have wrap-up steps, newest first.
function renderWrapupQueue() {
  const links = $("#wrapupLinks"),
    set = state.wrapupSettings;
  if (links)
    links.innerHTML = `<span>SESSION PAPERWORK</span><a href="${attr(workAccountUrl(set.sf.url))}" target="_blank" rel="noopener noreferrer">San Francisco Working Doc ↗</a><a href="${attr(workAccountUrl(set.logger.url))}" target="_blank" rel="noopener noreferrer">PT Session Logger ↗</a><a href="${attr(set.workdayUrl)}" target="_blank" rel="noopener noreferrer">Workday ↗</a>`;
  const box = $("#wrapupQueue");
  if (!box) return;
  const todo = Wrapup.pending(state.sessions).slice(0, 6);
  box.hidden = !todo.length;
  box.innerHTML = todo.length
    ? `<div class="builder-label"><span>SESSIONS TO WRAP UP</span></div>${todo
        .map((s) => {
          const c = wrapupClient(s);
          return `<button class="onboard-row" data-wrapup="${attr(s.id)}"><span class="onboard-ring">${Wrapup.stepsDone(s)}/${Wrapup.STEPS.length}</span><span><strong>${esc(c?.name || "Client")}</strong><small>${esc(shortDate(s.session_date))} · ${esc(wrapupContext(s).session ? `session ${wrapupContext(s).session}` : "personal training")}</small></span><span aria-hidden="true">›</span></button>`;
        })
        .join("")}`
    : "";
}

// ----- Settings card -----
const COLUMN_SEP = " | ";
function renderWrapupSettings() {
  const box = $("#wrapupSettingsCard");
  if (!box) return;
  // While rates are being edited, show the unsaved draft, not the saved values.
  const set = state.wrapupDraft || state.wrapupSettings,
    cols = (list) => list.join(COLUMN_SEP);
  box.innerHTML = `<span class="kicker">AFTER EVERY SESSION</span><h2>Session wrap-up</h2><small>Used to build the rows and the Workday line. Saved for every device.</small><label>Workday task link<input data-ws="workdayUrl" value="${attr(set.workdayUrl)}"></label><label>Default session length (minutes)<input type="number" min="5" max="240" data-ws="defaultMinutes" value="${attr(set.defaultMinutes)}"></label><div class="ws-rates"><strong>Workday pay by session length</strong>${set.rates.map((r, i) => `<div class="ws-rate" data-rate="${i}"><label>Minutes<input type="number" data-rate-field="minutes" value="${attr(r.minutes)}"></label><label>Pay ($)<input type="number" step="0.01" data-rate-field="pay" value="${attr(r.pay ?? "")}"></label><label>Override rate<input type="number" step="0.01" data-rate-field="override" value="${attr(r.override ?? "")}"></label><button class="text-btn danger-text" data-ws-action="remove-rate" data-rate="${i}">Remove</button></div>`).join("")}<button class="text-btn" data-ws-action="add-rate">＋ Add a session length</button></div><label>San Francisco Working Doc link<input data-ws="sf.url" value="${attr(set.sf.url)}"></label><label>PT Session Logger link<input data-ws="logger.url" value="${attr(set.logger.url)}"></label><label>Logger, after each session (Total Used, Date of Last Session)<input data-ws="logger.columns" value="${attr(cols(set.logger.columns))}"></label><label>Logger, new package (Member Name to Date of Purchase)<input data-ws="logger.newClientColumns" value="${attr(cols(set.logger.newClientColumns))}"></label><label>Logger, new package (Total Sessions Purchased)<input data-ws="logger.newClientSessionsColumns" value="${attr(cols(set.logger.newClientSessionsColumns))}"></label><small>Separate columns with | and use ${Wrapup.TOKENS.map(([t]) => t).join(" ")}. Plain text works too.</small><div class="ws-actions"><button class="primary-btn" data-ws-action="save">Save wrap-up settings</button><span class="muted-note" id="wrapupSettingsState"></span></div>`;
}
function readWrapupSettings() {
  const box = $("#wrapupSettingsCard"),
    val = (k) => box.querySelector(`[data-ws="${k}"]`).value,
    cols = (k) => val(k).split("|").map((c) => c.trim()).filter(Boolean);
  return {
    workdayUrl: val("workdayUrl"),
    defaultMinutes: val("defaultMinutes"),
    rates: [...box.querySelectorAll("[data-rate]")]
      .filter((el) => el.matches(".ws-rate"))
      .map((el) => ({
        minutes: el.querySelector('[data-rate-field="minutes"]').value,
        pay: el.querySelector('[data-rate-field="pay"]').value,
        override: el.querySelector('[data-rate-field="override"]').value,
      })),
    sf: { url: val("sf.url") },
    logger: {
      url: val("logger.url"),
      columns: cols("logger.columns"),
      newClientColumns: cols("logger.newClientColumns"),
      newClientSessionsColumns: cols("logger.newClientSessionsColumns"),
    },
  };
}
async function wrapupSettingsClick(e) {
  const b = e.target.closest("[data-ws-action]");
  if (!b) return;
  const a = b.dataset.wsAction;
  if (a === "add-rate" || a === "remove-rate") {
    const next = readWrapupSettings();
    if (a === "add-rate") next.rates.push({ minutes: "", pay: "", override: "" });
    else next.rates.splice(Number(b.dataset.rate), 1);
    state.wrapupDraft = next;
    renderWrapupSettings();
    return;
  }
  if (a === "save") {
    const note = $("#wrapupSettingsState");
    try {
      const out = await getJSON("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "wrapup", value: readWrapupSettings() }),
      });
      state.wrapupDraft = null;
      state.wrapupSettings = Wrapup.cleanSettings(out.value);
      writeLocal("taskdash_wrapup_settings", state.wrapupSettings);
      renderWrapupSettings();
      $("#wrapupSettingsState").textContent = "Saved";
      toast("Wrap-up settings saved");
    } catch (err) {
      if (note) note.textContent = err.message || "Couldn't save";
    }
  }
}
