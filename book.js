const $ = (selector) => document.querySelector(selector);
const state = {
  days: [],
  settings: null,
  selectedDay: null,
  selectedSlot: null,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("#dayStrip").addEventListener("click", selectDay);
  $("#timeGrid").addEventListener("click", selectTime);
  $("#changeTime").onclick = changeTime;
  $("#bookAnother").onclick = () => location.reload();
  $("#bookingForm").onsubmit = submitBooking;
  await loadAvailability();
}

async function loadAvailability() {
  try {
    const response = await fetch("/api/calendar-manual?resource=availability", {
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Availability could not be loaded.");
    state.days = data.days || [];
    state.settings = data.settings || {};
    $("#bookingNote").textContent =
      state.settings.note || $("#bookingNote").textContent;
    $("#durationFact").textContent =
      `${state.settings.sessionMinutes || 60} min`;
    $("#locationFact").innerHTML =
      `<b>${esc(state.settings.location || "Location shared after booking")}</b>`;
    $("#reasonSelect").innerHTML = (
      state.settings.reasons || [
        "Personal training session",
        "PT consultation",
        "InBody scan",
        "Other",
      ]
    )
      .map(
        (reason) => `<option value="${attr(reason)}">${esc(reason)}</option>`,
      )
      .join("");
    renderDays();
    const first = state.days.find((day) => day.openCount > 0);
    if (first) {
      state.selectedDay = first.date;
      renderDays();
      renderTimes();
    } else renderNoAvailability();
  } catch (error) {
    $("#dayStrip").innerHTML =
      `<div class="empty">${esc(error.message)} Please try again shortly.</div>`;
    $("#timeGrid").innerHTML = "";
  }
}

function renderDays() {
  const visible = state.days.filter((day, index) => index < 14);
  $("#dayStrip").innerHTML = visible
    .map((day) => {
      const date = new Date(`${day.date}T12:00:00`),
        parts = new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).formatToParts(date),
        part = (type) =>
          parts.find((value) => value.type === type)?.value || "";
      return `<button class="day-button ${state.selectedDay === day.date ? "active" : ""}" data-date="${day.date}" ${day.openCount ? "" : "disabled"} aria-label="${attr(day.label)}, ${day.openCount} open times"><small>${part("weekday")}</small><strong>${part("day")}</strong><em>${day.openCount ? `${day.openCount} open` : day.closedReason || "Full"}</em></button>`;
    })
    .join("");
}

function selectDay(event) {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  state.selectedDay = button.dataset.date;
  state.selectedSlot = null;
  renderDays();
  renderTimes();
  $("#detailsCard").hidden = true;
}
function renderTimes() {
  const day = state.days.find((item) => item.date === state.selectedDay);
  if (!day) return;
  $("#timeTitle").textContent = day.label;
  $("#timeGrid").innerHTML = day.slots.length
    ? day.slots
        .map(
          (slot) =>
            `<button class="time-button ${state.selectedSlot?.startsAt === slot.startsAt ? "active" : ""}" data-start="${slot.startsAt}" ${slot.open ? "" : `disabled title="${attr(slot.reason || "Unavailable")}"`}>${esc(slot.label)}</button>`,
        )
        .join("")
    : '<div class="empty">No times are offered on this day.</div>';
}
function renderNoAvailability() {
  $("#timeTitle").textContent = "No openings right now";
  $("#timeGrid").innerHTML =
    '<div class="empty">William does not have any open times in the current booking window. Please check back soon.</div>';
}
function selectTime(event) {
  const button = event.target.closest("[data-start]");
  if (!button) return;
  const day = state.days.find((item) => item.date === state.selectedDay);
  state.selectedSlot = day?.slots.find(
    (slot) => slot.startsAt === button.dataset.start,
  );
  if (!state.selectedSlot) return;
  renderTimes();
  const start = new Date(state.selectedSlot.startsAt);
  $("#selectedTime").textContent = start.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  $("#detailsCard").hidden = false;
  $("#detailsCard").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("#bookingForm [name=name]").focus(), 350);
}
function changeTime() {
  $("#detailsCard").hidden = true;
  $("#bookingApp").scrollIntoView({ behavior: "smooth" });
}

async function submitBooking(event) {
  event.preventDefault();
  if (!state.selectedSlot) return;
  const form = new FormData(event.currentTarget),
    button = $("#bookButton");
  button.disabled = true;
  button.textContent = "Booking…";
  $("#formError").textContent = "";
  try {
    const response = await fetch("/api/calendar-manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource: "book",
        startsAt: state.selectedSlot.startsAt,
        name: form.get("name"),
        email: form.get("email"),
        reason: form.get("reason"),
        notes: form.get("notes"),
        website: form.get("website"),
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "This visit could not be booked.");
    showConfirmation(data.booking);
  } catch (error) {
    $("#formError").textContent = error.message;
    button.disabled = false;
    button.textContent = "Confirm booking";
    if (/no longer|just booked/i.test(error.message)) await loadAvailability();
  }
}
function showConfirmation(booking) {
  $("#bookingApp").hidden = true;
  $("#detailsCard").hidden = true;
  $("#confirmation").hidden = false;
  const start = new Date(booking.startsAt),
    when = start.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  $("#confirmationCopy").textContent =
    `${booking.name}, your ${booking.reason.toLowerCase()} is reserved.`;
  $("#confirmationDetails").innerHTML =
    `<strong>${esc(when)} PT</strong><span>${esc(booking.location || "Location shared by William")}</span><span>Confirmation ${esc(booking.code)}</span>`;
  $("#confirmation").scrollIntoView({ behavior: "smooth", block: "center" });
}
function esc(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
function attr(value = "") {
  return esc(value);
}
