const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/event-report-core");

// What copying a Microsoft Forms results table out of Excel gives you.
const header = [
  "ID",
  "Start time",
  "Completion time",
  "Email",
  "Name",
  "How likely are you to recommend this event to a colleague? (0-10)",
  "What did you enjoy most?",
  "What could we improve?",
].join("\t");
const row = (id, score, enjoy = "", improve = "") =>
  [id, "10/6/26 11:00", "10/6/26 11:05", "pat@adobe.com", "Pat", score, enjoy, improve].join("\t");

test("tab-separated results: NPS counts, rate and comments", () => {
  const text = [
    header,
    row(1, 10, "The massage chairs", ""),
    row(2, 9, "", "More time slots"),
    row(3, 9),
    row(4, 8, "Loved it", ""),
    row(5, 7),
    row(6, 6, "", "Longer"),
    row(7, 3, "", "Too crowded"),
    row(8, 10),
  ].join("\n");
  const r = R.parseResults(text);
  assert.equal(r.responses, 8);
  assert.deepEqual([r.promoters, r.passives, r.detractors], [4, 2, 2]);
  assert.equal(r.nps, 25); // (4 - 2) / 8
  assert.deepEqual(r.comments, [
    "The massage chairs",
    "More time slots",
    "Loved it",
    "Longer",
    "Too crowded",
  ]);
  assert.match(r.scoreColumn, /recommend/);
});

test("names, emails and timestamps never leave the parser", () => {
  const r = R.parseResults([header, row(1, 10, "Great", "")].join("\n"));
  const all = JSON.stringify(r);
  assert.doesNotMatch(all, /pat@adobe/);
  assert.doesNotMatch(all, /"Pat"/);
  assert.doesNotMatch(all, /10\/6\/26/);
});

test("comma-separated files with quoted comments and line breaks", () => {
  const csv = [
    "Id,Name,Recommend (0-10),Comments",
    '1,Sam,10,"Great, truly"',
    '2,Alex,4,"Too loud',
    'and crowded"',
    "3,Jo,9,",
  ].join("\n");
  const r = R.parseResults(csv);
  assert.equal(r.responses, 3);
  assert.equal(r.nps, 33); // 2 promoters, 1 detractor of 3
  assert.deepEqual(r.comments, ["Great, truly", "Too loud\nand crowded"]);
});

test("a plain list of scores works, and IDs aren't mistaken for scores", () => {
  assert.equal(R.parseResults("10\n9\n8\n3").responses, 4);
  const withIds = ["ID\tHow likely to recommend", "1\t10", "2\t9", "3\t4"].join("\n");
  const r = R.parseResults(withIds);
  assert.equal(r.responses, 3);
  assert.equal(r.nps, 33);
});

test("results without a 0-10 question explain what to do", () => {
  assert.match(R.parseResults("").error, /Paste/);
  assert.match(R.parseResults("Name\tComment\nPat\tNice").error, /0-10/);
});

test("NPS rounds to a whole number and handles empty counts", () => {
  assert.equal(R.npsFrom({ promoters: 2, passives: 1, detractors: 0 }), 67);
  assert.equal(R.npsFrom({ promoters: 0, passives: 0, detractors: 3 }), -100);
  assert.equal(R.npsFrom({}), null);
});

test("the goal is met when attendance reaches the objective", () => {
  assert.equal(R.suggestGoal(30, 34), "met");
  assert.equal(R.suggestGoal(30, 30), "met");
  assert.equal(R.suggestGoal(30, 22), "not_met");
  assert.equal(R.suggestGoal(30, ""), null);
  assert.equal(R.suggestGoal(null, 22), null);
  assert.equal(R.suggestGoal(30, 0), "not_met");
});

test("the report text follows the sheet's layout", () => {
  const text = R.buildReportText({
    name: "Recovery Lab",
    dateLabel: "Nov 4, 2026",
    site: "SF",
    report: {
      strategy: { answer: "yes" },
      description: ["Hands-on mobility stations", " Percussion therapy "],
      takeaways: ["Attendees wanted longer sessions"],
      objective: 30,
      actual: 34,
      goal: "met",
      nps: { score: 62 },
    },
  });
  assert.equal(
    text,
    [
      "DID THIS MEET THE WELLBEING STRATEGY? YES",
      "SF",
      "PROGRAM 1 (Nov 4, 2026): Recovery Lab",
      "",
      "* Hands-on mobility stations",
      "* Percussion therapy",
      "",
      "Key Takeaways:",
      "* Attendees wanted longer sessions",
      "   * Objective: 30 Participants",
      "   * Outcome: Goal Met 34 Participants",
      "",
      "• NPS Score: 62",
    ].join("\n"),
  );
});

test("anything not known yet stays a visible blank", () => {
  const text = R.buildReportText({ name: "X", dateLabel: "Nov 4", site: "", report: {} });
  assert.match(text, /WELLBEING STRATEGY\? ___/);
  assert.match(text, /Objective: ___ Participants/);
  assert.match(text, /Outcome: Goal Met or Not Met\? ___ ___ Participants/);
  assert.match(text, /NPS Score: ___$/);
  const no = R.buildReportText({ report: { strategy: { answer: "no" }, goal: "not_met", actual: 12, objective: 20, nps: { score: -5 } } });
  assert.match(no, /\? NO/);
  assert.match(no, /Goal Not Met 12 Participants/);
  assert.match(no, /NPS Score: -5/);
});
