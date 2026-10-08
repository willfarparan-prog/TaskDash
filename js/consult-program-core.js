// Picks the stock templates that best fit a PT consult. Plain scoring on days
// per week, the client's goals and experience, no AI, so it is instant and
// predictable. Shared by the browser (window.ConsultProgram) and the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ConsultProgram = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Goal wording → the template emphasis it points at.
  const GOAL_WORDS = {
    Strength: /strong|strength|squat|deadlift|bench|powerlift|lift heav|max\b/,
    Hypertrophy: /muscle|size|bigger|tone|toned|physique|bulk|hypertroph|build|gain mass|aesthetic/,
    Power: /power|explosive|athlet|speed|jump|vertical|sprint|sport/,
    "Movement quality": /mobil|flexib|posture|rehab|stiff|move better|movement|pain|ache|balance|function/,
  };
  const GENERAL_WORDS = /lose|fat|weight loss|healthy|health|energy|feel better|fit\b|endurance|stamina/;
  const BEGINNER = ["New to training", "Under 1 year"];
  const NEW_TO_BARBELL = ["Never done them", "Learning them"];

  const text = (a) =>
    [a.goal, a.measurableGoal, a.successIn3, a.motivation, a.targetDate]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  // Which emphases the answers point at, strongest first, and why.
  function wantedEmphasis(answers) {
    const goalText = text(answers),
      hits = Object.entries(GOAL_WORDS)
        .map(([emphasis, re]) => ({
          emphasis,
          weight: (goalText.match(new RegExp(re.source, "g")) || []).length,
        }))
        .filter((h) => h.weight)
        .sort((a, b) => b.weight - a.weight);
    return { hits, general: GENERAL_WORDS.test(goalText) };
  }

  const isOutline = (p) =>
    /pattern template/i.test(p.name || "") ||
    /fill in exercises/i.test(p.goal || "");

  // Top matches among stock programs, each with a short reason.
  function rankStockPrograms(answers, programs, daysPerWeek, limit = 3) {
    const { hits, general } = wantedEmphasis(answers),
      beginner =
        BEGINNER.includes(answers.experience) ||
        NEW_TO_BARBELL.includes(answers.barbell),
      hurt = !!(answers.injuries || answers.gymInjuries || answers.avoid);
    const scored = programs
      .filter((p) => p.is_stock && !isOutline(p))
      .map((p) => {
        const reasons = [];
        let score = 0;
        const days = Number(p.days_per_week) || 0;
        if (daysPerWeek) {
          const gap = Math.abs(days - daysPerWeek);
          score += gap === 0 ? 50 : gap === 1 ? 22 : -10 * gap;
          if (gap === 0) reasons.push(`${days} days a week, as requested`);
          else if (gap === 1) reasons.push(`${days} days a week (close to ${daysPerWeek})`);
        }
        const hit = hits.findIndex((h) => h.emphasis === p.emphasis);
        if (hit >= 0) {
          score += 30 - hit * 10;
          reasons.push(`${p.emphasis.toLowerCase()} focus fits their goal`);
        } else if (general && ["Strength", "Movement quality"].includes(p.emphasis)) {
          score += 12;
          reasons.push(`${p.emphasis.toLowerCase()} base for a general fitness goal`);
        }
        if (beginner) {
          if (p.emphasis === "Movement quality" || p.emphasis === "Strength") {
            score += 10;
            reasons.push("good fit for newer lifters");
          }
          if (p.emphasis === "Power") score -= 12;
        }
        if (hurt && p.emphasis === "Movement quality") {
          score += 6;
          reasons.push("movement-quality emphasis suits their injury history");
        }
        return { program: p, score, reason: reasons.join("; ") || "closest available match" };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          String(a.program.name).localeCompare(String(b.program.name)),
      );
    return scored.slice(0, limit);
  }

  return { rankStockPrograms, wantedEmphasis, isOutline };
});
