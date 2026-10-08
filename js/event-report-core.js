// Wellbeing Strategy report logic, shared by the browser (window.EventReport)
// and the tests. Reads pasted Microsoft Forms results, computes NPS, decides
// the goal suggestion and assembles the text for the report sheet. Every
// number on the sheet comes from here; Claude only writes the prose.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EventReport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_COMMENTS = 400;
  const MAX_COMMENT_LENGTH = 600;
  // Columns that identify people or carry timestamps; never read or kept.
  const SKIP_HEADER =
    /^(id|email|e-?mail address|name|full name|start time|completion time|last modified time|responder|respondent|responder'?s? ?(name|email))\b/i;
  const SCORE_HEADER = /recommend|likely|nps|score|rate/i;

  // Comma- or tab-separated text with quoted fields (a quoted cell may hold
  // line breaks, as Excel does when you copy a cell with a comment in it).
  function parseTable(text) {
    const src = String(text || "").replace(/\r\n?/g, "\n");
    const firstLine = src.split("\n").find((l) => l.trim()) || "";
    const delimiter = firstLine.includes("\t")
      ? "\t"
      : firstLine.includes(",")
        ? ","
        : firstLine.includes(";")
          ? ";"
          : "\t";
    const rows = [];
    let row = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === "") quoted = true;
      else if (ch === delimiter) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    row.push(cell);
    rows.push(row);
    return rows
      .map((r) => r.map((c) => c.trim()))
      .filter((r) => r.some((c) => c !== ""));
  }

  const isScore = (v) => /^(10|[0-9])$/.test(String(v).trim());
  const isNumber = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim());

  // NPS from the three counts: % promoters (9-10) minus % detractors (0-6).
  function npsFrom({ promoters = 0, passives = 0, detractors = 0 }) {
    const total = promoters + passives + detractors;
    if (!total) return null;
    return Math.round(((promoters - detractors) / total) * 100);
  }

  // Reads a pasted Forms results table. Returns {responses, promoters,
  // passives, detractors, nps, comments, scoreColumn} or {error}.
  function parseResults(text) {
    const rows = parseTable(text);
    if (!rows.length) return { error: "Paste the survey results first." };
    const width = Math.max(...rows.map((r) => r.length));
    // The first row is a header when it holds words, not just scores.
    const hasHeader =
      rows.length > 1 && rows[0].some((c) => c && !isNumber(c));
    const headers = hasHeader
      ? Array.from({ length: width }, (_, i) => rows[0][i] || "")
      : Array.from({ length: width }, () => "");
    const data = hasHeader ? rows.slice(1) : rows;
    const columns = Array.from({ length: width }, (_, i) => ({
      index: i,
      header: headers[i],
      values: data.map((r) => (r[i] || "").trim()).filter(Boolean),
      skipped: SKIP_HEADER.test(headers[i].trim()),
    })).filter((c) => !c.skipped);

    // The score column: mostly whole numbers 0-10, preferably headed like a
    // "how likely to recommend" question.
    const candidates = columns.filter(
      (c) =>
        c.values.length &&
        c.values.filter(isScore).length / c.values.length >= 0.8,
    );
    const column =
      candidates.find((c) => SCORE_HEADER.test(c.header)) || candidates[0];
    if (!column)
      return {
        error:
          "Couldn't find the 0-10 recommend question. Copy the results table from Excel with its header row and paste it here.",
      };

    const scores = column.values.filter(isScore).map(Number);
    const promoters = scores.filter((s) => s >= 9).length,
      detractors = scores.filter((s) => s <= 6).length,
      passives = scores.length - promoters - detractors;
    // Comments in respondent order (row by row), skipping the score column.
    const others = columns.filter((c) => c !== column).map((c) => c.index);
    const comments = data
      .flatMap((r) => others.map((i) => (r[i] || "").trim()))
      .filter((v) => v && !isNumber(v) && v.length > 1)
      .slice(0, MAX_COMMENTS)
      .map((v) => v.slice(0, MAX_COMMENT_LENGTH));
    return {
      responses: scores.length,
      promoters,
      passives,
      detractors,
      nps: npsFrom({ promoters, passives, detractors }),
      comments,
      scoreColumn: column.header || "Column " + (column.index + 1),
    };
  }

  // "met" when attendance reached the objective, else "not_met"; null until
  // both numbers are known.
  function suggestGoal(objective, actual) {
    const o = Number(objective),
      a = Number(actual);
    if (!(o > 0) || !Number.isFinite(a) || actual === "" || actual == null)
      return null;
    return a >= o ? "met" : "not_met";
  }

  const bullets = (items) =>
    (items || []).map((t) => `* ${String(t).trim()}`).filter((l) => l !== "* ");
  const count = (n) => (Number.isFinite(Number(n)) && n !== "" && n != null ? String(Number(n)) : "___");

  // The text for the report sheet, in its own layout.
  function buildReportText({ name, dateLabel, site, report }) {
    const r = report || {};
    const answer =
      r.strategy?.answer === "yes"
        ? "YES"
        : r.strategy?.answer === "no"
          ? "NO"
          : "___";
    const outcome =
      r.goal === "met"
        ? "Goal Met"
        : r.goal === "not_met"
          ? "Goal Not Met"
          : "Goal Met or Not Met? ___";
    const lines = [
      `DID THIS MEET THE WELLBEING STRATEGY? ${answer}`,
      String(site || "").toUpperCase() || "___",
      `PROGRAM 1 (${dateLabel || "___"}): ${name || ""}`.trim(),
      "",
      ...bullets(r.description),
      "",
      "Key Takeaways:",
      ...bullets(r.takeaways),
      `   * Objective: ${count(r.objective)} Participants`,
      `   * Outcome: ${outcome} ${count(r.actual)} Participants`,
      "",
      `• NPS Score: ${r.nps?.score == null ? "___" : r.nps.score}`,
    ];
    return lines.join("\n");
  }

  return {
    parseTable,
    parseResults,
    npsFrom,
    suggestGoal,
    buildReportText,
  };
});
