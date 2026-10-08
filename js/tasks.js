// Tasks needed today: scheduled and one-off tasks, the task form, Smart
// add and the repeating-task manager.
async function loadTasks() {
  try {
    const data = await getJSON(`/api/tasks?day=${todayKey}`);
    state.recurTasks = data.recur || [];
    state.taskChecks = data.checks || [];
    state.tasks = [
      ...scheduledTasks(state.recurTasks, state.taskChecks),
      ...(data.daily || []).map((t) => ({
        id: String(t.id),
        name: t.name,
        // Unfinished one-off tasks from earlier days carry over.
        carried: t.day_key && t.day_key < todayKey ? t.day_key : null,
        cad:
          t.day_key && t.day_key < todayKey
            ? `Added ${shortDate(t.day_key)}`
            : "Today",
        time: "",
        done: !!t.done,
        kind: "daily",
      })),
    ];
  } catch {
    // Offline preview: show the built-in duties on their schedules.
    if (!state.recurTasks.length)
      state.recurTasks = TaskSchedule.BUILTIN_TASKS.map((t) => ({
        ...t,
        source: "builtin",
        created_day: todayKey,
      }));
    state.tasks = scheduledTasks(state.recurTasks, state.taskChecks);
  }
}
// Recurring tasks whose current cycle belongs on today's list.
function scheduledTasks(recur, checks) {
  return recur.flatMap((t) => {
    const keys = checks
        .filter((c) => c.task_id === t.id)
        .map((c) => c.period_key),
      occ = TaskSchedule.occurrenceOn(t, today, keys, t.created_day);
    if (!occ) return [];
    const rule = TaskSchedule.normalizeSchedule(t);
    return [
      {
        id: t.id,
        name: t.name,
        kind: "recur",
        done: occ.done,
        occ,
        rule,
        cad: TaskSchedule.CADENCE_LABELS[rule.cadence],
        time: rule.timeLabel,
      },
    ];
  });
}
function taskHTML(t) {
  const s = taskState(t),
    links = taskResourceLinks(t);
  return `<div class="task-row ${t.done ? "done" : ""}" data-id="${attr(t.id)}" data-kind="${t.kind}"><input class="task-check" type="checkbox" aria-label="Complete ${attr(t.name)}" ${t.done ? "checked" : ""}><div><div class="task-name">${esc(t.name)}</div><div class="task-meta">${esc(t.cad)}${t.time ? ` · ${esc(t.time)}` : ""}${t.occ && !["Daily", "Weekdays"].includes(t.rule.cadence) ? ` · ${esc(TaskSchedule.dueLabel(t.occ))}` : ""}${links.map((l) => ` <a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.short || l.title)} ↗</a>`).join("")}</div></div><span class="task-status ${s}">${t.done ? "DONE" : s === "over" ? "OVERDUE" : s === "due" ? "DUE" : "OPEN"}</span><span class="task-tools"><button class="row-edit" aria-label="Edit task" title="Edit">✎</button><button class="row-delete" aria-label="Delete task" title="Delete">×</button></span></div>`;
}
function taskResourceLinks(t) {
  const keys = {
    inbox: ["work-gmail", "adobe-outlook"],
    workday: ["workday"],
    lab: ["strength-lab"],
    fdt: ["badge-report-sop", "badge-report-claude"],
    class: ["signature-classes-site"],
  };
  return (keys[t.id] || [])
    .map((id) => state.links.find((l) => l.id === id))
    .filter(Boolean);
}
function taskState(t) {
  if (t.done) return "done";
  if (t.occ?.overdue || t.carried) return "over";
  if (t.occ && t.occ.daysUntil > 0) return "open";
  const h = today.getHours();
  if (
    (/AM|Shift/.test(t.time) && h >= 12) ||
    (/2:00/.test(t.time) && h >= 14) ||
    (/PM|EOD/.test(t.time) && h >= 17)
  )
    return "over";
  const everyDay = ["Daily", "Weekdays"].includes(t.rule?.cadence);
  return !everyDay || h >= 11 ? "due" : "open";
}
async function addTask() {
  const input = $("#taskInput"),
    name = input.value.trim();
  if (!name) return;
  input.value = "";
  try {
    await getJSON("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "daily_task", dayKey: todayKey, name }),
    });
    await loadTasks();
  } catch {
    state.tasks.push({
      id: `local-${Date.now()}`,
      name,
      cad: "Today",
      time: "",
      done: false,
      kind: "daily",
    });
  }
  renderDashboard();
  toast("Task added");
}
async function toggleTask(e) {
  const row = e.target.closest(".task-row");
  if (!row) return;
  const t = state.tasks.find((x) => String(x.id) === row.dataset.id);
  if (!t) return;
  t.done = e.target.checked;
  renderDashboard();
  const body =
    t.kind === "daily"
      ? { kind: "daily_task", id: t.id, done: t.done, dayKey: todayKey }
      : {
          kind: "recur_check",
          taskId: t.id,
          periodKey: t.occ.periodKey,
          windowStart: TaskSchedule.ymd(
            new Date(
              t.occ.due.getFullYear(),
              t.occ.due.getMonth(),
              t.occ.due.getDate() - t.rule.leadDays,
            ),
          ),
          done: t.done,
        };
  try {
    await getJSON("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    toast("Saved in this browser only");
  }
}
function taskRowAction(e) {
  const row = e.target.closest(".task-row");
  if (!row) return;
  if (e.target.closest(".row-edit")) {
    const t = state.tasks.find((x) => String(x.id) === row.dataset.id);
    if (t) openTaskDialog(taskDraft(t));
  }
  if (e.target.closest(".row-delete"))
    deleteTask(row.dataset.id, row.dataset.kind);
}
async function deleteTask(id, kind) {
  const recur = kind === "recur",
    name =
      (recur
        ? state.recurTasks.find((t) => t.id === id)
        : state.tasks.find((t) => String(t.id) === id)
      )?.name || "this task";
  if (
    recur &&
    !confirm(`Delete “${name}”? It won't come back on future cycles.`)
  )
    return;
  state.tasks = state.tasks.filter((t) => String(t.id) !== id);
  if (recur) state.recurTasks = state.recurTasks.filter((t) => t.id !== id);
  renderDashboard();
  try {
    await getJSON(
      `/api/tasks?id=${encodeURIComponent(id)}${recur ? "&kind=recur" : ""}`,
      { method: "DELETE" },
    );
  } catch {}
  toast("Task deleted");
}
// Form values for an existing task (dashboard row or recur_tasks record).
function taskDraft(t) {
  if (t.kind === "daily")
    return { id: t.id, kind: "daily", name: t.name, repeat: "Once" };
  const source = state.recurTasks.find((x) => x.id === t.id) || t,
    rule = TaskSchedule.normalizeSchedule(source);
  return {
    id: source.id,
    kind: "recur",
    name: source.name,
    repeat: rule.cadence,
    ...rule,
  };
}
const REPEAT_OPTIONS = [
  "Once|Just today",
  "Daily|Every day",
  "Weekdays|Every weekday (Mon–Fri)",
  "Weekly|Weekly",
  "Biweekly|Every 2 weeks",
  "Monthly|Monthly",
];
const WEEKDAY_OPTIONS = DOW.map((d, i) => `${i}|${d}`);
const MONTH_DAY_OPTIONS = [
  ...Array.from(
    { length: 31 },
    (_, i) => `${i + 1}|${TaskSchedule.ordinal(i + 1)}`,
  ),
  "0|Last day of the month",
];
const LEAD_OPTIONS = [
  "0|On the due date",
  "1|1 day early",
  "2|2 days early",
  "3|3 days early",
  "4|4 days early",
  "5|5 days early",
  "6|The week before",
  "13|2 weeks early",
];
// One form for adding or editing any task. `draft.kind` is "daily" or
// "recur" for an existing task, and absent for a new one.
function openTaskDialog(draft = {}) {
  const weekday = draft.weekday ?? today.getDay(),
    anchor =
      draft.anchorDate ||
      TaskSchedule.ymd(
        TaskSchedule.nextDue({ cadence: "Weekly", weekday }, today),
      );
  openDialog({
    kicker: draft.kind ? "EDIT TASK" : "NEW TASK",
    title: draft.kind ? "Change this task" : "Add a task",
    fields: [
      ["name", "Task", "text", "What needs doing?", draft.name || ""],
      [
        "repeat",
        "Repeats",
        "select",
        REPEAT_OPTIONS,
        optionFor(REPEAT_OPTIONS, draft.repeat || "Once"),
      ],
      [
        "weekday",
        "Day of the week",
        "select",
        WEEKDAY_OPTIONS,
        optionFor(WEEKDAY_OPTIONS, weekday),
      ],
      ["anchorDate", "First due date", "date", "", anchor],
      [
        "monthDay",
        "Day of the month",
        "select",
        MONTH_DAY_OPTIONS,
        optionFor(MONTH_DAY_OPTIONS, draft.monthDay ?? 1),
      ],
      [
        "leadDays",
        "Show it",
        "select",
        LEAD_OPTIONS,
        optionFor(LEAD_OPTIONS, draft.leadDays ?? 0),
      ],
      [
        "timeLabel",
        "Time note (optional)",
        "text",
        "AM, By 2:00p, EOD",
        draft.timeLabel || "",
      ],
    ],
    submit: (v) => saveTaskForm(draft, v),
  });
  // Only show the schedule fields that apply to the chosen repeat.
  const form = $("#dialogForm"),
    sync = () => {
      const r = optionValue(form.elements.repeat.value),
        show = {
          weekday: r === "Weekly",
          anchorDate: r === "Biweekly",
          monthDay: r === "Monthly",
          leadDays: ["Weekly", "Biweekly", "Monthly"].includes(r),
          timeLabel: r !== "Once",
        };
      for (const [name, visible] of Object.entries(show))
        form.elements[name].closest("label").hidden = !visible;
    };
  form.elements.repeat.onchange = sync;
  sync();
}
async function saveTaskForm(draft, form) {
  const v = {
      ...form,
      repeat: optionValue(form.repeat),
      weekday: optionValue(form.weekday),
      monthDay: optionValue(form.monthDay),
      leadDays: optionValue(form.leadDays),
    },
    name = v.name.trim();
  if (!name) throw new Error("Give the task a name");
  const json = (method, body) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const schedule = {
    name,
    cadence: v.repeat,
    weekday: v.weekday,
    monthDay: v.monthDay,
    anchorDate: v.anchorDate,
    leadDays: v.leadDays,
    timeLabel: v.timeLabel,
  };
  if (v.repeat === "Once") {
    if (draft.kind === "daily")
      await getJSON(
        "/api/tasks",
        json("PATCH", { kind: "daily_task", id: draft.id, name }),
      );
    else
      await getJSON(
        "/api/tasks",
        json("POST", { type: "daily_task", dayKey: todayKey, name }),
      );
  } else if (draft.kind === "recur") {
    await getJSON(
      "/api/tasks",
      json("PATCH", { kind: "recur_task", id: draft.id, ...schedule }),
    );
  } else {
    await getJSON(
      "/api/tasks",
      json("POST", { type: "recur_task", ...schedule }),
    );
  }
  // A task that switched between one-off and repeating leaves its old record.
  if (draft.kind === "daily" && v.repeat !== "Once")
    await getJSON(`/api/tasks?id=${encodeURIComponent(draft.id)}`, {
      method: "DELETE",
    });
  if (draft.kind === "recur" && v.repeat === "Once")
    await getJSON(`/api/tasks?id=${encodeURIComponent(draft.id)}&kind=recur`, {
      method: "DELETE",
    });
  await loadTasks();
  renderDashboard();
  toast(draft.kind ? "Task updated" : "Task added");
}
// Smart add: Claude reads the sentence and pre-fills the task form.
async function smartAddTask() {
  const input = $("#taskInput"),
    text = input.value.trim();
  if (!text) {
    openTaskDialog();
    return;
  }
  const btn = $("#taskSmart");
  btn.disabled = true;
  btn.textContent = "Reading…";
  let draft = { name: text };
  try {
    draft = await getJSON("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "parse_task", text, dayKey: todayKey }),
    });
  } catch (err) {
    toast(err.message || "Smart add is unavailable; fill in the schedule");
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Smart add";
  }
  input.value = "";
  openTaskDialog(draft);
}
// Every repeating task, including ones not due today.
function openTaskManager() {
  openDialog({
    kicker: "OPERATING QUEUE",
    title: "Repeating tasks",
    fields: [],
    submit: () => {},
  });
  $("#dialogFields").innerHTML = state.recurTasks.length
    ? `<div class="task-manager">${state.recurTasks
        .map(
          (t) =>
            `<div class="task-manager-row" data-id="${attr(t.id)}"><div><strong>${esc(t.name)}</strong><span>${esc(TaskSchedule.describe(t))}${t.time_label || t.timeLabel ? ` · ${esc(t.time_label || t.timeLabel)}` : ""}</span></div><button type="button" class="row-edit" aria-label="Edit ${attr(t.name)}">✎</button><button type="button" class="row-delete" aria-label="Delete ${attr(t.name)}">×</button></div>`,
        )
        .join(
          "",
        )}</div><button type="button" class="secondary-btn task-manager-add">＋ New task</button>`
    : '<div class="empty-state compact">No repeating tasks yet.</div><button type="button" class="secondary-btn task-manager-add">＋ New task</button>';
  $("#dialogSubmit").textContent = "Done";
  $("#dialogFields").onclick = async (e) => {
    const row = e.target.closest(".task-manager-row");
    if (e.target.closest(".task-manager-add")) {
      openTaskDialog({ repeat: "Weekly" });
      return;
    }
    if (!row) return;
    const t = state.recurTasks.find((x) => x.id === row.dataset.id);
    if (!t) return;
    if (e.target.closest(".row-edit"))
      openTaskDialog(taskDraft({ ...t, kind: "recur" }));
    if (e.target.closest(".row-delete")) {
      await deleteTask(t.id, "recur");
      openTaskManager();
    }
  };
}
