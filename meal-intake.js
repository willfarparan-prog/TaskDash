// The meal plan questionnaire: the nutrition questions from the APEX Coach
// intake form, plus sex, age, height, weight, goal and training days. Shared
// by the browser (window.MealIntake), the API and the tests. `prompt` is the
// key the answer is sent under, matching the APEX meal plan generator.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MealIntake = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const OFTEN = ["Often", "Sometimes", "Rarely", "Never"];
  const FIELDS = [
    {
      key: "sex",
      label: "Sex",
      type: "select",
      options: ["Woman", "Man", "Prefer not to say"],
      prompt: "gender",
    },
    { key: "age", label: "Age", type: "number", prompt: "age" },
    {
      key: "height",
      label: "Height (in inches)",
      type: "number",
      prompt: "height_inches",
    },
    {
      key: "weight",
      label: "Current weight (lbs)",
      type: "number",
      prompt: "current_weight_lbs",
    },
    {
      key: "goals",
      label: "What are your fitness and nutrition goals? (up to 3)",
      type: "multi",
      options: [
        "Learn to Eat a Balanced Diet",
        "Decrease Body Fat",
        "Tone Muscles",
        "Learn to Balance Activity and Diet",
        "Reduce Stress",
        "Increase Strength and Power",
        "Create a Healthy Lifestyle",
        "Feel Better",
        "Improve Speed and Agility",
        "Improve Overall Health",
        "Increase Flexibility",
        "Improve Athletic Performance",
        "Maintain a Healthy Weight",
        "Increase Endurance",
      ],
      prompt: "fitness_goals",
    },
    {
      key: "goalDirection",
      label: "Body weight goal",
      type: "select",
      options: [
        "Lose fat (cut)",
        "Maintain",
        "Build muscle (bulk)",
        "Recomposition",
      ],
      prompt: "weight_goal",
    },
    {
      key: "trainingDays",
      label: "Training days per week",
      type: "select",
      options: ["0", "1", "2", "3", "4", "5", "6", "7"],
      prompt: "training_days_per_week",
    },
    {
      key: "averageDay",
      label:
        "Describe your average day during the week and weekend, including work, practices and activity.",
      type: "textarea",
      prompt: "average_day",
    },
    {
      key: "nutritionRating",
      label: "Rate your current nutrition (1–10)",
      type: "select",
      options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
      prompt: "nutrition_rating",
    },
    {
      key: "skipMeals",
      label: "Do you skip meals?",
      type: "select",
      options: ["Yes", "No", "Sometimes"],
      prompt: "skip_meals",
    },
    {
      key: "mealsPerDay",
      label: "How many times a day do you usually eat, including snacks?",
      type: "select",
      options: [
        "Once a day",
        "Twice a day",
        "Three meals a day",
        "More than three meals a day",
      ],
      prompt: "meals_per_day",
    },
    {
      key: "proteinSources",
      label: "Your top 3 favorite protein sources",
      type: "text",
      prompt: "protein_sources",
    },
    {
      key: "fatSources",
      label: "Your top 3 favorite fat sources",
      type: "text",
      prompt: "fat_sources",
    },
    {
      key: "carbSources",
      label: "Your top 3 favorite carb sources",
      type: "text",
      prompt: "carb_sources",
    },
    {
      key: "lateNight",
      label: "Do you eat late at night?",
      type: "select",
      options: OFTEN,
      prompt: "eats_late_at_night",
    },
    {
      key: "whileEating",
      label:
        "What activities do you engage in while eating? (TV, reading, etc.)",
      type: "text",
      prompt: "activities_while_eating",
    },
    {
      key: "pastFullness",
      label: "Do you eat past the point of fullness?",
      type: "select",
      options: OFTEN,
      prompt: "eats_past_fullness",
    },
    {
      key: "energyDrops",
      label: "Do you feel drops in your energy levels throughout the day?",
      type: "select",
      options: ["Yes", "No", "Sometimes"],
      prompt: "energy_drops",
    },
    {
      key: "energyDropsWhen",
      label: "When do your energy levels tend to drop?",
      type: "text",
      prompt: "energy_drops_when",
    },
    {
      key: "knowCalories",
      label: "Do you know how many calories you eat per day?",
      type: "select",
      options: ["Yes", "No", "It Varies"],
      prompt: "knows_calories",
    },
    {
      key: "caloriesPerDay",
      label: "Approximately how many calories per day?",
      type: "number",
      prompt: "calories_per_day",
    },
    {
      key: "ownCooking",
      label: "Do you do your own cooking?",
      type: "select",
      options: ["Yes", "No"],
      prompt: "own_cooking",
    },
    {
      key: "workMeals",
      label: "At work or school, do you usually:",
      type: "select",
      options: ["Eat Out", "Bring Packed Food", "An Equal Amount of Both"],
      prompt: "work_meals",
    },
    {
      key: "otherReasons",
      label: "Besides hunger, what other reasons do you eat?",
      type: "multi",
      options: [
        "Boredom",
        "Social Setting",
        "Stressed",
        "Tired",
        "Depressed",
        "Happy",
        "Nervous",
      ],
      prompt: "other_reasons_to_eat",
    },
    {
      key: "highFatSugar",
      label: "Do you eat foods high in fat and sugar?",
      type: "select",
      options: OFTEN,
      prompt: "high_fat_sugar",
    },
    {
      key: "improvement1",
      label: "Nutrition area to improve #1",
      type: "text",
      prompt: "nutrition_improvement_1",
    },
    {
      key: "improvement2",
      label: "Nutrition area to improve #2",
      type: "text",
      prompt: "nutrition_improvement_2",
    },
    {
      key: "improvement3",
      label: "Nutrition area to improve #3",
      type: "text",
      prompt: "nutrition_improvement_3",
    },
    {
      key: "wantNutritionHelp",
      label:
        "Would you like nutritional education or assistance from your coach?",
      type: "select",
      options: ["Yes", "No"],
      prompt: "wants_nutrition_help",
    },
    {
      key: "foodAllergies",
      label: "Do you have any food allergies?",
      type: "select",
      options: ["No", "Yes"],
      prompt: "food_allergies",
    },
    {
      key: "foodAllergiesList",
      label: "Please list your food allergies.",
      type: "text",
      prompt: "allergy_details",
    },
  ];

  // Keeps only known answers, trimmed, with choices limited to their options.
  function cleanIntake(raw = {}) {
    const out = {};
    for (const f of FIELDS) {
      const value = raw[f.key];
      if (f.type === "multi") {
        const list = (Array.isArray(value) ? value : [])
          .map(String)
          .filter((v) => f.options.includes(v));
        if (list.length) out[f.key] = list.slice(0, f.key === "goals" ? 3 : 7);
      } else if (f.type === "select") {
        if (f.options.includes(String(value))) out[f.key] = String(value);
      } else if (f.type === "number") {
        const n = Number(value);
        if (
          value !== "" &&
          value != null &&
          Number.isFinite(n) &&
          n > 0 &&
          n < 20000
        )
          out[f.key] = n;
      } else {
        const text = String(value ?? "")
          .trim()
          .slice(0, f.type === "textarea" ? 1500 : 300);
        if (text) out[f.key] = text;
      }
    }
    return out;
  }

  // The profile object the APEX generator expects, from cleaned answers.
  function promptProfile(intake, firstName) {
    const profile = { first_name: firstName || null };
    for (const f of FIELDS)
      if (intake[f.key] !== undefined) profile[f.prompt] = intake[f.key];
    return profile;
  }

  return { FIELDS, cleanIntake, promptProfile };
});
