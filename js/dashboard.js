// Dashboard: the daily overview, task list layout, agenda, event preview,
// readiness and the new-client setup queue.
// Overdue first, then due, then open; finished tasks sink to the bottom.
const TASK_ORDER = { over: 0, due: 1, open: 2, done: 3 };
const byUrgency = (a, b) => TASK_ORDER[taskState(a)] - TASK_ORDER[taskState(b)];
// The time note is dropped when the task name already says it ("— AM").
const taskWhen = (t) =>
  t.time && !String(t.name).includes(t.time) ? t.time : t.time ? "" : t.cad;
function renderDashboard() {
  const visible = (
      state.settings.showCompleted
        ? state.tasks
        : state.tasks.filter((t) => !t.done)
    )
      .slice()
      .sort(byUrgency),
    done = state.tasks.filter((t) => t.done).length,
    remaining = state.tasks.length - done,
    overdue = state.tasks.filter(
      (t) => !t.done && taskState(t) === "over",
    ).length,
    sessionsToday = state.sessions.filter(
      (s) => String(s.session_date || "").slice(0, 10) === todayKey,
    ).length;
  $("#attentionCount").textContent = overdue || remaining;
  $("#attentionLabel").textContent = overdue
    ? overdue === remaining
      ? `${overdue} overdue`
      : `${overdue} overdue · ${remaining} open`
    : `${remaining} task${remaining === 1 ? "" : "s"} remaining`;
  $("#sessionCount").textContent = sessionsToday;
  $("#eventCount").textContent = state.events.length;
  $("#metricTasks").textContent = `${done} / ${state.tasks.length}`;
  $("#taskProgress").style.width =
    `${state.tasks.length ? (done / state.tasks.length) * 100 : 0}%`;
  $("#metricClients").textContent = state.clients.length;
  $("#metricPrograms").textContent = activeClientPrograms();
  const live = state.connections.filter((c) => c.status === "connected").length,
    readiness = state.connections.length
      ? Math.round((live / state.connections.length) * 100)
      : 0;
  $("#metricReadiness").textContent = `${live} active`;
  $("#readyProgress").style.width = `${readiness}%`;
  $("#todayTaskCount").textContent = `${remaining} open · ${done} done`;
  $("#taskList").innerHTML = visible.length
    ? visible.map(taskHTML).join("")
    : '<div class="empty-state compact">Nothing is due today.</div>';
  const next = state.tasks
      .filter((t) => !t.done)
      .sort(byUrgency)
      .slice(0, 3)
      .map((t) => {
        const when = taskWhen(t);
        return `<li><strong>${esc(t.name)}</strong>${when ? ` · ${esc(when)}` : ""}</li>`;
      })
      .join(""),
    nextEvent = state.events
      .map(normalizeEvent)
      .sort((a, b) => a.date - b.date)
      .find((e) => e.days >= 0);
  $("#dailyBrief").innerHTML =
    `<strong>${overdue ? "Start with the overdue work." : "Your operating queue is under control."}</strong><ul>${next || "<li>No open tasks on today’s list.</li>"}${nextEvent ? `<li><strong>${esc(nextEvent.name)}</strong> is ${nextEvent.days === 0 ? "today" : `in ${nextEvent.days} days`}.</li>` : ""}</ul>`;
  renderFollowups();
  renderOnboardingQueue();
  renderWrapupQueue();
  renderAgenda();
  renderEventPreview();
  renderReadiness();
  renderLinks();
}
function renderAgenda() {
  const events = (state.agenda || state.calendar)
    .map((e) => ({ ...e, date: new Date(e.start) }))
    .filter((e) => e.date >= startOfDay(today))
    .sort((a, b) => a.date - b.date)
    .slice(0, 5);
  $("#agendaList").innerHTML = events.length
    ? events
        .map(
          (e) =>
            `<div class="agenda-row"><div class="agenda-date"><strong>${e.date.getDate()}</strong><small>${DOW[e.date.getDay()]}</small></div><i class="agenda-line ${attr(e.source || "")}"></i><div class="agenda-body"><strong>${esc(e.title)}</strong><span>${e.allDay ? "All day" : fmtTime(e.date)} · ${esc(cap(e.source || "calendar"))}</span></div></div>`,
        )
        .join("")
    : '<div class="empty-state compact">No connected calendar items this week.</div>';
}
function renderEventPreview() {
  const list = state.events
    .map(normalizeEvent)
    .sort((a, b) => a.date - b.date)
    .slice(0, 4);
  $("#eventPreview").innerHTML = list.length
    ? list
        .map((e) => {
          const steps = eventSteps(e.raw),
            done = steps.filter((s) => s.done || s.skipped).length;
          return `<div class="preview-event"><header><strong>${esc(e.name)}</strong><span>${e.days >= 0 ? `${e.days}d out` : "past"}</span></header><div class="track"><i style="width:${steps.length ? (done / steps.length) * 100 : 0}%"></i></div><span>${done} of ${steps.length} SOP steps complete · ${fmtDate(e.date)}</span></div>`;
        })
        .join("")
    : '<div class="empty-state compact">No active events. Add a date and the SOP will build itself.</div>';
}
function renderReadiness() {
  const sample = state.connections.length
    ? state.connections.slice(0, 6)
    : fallbackConnections();
  $("#readinessList").innerHTML = sample
    .map(
      (c) =>
        `<div class="ready-row"><i class="ready-dot ${c.status === "connected" ? "live" : c.status === "attention" ? "attention" : ""}"></i><span>${esc(c.name)}</span><em>${esc(cap(c.status || "queued"))}</em></div>`,
    )
    .join("");
}
// Dashboard: clients whose checklist isn't finished, soonest first session first.
function renderOnboardingQueue() {
  const box = $("#onboardingQueue");
  if (!box) return;
  const open = state.clients
    .map((c) => ({ c, st: onboardingStatus(c) }))
    .filter((x) => x.st && x.st.done < x.st.total)
    .sort((a, b) =>
      String(a.c.first_session || "9999").localeCompare(
        String(b.c.first_session || "9999"),
      ),
    );
  box.hidden = !open.length;
  box.innerHTML = open.length
    ? `<div class="builder-label"><span>NEW CLIENTS · SETUP BEFORE FIRST SESSION</span></div>${open
        .map(
          ({ c, st }) =>
            `<button class="onboard-row" data-client="${attr(c.id)}"><span class="onboard-ring">${st.done}/${st.total}</span><span><strong>${esc(c.name)}</strong><small>Next: ${esc(st.next.title)} · ${esc(firstSessionLabel(c))}</small></span><span aria-hidden="true">›</span></button>`,
        )
        .join("")}`
    : "";
}

function getFollowups() {
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const endKey = ymd(nextWeek);
  return [
    ...state.tasks
      .filter((task) => !task.done && task.carried && task.carried < todayKey)
      .map((task) => ({
        type: "task",
        id: task.id,
        title: task.name,
        detail: `Overdue since ${shortDate(task.carried)}`,
        date: task.carried,
      })),
    ...state.clients
      .filter(
        (client) =>
          client.status !== "archived" &&
          client.next_follow_up &&
          String(client.next_follow_up).slice(0, 10) <= endKey,
      )
      .map((client) => ({
        type: "client",
        id: client.id,
        title: client.name,
        detail: `Client follow-up · ${shortDate(client.next_follow_up)}`,
        date: String(client.next_follow_up).slice(0, 10),
      })),
    ...state.events.flatMap((event) =>
      eventSteps(event)
        .filter(
          (step) => !step.done && !step.skipped && ymd(step.due) <= endKey,
        )
        .map((step) => ({
          type: "event",
          id: event.id,
          title: event.name,
          detail: `${step.name} · ${shortDate(ymd(step.due))}`,
          date: ymd(step.due),
        })),
    ),
    ...state.scheduler.bookings
      .filter(
        (booking) =>
          booking.status !== "cancelled" &&
          booking.calendar_sync_status !== "synced" &&
          new Date(booking.ends_at) >= startOfDay(today),
      )
      .map((booking) => ({
        type: "booking",
        id: booking.id,
        title: booking.visitor_name,
        detail: "Booking needs calendar sync",
        date: String(booking.starts_at).slice(0, 10),
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
function renderFollowups() {
  const items = getFollowups();
  $("#followupCount").textContent =
    `${items.length} action${items.length === 1 ? "" : "s"}`;
  $("#followupList").innerHTML = items.length
    ? items
        .slice(0, 20)
        .map(
          (item) =>
            `<button class="followup-row ${item.date < todayKey ? "overdue" : ""}" data-followup="${item.type}" data-record-id="${attr(item.id)}"><span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span><span aria-hidden="true">→</span></button>`,
        )
        .join("")
    : '<div class="empty-state compact">No follow-ups due in the next 7 days.</div>';
}
function openFollowup(event) {
  const row = event.target.closest("[data-followup]");
  if (!row) return;
  const id = row.dataset.recordId,
    type = row.dataset.followup;
  if (type === "client") return openClientProfile(id);
  go(
    type === "event"
      ? "events"
      : type === "booking"
        ? "scheduler"
        : "dashboard",
  );
  const target =
    type === "event"
      ? $(`.event-card[data-id="${CSS.escape(id)}"]`)
      : type === "booking"
        ? $(`.booking-row[data-booking-id="${CSS.escape(id)}"]`)
        : $(`.task-row[data-id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.classList.add("record-highlight");
  setTimeout(() => target?.classList.remove("record-highlight"), 2500);
}
