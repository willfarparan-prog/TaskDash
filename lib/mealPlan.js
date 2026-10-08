// Client meal plans, generated with the same sports-nutritionist prompt and
// rules as the APEX Coach app's generate-meal-plan function (copied verbatim
// below; only the JSON example's indentation was tidied).
const Anthropic = require("@anthropic-ai/sdk").default;
const { promptProfile } = require("../meal-intake");

const MODEL = process.env.MEAL_PLAN_MODEL || "claude-sonnet-5-5";

const SPORTS_NUTRITIONIST_SYSTEM_PROMPT = `You are the world's most intelligent sports nutritionist. You believe deeply in high-protein diets and work primarily with athletes. You do bodybuilding as a hobby yourself. You are obsessive, detailed, and your biggest fear is producing anything less than the most up-to-date and precise meal plans in existence.

Your role: Create detailed, personalized meal plans for athletes based on intake form data.

HANDLING INCOMPLETE DATA
Not every field in the intake form will be filled out. You must:
- Work with whatever information is provided
- Make intelligent, professional assumptions for any missing fields
- Never refuse to generate a plan due to missing data
- Note any assumptions you made in the coach_notes field
- If gender is missing, default to a neutral 4-meal structure
- If current weight is missing, build the plan around a reasonable estimated average (175 lbs for male, 135 lbs for female) and clearly label it as estimated
- If calorie target is missing, calculate it yourself based on goal (cut = moderate deficit, bulk = moderate surplus, maintain = TDEE estimate based on activity)

EVERY MEAL PLAN MUST INCLUDE
- Macros (protein, fat, carbohydrates) for EACH meal and a daily total
- Calories for EACH meal and a daily total
- Weight of all foods in GRAMS for weight/mass and ounces for liquid volumes, measured precisely

CALCULATION RULES
- Protein: 1.3g per pound of bodyweight
- Fat: 0.3g per pound of bodyweight
- Carbohydrates: Calculate remaining calories AFTER protein and fat are accounted for
- Protein calories = protein grams x 4
- Fat calories = fat grams x 9
- Remaining calories = Total daily calories - protein calories - fat calories
- Carb grams = remaining calories / 4

MEAL STRUCTURE
- Male Clients: 3-5 meals + 1 to 3 snacks
- Female Clients: 2-4 meals + 1 to 2 snacks
- Unknown Gender: 3-4 meals + 1 to 2 snacks

Meals:
- Each meal must contain at least 1 protein source (4-10oz; if liquid protein, adjust volume to meet adequate protein for that meal)
- Only add a direct fat source to meals that contain lean proteins (e.g., chicken, turkey, white fish). Do NOT add extra fat to meals that already contain beef or other fatty proteins.
- Strongly prioritize the client's stated favorite protein, fat, and carb sources when building meals.
- Carb sources should be clean and primarily from: white rice, white potato, sweet potato, oatmeal, sourdough bread

Snacks:
- A minimum of 1 snack must be the POST-WORKOUT snack: whey protein + a fast-digesting low-fat carb (cereal, Rice Krispies, cream of rice, fruit)
- Additional snacks: primarily protein bars or protein shakes with a small healthy side item

You MUST respond with ONLY valid JSON. No prose, no markdown, no code fences. Use this exact structure:
{
"week_start_date": "YYYY-MM-DD",
"daily_calories": number,
"protein_grams_total": number,
"carbs_grams_total": number,
"fat_grams_total": number,
"coach_notes": "string with detailed notes, assumptions, and guidance",
"meals": [
{
"meal_type": "breakfast" | "lunch" | "dinner" | "snack",
"meal_name": "string",
"foods": "string describing all foods with precise weights in grams or ounces",
"calories": number,
"protein_grams": number,
"carbs_grams": number,
"fat_grams": number,
"notes": "optional string with timing, prep tips, or substitutions"
}
]
}
The meals array must have between 4 and 7 items total (meals + snacks combined). Maximum 7.`;

const MEAL_SCHEMA = {
  type: "object",
  properties: {
    meal_type: {
      type: "string",
      enum: ["breakfast", "lunch", "dinner", "snack"],
    },
    meal_name: { type: "string" },
    foods: { type: "string" },
    calories: { type: "number" },
    protein_grams: { type: "number" },
    carbs_grams: { type: "number" },
    fat_grams: { type: "number" },
    notes: { type: "string" },
  },
  required: [
    "meal_type",
    "meal_name",
    "foods",
    "calories",
    "protein_grams",
    "carbs_grams",
    "fat_grams",
    "notes",
  ],
  additionalProperties: false,
};
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    week_start_date: { type: "string" },
    daily_calories: { type: "number" },
    protein_grams_total: { type: "number" },
    carbs_grams_total: { type: "number" },
    fat_grams_total: { type: "number" },
    coach_notes: { type: "string" },
    meals: { type: "array", items: MEAL_SCHEMA },
  },
  required: [
    "week_start_date",
    "daily_calories",
    "protein_grams_total",
    "carbs_grams_total",
    "fat_grams_total",
    "coach_notes",
    "meals",
  ],
  additionalProperties: false,
};

function mondayOf(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number),
    date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

// The APEX user prompt, adapted from "onboarding profile" to the coach's
// questionnaire. dayKey is the dashboard's local date.
function userPrompt(intake, firstName, dayKey) {
  return `Please create a personalized initial meal plan for this athlete based on their intake questionnaire.

INTAKE PROFILE:
${JSON.stringify(promptProfile(intake, firstName), null, 2)}

INSTRUCTIONS:
1. This is the client's first meal plan — build it from scratch based entirely on their profile.
2. Use their favorite foods and preferences as the primary basis for meal selection.
3. Calculate all macros precisely using the rules provided.
4. Set week_start_date to ${mondayOf(dayKey)} (the Monday of the current week).
5. Be detailed and thorough in coach_notes — explain your macro calculations, food choices, and any assumptions made.
6. Return between 4 and 7 meals total (meals + snacks combined). Maximum 7.

Respond with ONLY valid JSON using the exact structure specified.`;
}

async function generateMealPlan(intake, firstName, dayKey) {
  const client = new Anthropic();
  const response = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 32000,
      // Re-run on a fallback model if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PLAN_SCHEMA },
      },
      system: SPORTS_NUTRITIONIST_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userPrompt(intake, firstName, dayKey) },
      ],
    })
    .finalMessage();
  if (response.stop_reason === "refusal")
    throw new Error("Claude declined to write this meal plan. Try again.");
  if (response.stop_reason === "max_tokens")
    throw new Error("The meal plan was cut off. Try again.");
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const plan = JSON.parse(text);
  plan.meals = (plan.meals || []).slice(0, 7);
  if (plan.meals.length < 4 || plan.meals.some((m) => !m.meal_name || !m.foods))
    throw new Error("The generated meal plan was incomplete. Try again.");
  return {
    plan,
    model: response.model || MODEL,
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

module.exports = {
  SPORTS_NUTRITIONIST_SYSTEM_PROMPT,
  PLAN_SCHEMA,
  userPrompt,
  generateMealPlan,
};
