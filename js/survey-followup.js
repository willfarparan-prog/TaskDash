// Post-event NPS survey cadence, shared by the browser (window.SurveyFollowup)
// and the tests. The survey goes out 1-3 days after the event. If under 30%
// of the people it was sent to have responded, it is resent 5-7 days after,
// and if still under 30%, a final time around two weeks after.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SurveyFollowup = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const RESEND_BELOW = 0.3;

  // Days after the event each send is due: [earliest, latest].
  const SENDS = [
    { key: "survey", window: [1, 3] },
    { key: "survey-2", window: [5, 7], after: "survey" },
    { key: "survey-3", window: [13, 15], after: "survey-2" },
  ];

  // Share of recipients who completed the survey, or null until both
  // numbers are logged.
  function responseRate(stats) {
    const sent = Number(stats?.sent);
    const responses = Number(stats?.responses);
    if (!Number.isFinite(sent) || sent <= 0) return null;
    if (stats?.responses === "" || stats?.responses == null) return null;
    if (!Number.isFinite(responses) || responses < 0) return null;
    return Math.min(1, responses / sent);
  }

  // Whether a resend is needed: "yes", "no", "unknown" (responses not
  // logged yet) or "waiting" (the previous send hasn't gone out).
  function resendNeeded(key, done, stats) {
    const send = SENDS.find((s) => s.key === key);
    if (!send?.after) return "yes";
    const rate = responseRate(stats);
    // Once 30%+ have responded, no further send is needed at any stage.
    if (rate != null && rate >= RESEND_BELOW) return "no";
    if (!done[send.after]) return "waiting";
    return rate == null ? "unknown" : "yes";
  }

  // daysSinceEvent: whole days from the event date to today (negative before).
  function sendState(key, done, stats, daysSinceEvent) {
    const send = SENDS.find((s) => s.key === key);
    if (!send) return null;
    if (done[key]) return { state: "done" };
    const need = resendNeeded(key, done, stats);
    if (need === "no") return { state: "skipped", rate: responseRate(stats) };
    const [from, to] = send.window;
    const timing =
      daysSinceEvent < from
        ? { state: "upcoming", inDays: from - daysSinceEvent }
        : daysSinceEvent <= to
          ? { state: "now" }
          : { state: "overdue" };
    if (need === "waiting") return { ...timing, state: "waiting" };
    if (need === "unknown" && timing.state !== "upcoming")
      return { ...timing, state: "log" };
    return timing;
  }

  return { RESEND_BELOW, SENDS, responseRate, resendNeeded, sendState };
});
