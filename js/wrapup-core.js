// What happens after a personal-training session: log it in the two Google
// Sheets, enter it in Workday, and collect the client's signature on the paper
// form. Shared by the browser (window.Wrapup), the API and the tests. Task
// Dash never writes to those systems; it builds the exact row or line and
// tracks which steps are done.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Wrapup = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const STEPS = [
    { key: "sf", title: "San Francisco Working Doc" },
    { key: "logger", title: "PT Session Logger" },
    { key: "workday", title: "Submit in Workday" },
    { key: "signed", title: "Client signed the paper form" },
  ];
  const TOKENS = [
    ["{date}", "session date (MM/DD/YYYY)"],
    ["{client}", "client name"],
    ["{lastFirst}", "Last, First"],
    ["{price}", "package price paid"],
    ["{start}", "package purchase date"],
    ["{email}", "client email"],
    ["{phone}", "client phone"],
    ["{n}", "session number (9)"],
    ["{total}", "package size (10)"],
    ["{session}", "9/10"],
    ["{length}", "session length in minutes (50)"],
    ["{pay}", "Workday pay for that length"],
    ["{override}", "override rate for that length"],
    ["{trainer}", "your name"],
  ];
  const DEFAULTS = {
    workdayUrl:
      "https://wd501.myworkday.com/exos/d/task/2997$4767.htmld?type=9882927d138b100019b928e75843018d",
    defaultMinutes: 50,
    // One row per session length; 50 min is the only rate known so far.
    rates: [{ minutes: 50, pay: 44.65, override: 18.9 }],
    // The Working Doc only needs a link (William types one number into it).
    sf: {
      url: "https://docs.google.com/spreadsheets/d/1Y-MhQ6pGTQxH8T-vFr18VHcQFC8rTL4qRUahda7Poss/edit?gid=955570286#gid=955570286",
    },
    // The Unredeemed Personal Training Session Log. Per session, only two
    // neighbouring cells change on the client's row: Total Used and Date of
    // Last Session Redeemed (the green columns are formulas).
    logger: {
      url: "https://docs.google.com/spreadsheets/d/1ndaoRKjFlKdJ4QO3CXoCbaJ0XCgncOQJGEVfWOcT4Xg/edit?gid=37481941#gid=37481941",
      columns: ["{n}", "{date}"],
      // A new package is two pastes, because a formula column sits between
      // them: Member Name → Date of Purchase, then Total Sessions Purchased.
      newClientColumns: ["{lastFirst}", "Valid", "{price}", "{start}"],
      newClientSessionsColumns: ["{total}"],
    },
  };

  const pad = (n) => String(n).padStart(2, "0");
  const money = (n) =>
    Number.isFinite(Number(n)) && n !== "" && n != null
      ? Number(n).toFixed(2)
      : null;
  const dateKey = (v) => String(v ?? "").slice(0, 10);
  const usDate = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey(v));
    return m ? `${pad(m[2])}/${pad(m[3])}/${m[1]}` : "";
  };
  const isPtSession = (s) => s.session_type === "Personal training";
  // "Derick Ngan" → "Ngan, Derick"; names already in that form are kept.
  function lastFirst(name) {
    const t = String(name ?? "").trim().replace(/\s+/g, " ");
    if (!t || t.includes(",")) return t;
    const parts = t.split(" ");
    return parts.length < 2
      ? t
      : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
  }

  // Personal-training sessions in the client's current package, oldest first.
  function packageSessions(client, sessions) {
    const start = dateKey(client?.package_start);
    return sessions
      .filter(
        (s) =>
          String(s.client_id) === String(client?.id) &&
          isPtSession(s) &&
          (!start || dateKey(s.session_date) >= start),
      )
      .sort(
        (a, b) =>
          dateKey(a.session_date).localeCompare(dateKey(b.session_date)) ||
          Number(a.id) - Number(b.id),
      );
  }
  // This session's number within the package (1-based), or null if it isn't one.
  function sessionNumber(client, sessions, session) {
    const i = packageSessions(client, sessions).findIndex(
      (s) => String(s.id) === String(session?.id),
    );
    return i < 0 ? null : i + 1;
  }
  function packageInfo(client, sessions) {
    const size = Number(client?.package_size) || null,
      used = packageSessions(client, sessions).length;
    return { size, used, left: size ? Math.max(0, size - used) : null };
  }

  function rateFor(rates, minutes) {
    return (
      (rates || []).find((r) => Number(r.minutes) === Number(minutes)) || null
    );
  }

  // Everything a row or line needs, for one session.
  function context({ client, session, sessions, settings, trainer }) {
    const s = { ...DEFAULTS, ...(settings || {}) },
      minutes =
        Number(session?.length_minutes) ||
        Number(client?.session_minutes) ||
        s.defaultMinutes,
      n = sessionNumber(client, sessions, session),
      total = Number(client?.package_size) || null,
      rate = rateFor(s.rates, minutes);
    return {
      date: usDate(session?.session_date),
      client: client?.name || "",
      lastFirst: lastFirst(client?.name),
      price: money(client?.package_price) ?? "",
      start: usDate(client?.package_start),
      email: client?.email || "",
      phone: client?.phone || "",
      n: n ?? "",
      total: total ?? "",
      session: n && total ? `${n}/${total}` : n ? String(n) : "",
      length: minutes,
      pay: money(rate?.pay) ?? "",
      override: money(rate?.override) ?? "",
      trainer: trainer || "",
      rate,
    };
  }

  // A tab-separated row for pasting into a sheet: each column is text with
  // {tokens} filled in from the context.
  function rowText(columns, ctx) {
    return (columns || [])
      .map((c) =>
        String(c).replace(/\{(\w+)\}/g, (_, k) =>
          k in ctx && k !== "rate" ? String(ctx[k]) : "",
        ),
      )
      .join("\t");
  }

  // The Workday entry, e.g.
  //   Derick Ngan: 10 sessions - 50min (9/10) - $44.65
  //
  //   Override Rate: 18.90
  function workdayText(ctx) {
    const count = ctx.total ? `${ctx.total} sessions` : "sessions",
      of = ctx.n && ctx.total ? ` (${ctx.n}/${ctx.total})` : "",
      pay = ctx.pay ? `$${ctx.pay}` : "$___";
    return `${ctx.client}: ${count} - ${ctx.length}min${of} - ${pay}\n\nOverride Rate: ${ctx.override || "___"}`;
  }

  // What can't be built yet, so the wrap-up can say what's missing.
  function gaps(ctx) {
    const out = [];
    if (!ctx.total)
      out.push("Set the client's package size so the session count fills in.");
    if (!ctx.rate)
      out.push(
        `No Workday rate is set for ${ctx.length}-minute sessions (Settings → Session wrap-up).`,
      );
    return out;
  }

  const stepsDone = (session) =>
    STEPS.filter((s) => session?.wrapup && session.wrapup[s.key]).length;
  const isWrapped = (session) => stepsDone(session) === STEPS.length;
  // Personal-training sessions that still have steps left, newest first.
  function pending(sessions) {
    return sessions
      .filter((s) => isPtSession(s) && !isWrapped(s))
      .sort(
        (a, b) =>
          dateKey(b.session_date).localeCompare(dateKey(a.session_date)) ||
          Number(b.id) - Number(a.id),
      );
  }

  // Keeps only known settings, limits sizes, and only allows https links.
  function cleanSettings(raw = {}) {
    const url = (v, fallback) => {
      const t = String(v ?? "").trim().slice(0, 1000);
      return /^https:\/\//i.test(t) ? t : fallback;
    };
    const cols = (v, fallback) => {
      const list = (Array.isArray(v) ? v : [])
        .map((c) => String(c ?? "").trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 20);
      return list.length ? list : fallback;
    };
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n < 100000
        ? Math.round(n * 100) / 100
        : null;
    };
    const rates = [];
    for (const r of Array.isArray(raw.rates) ? raw.rates : []) {
      const minutes = Number.parseInt(r?.minutes, 10);
      if (
        !Number.isInteger(minutes) ||
        minutes < 5 ||
        minutes > 240 ||
        rates.some((x) => x.minutes === minutes)
      )
        continue;
      rates.push({ minutes, pay: num(r.pay), override: num(r.override) });
    }
    const minutes = Number.parseInt(raw.defaultMinutes, 10);
    return {
      workdayUrl: url(raw.workdayUrl, DEFAULTS.workdayUrl),
      defaultMinutes:
        Number.isInteger(minutes) && minutes >= 5 && minutes <= 240
          ? minutes
          : DEFAULTS.defaultMinutes,
      rates: (rates.length ? rates : DEFAULTS.rates)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, 12),
      sf: { url: url(raw.sf?.url, DEFAULTS.sf.url) },
      logger: {
        url: url(raw.logger?.url, DEFAULTS.logger.url),
        columns: cols(raw.logger?.columns, DEFAULTS.logger.columns),
        newClientColumns: cols(
          raw.logger?.newClientColumns,
          DEFAULTS.logger.newClientColumns,
        ),
        newClientSessionsColumns: cols(
          raw.logger?.newClientSessionsColumns,
          DEFAULTS.logger.newClientSessionsColumns,
        ),
      },
    };
  }

  return {
    STEPS,
    TOKENS,
    DEFAULTS,
    usDate,
    packageSessions,
    sessionNumber,
    packageInfo,
    rateFor,
    lastFirst,
    context,
    rowText,
    workdayText,
    gaps,
    stepsDone,
    isWrapped,
    pending,
    cleanSettings,
  };
});
