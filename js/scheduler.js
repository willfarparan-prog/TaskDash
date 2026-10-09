// Scheduler: public booking hours, the booking link and booked visits.
async function loadScheduler() {
  try {
    const publicData = await getJSON(
      "/api/calendar-manual?resource=availability",
    );
    state.scheduler.days = publicData.days || [];
    state.scheduler.paused = !!publicData.paused;
    state.scheduler.settings = {
      ...state.scheduler.settings,
      ...(publicData.settings || {}),
    };
    state.scheduler.workCalendar.connected = !!publicData.calendarConnected;
  } catch {
    state.scheduler.days = [];
  }
  try {
    const data = await getJSON("/api/calendar-manual?resource=scheduler");
    state.scheduler = {
      ...state.scheduler,
      ...data,
      days: state.scheduler.days,
      ownerReady: true,
    };
    state.scheduler.publicUrl = data.publicUrl || PUBLIC_BOOKING_URL;
  } catch {
    state.scheduler.ownerReady = false;
  }
}
function renderScheduler() {
  const scheduler = state.scheduler,
    s = scheduler.settings || DEFAULT_BOOKING_SCHEDULE,
    url = scheduler.publicUrl || PUBLIC_BOOKING_URL;
  $("#bookingUrl").textContent = url;
  $("#bookingUrl").href = url;
  $("#scheduleSlot").value = s.slotMinutes || 30;
  $("#scheduleDuration").value = s.sessionMinutes || 60;
  $("#scheduleNotice").value = String(s.noticeMinutes ?? 120);
  $("#scheduleAhead").value = s.bookAheadDays || 21;
  $("#scheduleLocation").value = s.location || "";
  $("#scheduleNote").value = s.note || "";
  $("#scheduleRequireCalendar").checked = s.requireCalendar !== false;
  const connected = !!scheduler.workCalendar?.connected;
  $("#workCalendarBanner strong").textContent = connected
    ? "Work Google Calendar connected"
    : "Connect Work Google Calendar";
  $("#workCalendarBanner span").textContent = connected
    ? `${scheduler.workCalendar.email || WORK_EMAIL} · busy times hidden automatically`
    : `Connect ${WORK_EMAIL} to hide busy times and create calendar events.`;
  $("#workCalendarConnect").textContent = connected
    ? "Connected"
    : "Connect work calendar";
  $("#workCalendarConnect").disabled = connected || !scheduler.ownerReady;
  const names = {
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  $("#scheduleHours").innerHTML = [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ]
    .map((day) => {
      const h = s.hours?.[day] || DEFAULT_BOOKING_SCHEDULE.hours[day];
      return `<div class="schedule-day ${h.enabled ? "" : "off"}" data-day="${day}"><label class="schedule-toggle"><input type="checkbox" data-hour="enabled" ${h.enabled ? "checked" : ""}><span>${names[day]}</span></label><div class="schedule-range"><input type="time" data-hour="start" value="${attr(h.start)}" ${h.enabled ? "" : "disabled"} aria-label="${names[day]} start"><span>to</span><input type="time" data-hour="end" value="${attr(h.end)}" ${h.enabled ? "" : "disabled"} aria-label="${names[day]} end"></div><em>${h.enabled ? "Available" : "Not available"}</em></div>`;
    })
    .join("");
  const openDays = (scheduler.days || [])
    .filter((day) => day.openCount > 0)
    .slice(0, 4);
  $("#schedulePreview").innerHTML = openDays.length
    ? openDays
        .map(
          (day) =>
            `<div class="preview-day"><div><strong>${esc(day.label)}</strong><small>${day.openCount} opening${day.openCount === 1 ? "" : "s"}</small></div><div class="preview-slots">${day.slots
              .filter((slot) => slot.open)
              .slice(0, 3)
              .map((slot) => `<span>${esc(slot.label)}</span>`)
              .join(
                "",
              )}${day.openCount > 3 ? `<em>+${day.openCount - 3}</em>` : ""}</div></div>`,
        )
        .join("")
    : '<div class="empty-state compact">No public openings in the current window.</div>';
  const bookings = (scheduler.bookings || []).filter(
    (b) =>
      b.status !== "cancelled" && new Date(b.starts_at) >= startOfDay(today),
  );
  $("#bookingList").innerHTML = bookings.length
    ? bookings
        .slice(0, 12)
        .map((b) => {
          const start = new Date(b.starts_at);
          return `<div class="booking-row" data-booking-id="${b.id}"><div><strong>${esc(b.visitor_name)}</strong><span>${esc(b.reason)} · ${start.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><small>${b.calendar_sync_status === "synced" ? "On work calendar" : b.calendar_sync_status === "error" ? "Calendar sync needs attention" : "Waiting for calendar connection"}</small></div>${/consult/i.test(b.reason || "") ? `<button class="secondary-btn" data-start-consult="${b.id}">Start consult</button>` : ""}${b.calendar_sync_status !== "synced" ? '<button class="secondary-btn" data-retry-booking>Retry sync</button>' : ""}<button class="row-delete" data-cancel-booking aria-label="Cancel ${attr(b.visitor_name)} booking">×</button></div>`;
        })
        .join("")
    : '<div class="empty-state compact">No upcoming bookings yet.</div>';
  $("#schedulerPin").classList.toggle("live", connected);
  $("#saveSchedule").disabled = !scheduler.ownerReady;
  $("#schedulerSaved").textContent = scheduler.ownerReady
    ? "Changes update the public booking page."
    : `Sign in as ${WORK_EMAIL} or ${OWNER_EMAIL} to edit availability.`;
}
function scheduleHoursChange(event) {
  const row = event.target.closest(".schedule-day");
  if (!row) return;
  const enabled = row.querySelector('[data-hour="enabled"]').checked;
  row.classList.toggle("off", !enabled);
  row
    .querySelectorAll("input[type=time]")
    .forEach((input) => (input.disabled = !enabled));
  row.querySelector("em").textContent = enabled ? "Available" : "Not available";
}
async function copyBookingLink() {
  const value = PUBLIC_BOOKING_URL;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  toast("Booking link copied — ready to paste in Slack");
}
async function saveSchedule() {
  const settings = {
    ...state.scheduler.settings,
    slotMinutes: Number($("#scheduleSlot").value),
    sessionMinutes: Number($("#scheduleDuration").value),
    noticeMinutes: Number($("#scheduleNotice").value),
    bookAheadDays: Number($("#scheduleAhead").value),
    location: $("#scheduleLocation").value.trim(),
    note: $("#scheduleNote").value.trim(),
    requireCalendar: $("#scheduleRequireCalendar").checked,
    hours: {},
  };
  $$(".schedule-day").forEach((row) => {
    settings.hours[row.dataset.day] = {
      enabled: row.querySelector('[data-hour="enabled"]').checked,
      start: row.querySelector('[data-hour="start"]').value,
      end: row.querySelector('[data-hour="end"]').value,
    };
  });
  const button = $("#saveSchedule");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const data = await getJSON("/api/calendar-manual?resource=schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "schedule", settings }),
    });
    state.scheduler.settings = data.settings;
    await loadScheduler();
    renderScheduler();
    $("#schedulerSaved").textContent = "Saved just now.";
    toast("Public availability updated");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = !state.scheduler.ownerReady;
    button.textContent = "Save availability";
  }
}
async function cancelBooking(event) {
  const button = event.target.closest("[data-cancel-booking]");
  if (!button) return;
  const row = button.closest("[data-booking-id]");
  if (!confirm("Cancel this booking and remove its work calendar event?"))
    return;
  try {
    const result = await getJSON(
      `/api/calendar-manual?resource=booking&id=${encodeURIComponent(row.dataset.bookingId)}`,
      { method: "DELETE" },
    );
    await loadScheduler();
    renderScheduler();
    toast(
      result.calendarRemoved === false
        ? "Booking cancelled, but its work calendar event could not be removed. Delete it in Google Calendar."
        : "Booking cancelled",
    );
  } catch (error) {
    toast(error.message);
  }
}

async function retryBookingSync(event) {
  const button = event.target.closest("[data-retry-booking]");
  if (!button) return;
  button.disabled = true;
  try {
    await getJSON("/api/calendar-manual?resource=sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: button.closest("[data-booking-id]").dataset.bookingId,
      }),
    });
    await loadScheduler();
    renderScheduler();
    renderFollowups();
    toast("Booking synced to your work calendar");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
