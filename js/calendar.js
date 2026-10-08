// Calendar: the week view and manual work blocks.
async function shiftCalendarWeek(step) {
  state.calendarOffset += step;
  renderCalendar();
  await loadCalendar();
  renderCalendar();
}
async function loadCalendar() {
  try {
    const d = await getJSON(
      `/api/calendar-week?start=${ymd(weekStart(state.calendarOffset))}`,
    );
    state.calendar = d.events || [];
    state.calendarConnected = !!d.connected;
    state.calendarEmail = d.accountEmail || null;
    state.workCalendarConnected = !!d.workConnected;
  } catch {
    state.calendar = [];
    state.calendarConnected = false;
    state.workCalendarConnected = false;
  }
}
function weekStart(offset = 0) {
  const d = new Date(today),
    day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function renderCalendar() {
  const start = weekStart(state.calendarOffset),
    end = new Date(start);
  end.setDate(end.getDate() + 6);
  $("#calendarRange").textContent =
    `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  $("#calendarBanner strong").textContent = state.calendarConnected
    ? "Google calendar connected"
    : "Connect Google calendar";
  $("#calendarBanner span").textContent = state.calendarConnected
    ? `${state.calendarEmail || OWNER_EMAIL} · read-only sync`
    : `Only ${OWNER_EMAIL} is allowed`;
  $("#calendarConnect").textContent = state.calendarConnected
    ? "Connected"
    : "Connect";
  $("#calendarConnect").disabled = state.calendarConnected;
  $("#workCalendarWeekBanner strong").textContent = state.workCalendarConnected
    ? "Work Google calendar connected"
    : "Connect work Google calendar";
  $("#workCalendarWeekBanner span").textContent = state.workCalendarConnected
    ? `${WORK_EMAIL} · events show in purple`
    : `Only ${WORK_EMAIL} is allowed`;
  $("#workCalendarWeekConnect").textContent = state.workCalendarConnected
    ? "Connected"
    : "Connect";
  $("#workCalendarWeekConnect").disabled = state.workCalendarConnected;
  let html = '<div class="cal-corner"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    html += `<div class="cal-day-head ${ymd(d) === todayKey ? "today" : ""}"><span>${DOW[d.getDay()]}</span><strong>${d.getDate()}</strong></div>`;
  }
  html += '<div class="time-axis">';
  for (let h = 6; h <= 18; h += 2)
    html += `<span style="top:${((h - 6) / 12) * 100}%">${h > 12 ? h - 12 : h}${h >= 12 ? "p" : "a"}</span>`;
  html += "</div>";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = ymd(d);
    html += `<div class="cal-day" data-date="${key}">${state.calendar
      .filter((e) => String(e.start).slice(0, 10) === key)
      .map(calendarEventHTML)
      .join("")}</div>`;
  }
  $("#weekCalendar").innerHTML = html;
}
function calendarEventHTML(e) {
  if (e.allDay)
    return `<div class="cal-event ${attr(e.source || "")}" style="top:4px;height:28px"><strong>${esc(e.title)}</strong></div>`;
  const s = new Date(e.start),
    en = new Date(e.end),
    top = Math.max(0, ((s.getHours() + s.getMinutes() / 60 - 6) / 12) * 100),
    height = Math.max(4, ((en - s) / 36e5 / 12) * 100);
  return `<div class="cal-event ${attr(e.source || "")}" style="top:${top}%;height:${height}%"><strong>${esc(e.title)}</strong>${fmtTime(s)}</div>`;
}
function openBlockDialog() {
  openDialog({
    kicker: "CALENDAR",
    title: "Add a work block",
    fields: [
      ["title", "Title", "text", "e.g. PT consult"],
      ["date", "Date", "date", todayKey],
      ["start", "Start", "time", "09:00"],
      ["end", "End", "time", "10:00"],
      ["source", "Source", "select", ["Adobe", "Exos", "Personal"]],
    ],
    submit: async (v) => {
      if (!v.title.trim()) throw new Error("Give the block a title");
      if (v.end <= v.start)
        throw new Error("End time must be after start time");
      await getJSON("/api/calendar-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: v.title,
          date: v.date,
          start: v.start,
          end: v.end,
          source: v.source.toLowerCase(),
        }),
      });
      await loadCalendar();
      renderCalendar();
      toast("Calendar block added");
    },
  });
}
