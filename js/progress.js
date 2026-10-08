// Training progress and live-session helpers, shared by the browser
// (window.Progress) and the tests. Everything here is a pure function of a
// program's content and a client's workout logs.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Progress = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const finished = (w) => w.status === "finished";
  const nameKey = (name) => String(name || "").trim().toLowerCase();
  const loggedSet = (s) => !!(s && (s.done || s.weight || s.reps));

  // "135", "135 lb", "62.5kg" → a number; "BW" or blank → null.
  function weightOf(value) {
    const n = parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function repsOf(value) {
    const n = parseInt(String(value ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Day and week after the client's last finished session on a program
  // (logs are newest first). The weeks wrap day by day, then week by week.
  function nextDay(dayCount, weekCount, workouts, programId) {
    const days = Math.max(1, dayCount || 1),
      weeks = Math.max(1, weekCount || 1),
      last = workouts.find(
        (w) => finished(w) && String(w.program_id) === String(programId),
      );
    if (!last) return { day: 0, week: 0, complete: false };
    const day = (last.day_index + 1) % days;
    const week = day === 0 ? last.week_index + 1 : last.week_index;
    // Past the last week the program is complete; keep cycling its final week.
    if (week >= weeks) return { day: 0, week: weeks - 1, complete: true };
    return { day, week, complete: false };
  }

  // Days × weeks grid: how many sessions are finished (or still open) for each
  // program day and week, plus where the client is up to.
  function programProgress(program, workouts, content) {
    const days = content?.days || [],
      weeks = Number(program.weeks) || 4,
      logs = workouts.filter(
        (w) => String(w.program_id) === String(program.id),
      );
    const cells = days.map((day, d) =>
      Array.from({ length: weeks }, (_, wk) => {
        const here = logs.filter((w) => w.day_index === d && w.week_index === wk);
        return {
          finished: here.filter(finished).length,
          open: here.some((w) => !finished(w)),
        };
      }),
    );
    const done = cells.flat().filter((c) => c.finished).length,
      total = days.length * weeks,
      next = nextDay(days.length, weeks, workouts, program.id);
    return {
      days: days.map((d, i) => d.name || `Day ${i + 1}`),
      weeks,
      cells,
      done,
      total,
      next,
    };
  }

  // Every logged exercise, oldest session first: the heaviest set of each
  // session, the client's best, and whether the latest session was a new best.
  function exerciseHistory(workouts) {
    const byName = new Map();
    for (const w of [...workouts].filter(finished).reverse()) {
      for (const e of w.entries || []) {
        const sets = (e.sets || []).filter(loggedSet);
        if (!sets.length) continue;
        const weighted = sets
          .map((s) => ({ weight: weightOf(s.weight), reps: repsOf(s.reps) }))
          .filter((s) => s.weight != null);
        // The heaviest set; for bodyweight work, the set with the most reps.
        const top =
          weighted.sort(
            (a, b) => b.weight - a.weight || (b.reps || 0) - (a.reps || 0),
          )[0] ||
          sets
            .map((s) => ({ weight: null, reps: repsOf(s.reps) }))
            .sort((a, b) => (b.reps || 0) - (a.reps || 0))[0];
        const key = nameKey(e.name);
        if (!byName.has(key)) byName.set(key, { name: e.name, sessions: [] });
        byName.get(key).sessions.push({
          id: w.id,
          date: w.started_at,
          sets: sets.length,
          weight: top?.weight ?? null,
          reps: top?.reps ?? null,
        });
      }
    }
    return [...byName.values()]
      .map((h) => {
        const weights = h.sessions.map((s) => s.weight).filter((x) => x != null);
        const last = h.sessions.at(-1);
        const priorBest = Math.max(
          0,
          ...h.sessions.slice(0, -1).map((s) => s.weight || 0),
        );
        const best = weights.length ? Math.max(...weights) : null;
        return {
          ...h,
          last,
          best,
          trend: weights,
          // A PR needs an earlier session to beat.
          pr:
            h.sessions.length > 1 &&
            last.weight != null &&
            last.weight > priorBest,
        };
      })
      .sort((a, b) => b.sessions.length - a.sessions.length);
  }

  // Suggested weight for each set of an exercise, from the client's latest
  // earlier session that has numbers for it. Sets beyond what was logged
  // reuse the last set's weight. Returns [] with no history.
  function suggestWeights(name, workouts, setCount, excludeId) {
    const key = nameKey(name);
    for (const w of workouts) {
      if (excludeId != null && String(w.id) === String(excludeId)) continue;
      const e = (w.entries || []).find((x) => nameKey(x.name) === key);
      const weights = (e?.sets || []).filter(loggedSet).map((s) => s.weight);
      if (!weights.some((x) => weightOf(x) != null)) continue;
      return Array.from({ length: setCount }, (_, i) => {
        const w = weights[Math.min(i, weights.length - 1)];
        return weightOf(w) != null ? String(w).trim() : "";
      });
    }
    return [];
  }

  // Next unused entry key in a block: "A1", "A2" → "A3". With no block letter
  // (or a new one), takes the next free letter.
  function nextEntryKey(entries, letter) {
    const used = entries.map((e) => String(e.key || ""));
    const letters = [...new Set(used.map((k) => k.replace(/\d+$/, "")))];
    const block =
      letter && letters.includes(letter)
        ? letter
        : String.fromCharCode(
            65 + Math.max(0, ...letters.map((l) => (l.charCodeAt(0) || 64) - 64)),
          );
    const n = Math.max(
      0,
      ...used
        .filter((k) => k.replace(/\d+$/, "") === block)
        .map((k) => Number(k.slice(block.length)) || 0),
    );
    return `${block}${n + 1}`;
  }

  // Change a program's content to match a live-session edit, returning a new
  // object (the original is untouched) or null if the exercise isn't there.
  // edit: {type:"swap", key, from, name} | {type:"remove", key, from} |
  //       {type:"add", name, sets, reps, block}
  function applyLiveEdit(content, dayIndex, edit, weeks = 4) {
    const next = JSON.parse(JSON.stringify(content || { days: [] }));
    const day = next.days?.[dayIndex];
    if (!day) return null;
    day.blocks = day.blocks || [];
    if (edit.type === "add") {
      const target =
        day.blocks.find((b) => b.letter === edit.block) || day.blocks.at(-1);
      const exercise = {
        name: String(edit.name || "").trim(),
        sets: Math.max(1, Math.min(Number(edit.sets) || 3, 10)),
        reps: Array(weeks).fill(String(edit.reps || "").trim()),
        note: "",
      };
      if (!exercise.name) return null;
      if (target) target.exercises.push(exercise);
      else
        day.blocks.push({
          letter: "A",
          exercises: [exercise],
        });
      return next;
    }
    // Find the exercise by the name it had in the program (positions shift
    // when earlier exercises are removed), falling back to its A1/B2 key.
    let block = null,
      index = -1;
    if (edit.from) {
      const want = nameKey(edit.from);
      for (const b of day.blocks) {
        const i = b.exercises.findIndex((x) => nameKey(x.name) === want);
        if (i >= 0) {
          block = b;
          index = i;
          break;
        }
      }
    }
    if (!block) {
      const m = /^([A-Z])(\d+)$/.exec(String(edit.key || ""));
      block = m ? day.blocks.find((b) => b.letter === m[1]) : null;
      index = m ? Number(m[2]) - 1 : -1;
    }
    const exercise = block?.exercises[index];
    if (!exercise) return null;
    if (edit.type === "swap") {
      const name = String(edit.name || "").trim();
      if (!name) return null;
      exercise.name = name;
    } else if (edit.type === "remove") {
      block.exercises.splice(index, 1);
      if (!block.exercises.length)
        day.blocks.splice(day.blocks.indexOf(block), 1);
    } else return null;
    return next;
  }

  // Points for a small inline-SVG trend line.
  function sparkPoints(values, width = 72, height = 22) {
    const v = values.filter((x) => Number.isFinite(x));
    if (v.length < 2) return "";
    const lo = Math.min(...v),
      hi = Math.max(...v),
      span = hi - lo || 1;
    return v
      .map(
        (x, i) =>
          `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 2 - ((x - lo) / span) * (height - 4)).toFixed(1)}`,
      )
      .join(" ");
  }

  return {
    weightOf,
    nextDay,
    programProgress,
    exerciseHistory,
    suggestWeights,
    nextEntryKey,
    applyLiveEdit,
    sparkPoints,
  };
});
