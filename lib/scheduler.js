const TZ = 'America/Los_Angeles';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_SCHEDULE = {
  timezone: TZ,
  slotMinutes: 30,
  sessionMinutes: 60,
  noticeMinutes: 120,
  bookAheadDays: 21,
  location: 'Adobe SF Wellness Center',
  note: 'Choose a time that works for you. William will see your reason for visiting before the session.',
  reasons: ['Personal training session', 'PT consultation', 'InBody scan', 'Movement or fitness consultation', 'Other'],
  hours: {
    mon: { enabled: true, start: '09:00', end: '16:00' },
    tue: { enabled: true, start: '09:00', end: '16:00' },
    wed: { enabled: true, start: '09:00', end: '16:00' },
    thu: { enabled: true, start: '09:00', end: '16:00' },
    fri: { enabled: true, start: '09:00', end: '15:00' },
    sat: { enabled: false, start: '09:00', end: '12:00' },
    sun: { enabled: false, start: '09:00', end: '12:00' },
  },
  closures: [],
};

const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (key, amount) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return dateKey(d); };
const minutesOf = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const clock = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const clockLabel = value => { const minutes = typeof value === 'number' ? value : minutesOf(value); const hour = Math.floor(minutes / 60); return `${hour % 12 || 12}:${pad(minutes % 60)} ${hour >= 12 ? 'PM' : 'AM'}`; };

function pacificParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(value);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function pacificToday(now = new Date()) {
  const p = pacificParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function pacificInstant(date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(desired);
  for (let i = 0; i < 3; i += 1) {
    const p = pacificParts(guess);
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    guess = new Date(guess.getTime() + desired - represented);
  }
  return guess;
}

function dayKey(date) {
  const index = new Date(`${date}T12:00:00Z`).getUTCDay();
  return DAYS[index];
}

function dayLabel(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

function normalizeSchedule(raw = {}) {
  const schedule = { ...DEFAULT_SCHEDULE, ...raw, hours: { ...DEFAULT_SCHEDULE.hours, ...(raw.hours || {}) } };
  schedule.slotMinutes = Math.min(120, Math.max(15, Number(schedule.slotMinutes) || 30));
  schedule.sessionMinutes = Math.min(240, Math.max(15, Number(schedule.sessionMinutes) || 60));
  schedule.noticeMinutes = Math.min(10080, Math.max(0, Number(schedule.noticeMinutes) || 0));
  schedule.bookAheadDays = Math.min(90, Math.max(1, Number(schedule.bookAheadDays) || 21));
  schedule.reasons = Array.isArray(schedule.reasons) && schedule.reasons.length ? schedule.reasons.map(String).slice(0, 12) : DEFAULT_SCHEDULE.reasons;
  schedule.closures = Array.isArray(schedule.closures) ? schedule.closures.filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date || '')).slice(0, 100) : [];
  for (const day of DAYS) {
    const value = schedule.hours[day] || {};
    const start = /^([01]\d|2[0-3]):[0-5]\d$/.test(value.start || '') ? value.start : DEFAULT_SCHEDULE.hours[day].start;
    const end = /^([01]\d|2[0-3]):[0-5]\d$/.test(value.end || '') ? value.end : DEFAULT_SCHEDULE.hours[day].end;
    schedule.hours[day] = { enabled: Boolean(value.enabled && start < end), start, end };
  }
  return schedule;
}

function intervalsOverlap(start, end, busyStart, busyEnd) {
  return start < busyEnd && end > busyStart;
}

function buildAvailability(schedule, busy = [], now = new Date()) {
  const normalized = normalizeSchedule(schedule);
  const today = pacificToday(now);
  const closures = new Map(normalized.closures.map(c => [c.date, c.reason || 'Unavailable']));
  const days = [];
  for (let offset = 0; offset <= normalized.bookAheadDays; offset += 1) {
    const date = addDays(today, offset);
    const hours = normalized.hours[dayKey(date)];
    const closure = closures.get(date);
    if (!hours.enabled || closure) {
      days.push({ date, label: dayLabel(date), closed: true, closedReason: closure || 'Not available', slots: [], openCount: 0 });
      continue;
    }
    const slots = [];
    for (let minute = minutesOf(hours.start); minute + normalized.sessionMinutes <= minutesOf(hours.end); minute += normalized.slotMinutes) {
      const start = pacificInstant(date, clock(minute));
      const end = new Date(start.getTime() + normalized.sessionMinutes * 60000);
      const tooSoon = start.getTime() - now.getTime() < normalized.noticeMinutes * 60000;
      const conflict = busy.some(item => intervalsOverlap(start, end, new Date(item.start), new Date(item.end)));
      slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), label: clockLabel(minute), open: !tooSoon && !conflict, reason: tooSoon ? 'too soon' : conflict ? 'booked' : null });
    }
    days.push({ date, label: dayLabel(date), closed: false, slots, openCount: slots.filter(slot => slot.open).length });
  }
  return days;
}

function publicSettings(schedule) {
  const value = normalizeSchedule(schedule);
  return { timezone: value.timezone, sessionMinutes: value.sessionMinutes, bookAheadDays: value.bookAheadDays, location: value.location, note: value.note, reasons: value.reasons };
}

module.exports = { TZ, DAYS, DEFAULT_SCHEDULE, normalizeSchedule, buildAvailability, publicSettings, pacificToday, dayLabel, clockLabel };
