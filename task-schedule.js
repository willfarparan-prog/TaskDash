// Recurring-task schedule rules, shared by the browser (window.TaskSchedule),
// the API and the tests. A task has one due date per cycle; it appears
// `leadDays` before that date, stays until it is checked off, and is then
// hidden until the next cycle. Completions are stored against the due date.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TaskSchedule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const CADENCES = ["Daily", "Weekdays", "Weekly", "Biweekly", "Monthly"];
  const CADENCE_LABELS = {
    Daily: "Every day",
    Weekdays: "Every weekday",
    Weekly: "Weekly",
    Biweekly: "Every 2 weeks",
    Monthly: "Monthly",
  };
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  // The recurring duties that used to be hard-coded in app.js. The API
  // copies them into recur_tasks once so they can be edited or deleted;
  // the ids are kept so past check-offs still match.
  const BUILTIN_TASKS = [
    {
      id: "wr-am",
      name: "Reset weight room — AM",
      cadence: "Weekdays",
      timeLabel: "AM",
    },
    {
      id: "inbox",
      name: "Check inboxes — Exos · Adobe · Wellness",
      cadence: "Weekdays",
      timeLabel: "Shift start",
    },
    {
      id: "wr-pm",
      name: "Reset weight room — PM",
      cadence: "Weekdays",
      timeLabel: "PM",
    },
    {
      id: "workday",
      name: "Log hours — Workday",
      cadence: "Weekdays",
      timeLabel: "EOD",
    },
    {
      id: "board",
      name: "Write workout on board",
      cadence: "Weekly",
      weekday: 1,
      timeLabel: "Mon",
    },
    {
      id: "lab",
      name: "Strength Lab programming",
      cadence: "Weekly",
      weekday: 5,
      leadDays: 2,
      timeLabel: "Wed–Fri",
    },
    {
      id: "glove",
      name: "White Glove Walkthrough",
      cadence: "Weekly",
      weekday: 5,
      leadDays: 1,
      timeLabel: "By 2:00p",
    },
    {
      id: "meeting",
      name: "Exos team meeting",
      cadence: "Weekly",
      weekday: 5,
      timeLabel: "Fri",
    },
    {
      id: "news",
      name: "Newsletter draft → Kelly",
      cadence: "Monthly",
      monthDay: 15,
      leadDays: 3,
      timeLabel: "By the 15th",
    },
    {
      id: "fdt",
      name: "FDT badge report",
      cadence: "Monthly",
      monthDay: 0,
      leadDays: 6,
      timeLabel: "Last week",
    },
    {
      id: "class",
      name: "Update class schedule",
      cadence: "Monthly",
      monthDay: 0,
      leadDays: 6,
      timeLabel: "End of month",
    },
  ];
  // How far back a missed cycle can still show as overdue.
  const CARRY_DAYS = { Weekly: 7, Biweekly: 14, Monthly: 31 };

  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseYmd = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const addDays = (d, n) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  // Whole days between two local dates, immune to daylight-saving shifts.
  const dayDiff = (a, b) =>
    Math.round(
      (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
        864e5,
    );
  const int = (v, min, max, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  // Accepts API rows (snake_case) or form/Claude values (camelCase).
  function normalizeSchedule(raw = {}) {
    const cadence = CADENCES.includes(raw.cadence) ? raw.cadence : "Daily";
    const weekly = cadence === "Weekly" || cadence === "Biweekly";
    const anchor = parseYmd(raw.anchorDate ?? raw.anchor_date);
    const weekdayValue = int(raw.weekday, 0, 6, null);
    return {
      cadence,
      // A biweekly task's start date fixes its weekday.
      weekday: weekly
        ? cadence === "Biweekly" && anchor
          ? anchor.getDay()
          : (weekdayValue ?? 1)
        : null,
      monthDay:
        cadence === "Monthly"
          ? int(raw.monthDay ?? raw.month_day, 0, 31, 1)
          : null,
      anchorDate: cadence === "Biweekly" && anchor ? ymd(anchor) : null,
      leadDays:
        cadence === "Daily" || cadence === "Weekdays"
          ? 0
          : int(raw.leadDays ?? raw.lead_days, 0, 14, 0),
      timeLabel: String(raw.timeLabel ?? raw.time_label ?? "")
        .trim()
        .slice(0, 40),
    };
  }

  function isDue(rule, d) {
    const r = normalizeSchedule(rule);
    const dow = d.getDay();
    if (r.cadence === "Daily") return true;
    if (r.cadence === "Weekdays") return dow > 0 && dow < 6;
    if (r.cadence === "Weekly") return dow === r.weekday;
    if (r.cadence === "Biweekly") {
      if (dow !== r.weekday) return false;
      const anchor = parseYmd(r.anchorDate);
      if (!anchor) return true;
      return Math.abs(dayDiff(anchor, d) / 7) % 2 === 0;
    }
    // Monthly: day 0 means the last day; days past the month's end clamp to it.
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const target = r.monthDay === 0 ? last : Math.min(r.monthDay, last);
    return d.getDate() === target;
  }

  function nextDue(rule, from) {
    for (let i = 0; i <= 62; i++) {
      const d = addDays(from, i);
      if (isDue(rule, d)) return d;
    }
    return null;
  }
  function previousDue(rule, before) {
    for (let i = 1; i <= 62; i++) {
      const d = addDays(before, -i);
      if (isDue(rule, d)) return d;
    }
    return null;
  }

  // A cycle counts as done if any check falls between its first visible day
  // and its due date (older checks were keyed by the day they were ticked).
  function doneFor(rule, due, checkKeys) {
    const r = normalizeSchedule(rule);
    const start = ymd(addDays(due, -r.leadDays)),
      end = ymd(due);
    return checkKeys.some((k) => k >= start && k <= end);
  }

  // The occurrence (if any) that belongs on today's list.
  // Returns { periodKey, due, overdue, done, daysUntil } or null.
  function occurrenceOn(rule, today, checkKeys = [], createdAt = null) {
    const r = normalizeSchedule(rule);
    const day = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const carry = CARRY_DAYS[r.cadence];
    const created = createdAt ? parseYmd(createdAt) : null;
    if (carry) {
      const prev = previousDue(r, day);
      if (
        prev &&
        dayDiff(prev, day) <= carry &&
        (!created || dayDiff(created, prev) >= 0) &&
        !doneFor(r, prev, checkKeys)
      )
        return {
          periodKey: ymd(prev),
          due: prev,
          overdue: true,
          done: false,
          daysUntil: dayDiff(day, prev),
        };
    }
    const next = nextDue(r, day);
    if (!next) return null;
    const daysUntil = dayDiff(day, next);
    if (daysUntil > r.leadDays) return null;
    return {
      periodKey: ymd(next),
      due: next,
      overdue: false,
      done: doneFor(r, next, checkKeys),
      daysUntil,
    };
  }

  function describe(rule) {
    const r = normalizeSchedule(rule);
    let text = CADENCE_LABELS[r.cadence];
    if (r.cadence === "Weekly" || r.cadence === "Biweekly")
      text += ` on ${DOW[r.weekday]}`;
    if (r.cadence === "Monthly")
      text +=
        r.monthDay === 0
          ? " on the last day"
          : ` on the ${ordinal(r.monthDay)}`;
    if (r.leadDays) text += ` · shows ${r.leadDays}d early`;
    return text;
  }
  function dueLabel(occ) {
    if (!occ) return "";
    if (occ.overdue)
      return `Overdue since ${DOW[occ.due.getDay()]} ${MONTHS[occ.due.getMonth()]} ${occ.due.getDate()}`;
    if (occ.daysUntil === 0) return "Due today";
    if (occ.daysUntil === 1) return "Due tomorrow";
    return `Due ${DOW[occ.due.getDay()]} ${MONTHS[occ.due.getMonth()]} ${occ.due.getDate()}`;
  }
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"],
      v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  return {
    BUILTIN_TASKS,
    CADENCES,
    CADENCE_LABELS,
    normalizeSchedule,
    isDue,
    nextDue,
    previousDue,
    occurrenceOn,
    describe,
    dueLabel,
    ordinal,
    ymd,
  };
});
