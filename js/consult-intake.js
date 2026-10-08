// The personal-training consult form: William's 14 intake questions plus a few
// on experience and goals. Shared by the browser (window.ConsultIntake), the
// API and the tests. `section` groups the fields on screen; `prompt` is the
// label the answer is sent to Claude under.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ConsultIntake = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SECTIONS = [
    { key: "about", title: "About" },
    { key: "history", title: "History" },
    { key: "lifestyle", title: "Lifestyle" },
    { key: "training", title: "Training background" },
    { key: "goals", title: "Goals" },
    { key: "notes", title: "Coach notes" },
  ];
  const FIELDS = [
    { key: "name", section: "about", label: "Name", type: "text", prompt: "name" },
    { key: "dob", section: "about", label: "Date of birth", type: "date", prompt: "date_of_birth" },
    { key: "height", section: "about", label: "Height (inches)", type: "number", prompt: "height_inches" },
    { key: "weight", section: "about", label: "Weight (pounds)", type: "number", prompt: "weight_lbs" },
    {
      key: "sex",
      section: "about",
      label: "Sex (optional)",
      type: "select",
      options: ["Woman", "Man", "Prefer not to say"],
      prompt: "sex",
      note: "Only used to fill in the meal plan questionnaire.",
    },
    {
      key: "injuries",
      section: "history",
      label: "Have you ever been injured? (brief date and description)",
      type: "textarea",
      prompt: "injury_history",
    },
    {
      key: "gymInjuries",
      section: "history",
      label: "Have you ever been injured in the gym?",
      type: "textarea",
      prompt: "gym_injuries",
    },
    {
      key: "supplements",
      section: "history",
      label: "List any current supplements",
      type: "textarea",
      prompt: "supplements",
    },
    {
      key: "averageDay",
      section: "lifestyle",
      label:
        "Describe your average day during the week and weekend (include a brief average work schedule)",
      type: "textarea",
      prompt: "average_day",
      tall: true,
    },
    {
      key: "weightProgram",
      section: "training",
      label: "Describe your current weight training program",
      type: "textarea",
      prompt: "current_weight_training",
    },
    {
      key: "conditioning",
      section: "training",
      label: "Describe your current conditioning program (frequency and duration)",
      type: "textarea",
      prompt: "current_conditioning",
    },
    {
      key: "experience",
      section: "training",
      label: "How long have you been training?",
      type: "select",
      options: [
        "New to training",
        "Under 1 year",
        "1 to 3 years",
        "3 to 5 years",
        "5+ years",
      ],
      prompt: "training_experience",
    },
    {
      key: "barbell",
      section: "training",
      label: "How comfortable are you with barbell lifts (squat, deadlift, press)?",
      type: "select",
      options: [
        "Never done them",
        "Learning them",
        "Comfortable",
        "Very confident",
      ],
      prompt: "barbell_comfort",
    },
    {
      key: "workedBest",
      section: "training",
      label: "What do you feel has worked best in the past?",
      type: "textarea",
      prompt: "what_worked_best",
    },
    {
      key: "likeMost",
      section: "training",
      label: "What do you like most about training?",
      type: "textarea",
      prompt: "likes_about_training",
    },
    {
      key: "likeLeast",
      section: "training",
      label: "What do you least like about training?",
      type: "textarea",
      prompt: "dislikes_about_training",
    },
    {
      key: "avoid",
      section: "training",
      label: "Any movements or exercises you want to avoid?",
      type: "text",
      prompt: "movements_to_avoid",
    },
    {
      key: "goal",
      section: "goals",
      label: "What is your ultimate goal?",
      type: "textarea",
      prompt: "ultimate_goal",
      tall: true,
    },
    {
      key: "motivation",
      section: "goals",
      label: "What motivates you for this goal?",
      type: "textarea",
      prompt: "motivation",
    },
    {
      key: "targetDate",
      section: "goals",
      label: "Target date or event (if any)",
      type: "text",
      prompt: "target_date_or_event",
    },
    {
      key: "measurableGoal",
      section: "goals",
      label: "A measurable goal (e.g. lose 15 lb, squat 225, run a 10K)",
      type: "text",
      prompt: "measurable_goal",
    },
    {
      key: "successIn3",
      section: "goals",
      label: "What would success look like in 3 months?",
      type: "textarea",
      prompt: "success_in_three_months",
    },
    {
      key: "coachNotes",
      section: "notes",
      label: "Anything else to remember about this person?",
      type: "textarea",
      prompt: "coach_notes",
    },
  ];

  const LIMITS = { text: 300, textarea: 1500, number: 20000 };

  // Keeps only known answers, trimmed, with choices limited to their options.
  function cleanConsult(raw = {}) {
    const out = {};
    for (const f of FIELDS) {
      const value = raw[f.key];
      if (f.type === "select") {
        if (f.options.includes(String(value))) out[f.key] = String(value);
      } else if (f.type === "number") {
        const n = Number(value);
        if (value !== "" && value != null && Number.isFinite(n) && n > 0 && n < LIMITS.number)
          out[f.key] = n;
      } else if (f.type === "date") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) out[f.key] = String(value);
      } else {
        const text = String(value ?? "")
          .trim()
          .slice(0, f.type === "textarea" ? LIMITS.textarea : LIMITS.text);
        if (text) out[f.key] = text;
      }
    }
    return out;
  }

  // Whole years between a YYYY-MM-DD birth date and today.
  function ageFrom(dob, today = new Date()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ""));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    let age = today.getFullYear() - y;
    if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d))
      age -= 1;
    return age >= 0 && age < 120 ? age : null;
  }

  // Answers as labelled facts for the program prompt, in form order.
  function promptProfile(answers) {
    const profile = {};
    for (const f of FIELDS)
      if (answers[f.key] !== undefined && f.key !== "dob")
        profile[f.prompt] = answers[f.key];
    const age = ageFrom(answers.dob);
    if (age != null) profile.age = age;
    return profile;
  }

  // The nutrition questionnaire's answers that a consult already covers.
  function mealIntakeFrom(answers, trainingDays) {
    const out = {};
    const age = ageFrom(answers.dob);
    if (age != null) out.age = age;
    if (answers.height) out.height = answers.height;
    if (answers.weight) out.weight = answers.weight;
    if (answers.sex) out.sex = answers.sex;
    if (answers.averageDay) out.averageDay = answers.averageDay;
    if (Number.isInteger(trainingDays) && trainingDays >= 0 && trainingDays <= 7)
      out.trainingDays = String(trainingDays);
    return out;
  }

  return { SECTIONS, FIELDS, cleanConsult, ageFrom, promptProfile, mealIntakeFrom };
});
