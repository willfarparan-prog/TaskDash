// Smart add: turns a plain-English task ("badge report every other Friday,
// show 3 days early") into a schedule with Claude Haiku. The result is only
// a suggestion; the dashboard shows it in the task form before saving.
const Anthropic = require("@anthropic-ai/sdk").default;
const { CADENCES, normalizeSchedule } = require("../task-schedule");

const MODEL = process.env.TASK_PARSE_MODEL || "claude-haiku-4-5";

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short task name, no schedule words" },
    repeat: { type: "string", enum: ["Once", ...CADENCES] },
    weekday: {
      type: "integer",
      description: "0=Sunday..6=Saturday, for Weekly or Biweekly",
    },
    monthDay: {
      type: "integer",
      description: "Day of month for Monthly, 1-31, or 0 for the last day",
    },
    anchorDate: {
      type: "string",
      description: "YYYY-MM-DD of the first due date, for Biweekly",
    },
    leadDays: {
      type: "integer",
      description: "Days before the due date the task should start showing",
    },
    timeLabel: {
      type: "string",
      description: 'Short timing note, e.g. "AM", "By 2:00p", or ""',
    },
  },
  required: [
    "name",
    "repeat",
    "weekday",
    "monthDay",
    "anchorDate",
    "leadDays",
    "timeLabel",
  ],
  additionalProperties: false,
};

const SYSTEM = `You turn one task a fitness coach typed into a schedule for their to-do dashboard.
- repeat: "Once" for a one-off task today; "Daily"; "Weekdays" (Mon-Fri); "Weekly"; "Biweekly" (every other week); "Monthly".
- "every other week" or "every 2 weeks" means Biweekly. Give anchorDate as the next matching date on or after today unless the user names a start date.
- "end of the month" or "last day" means Monthly with monthDay 0. "mid-month" means 15.
- leadDays is how early it should appear: "show 3 days early", "the week before" (6), "by Friday" for a weekly task means due Friday. Use 0 when nothing is said, except a Monthly task with no lead given gets 3.
- Fields that don't apply: weekday 1, monthDay 1, anchorDate "", leadDays 0, timeLabel "".
- name: keep the user's wording minus the schedule words.`;

// todayKey is the dashboard's local date (YYYY-MM-DD), not the server's UTC day.
async function parseTask(text, todayKey) {
  const [y, m, d] = todayKey.split("-").map(Number),
    weekdayName = new Date(y, m - 1, d).toLocaleDateString("en-US", {
      weekday: "long",
    });
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Today is ${weekdayName}, ${todayKey}.\nTask: ${text}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  if (response.stop_reason === "refusal")
    throw new Error("Claude couldn't read that task. Try rewording it.");
  const raw = JSON.parse(
    response.content.find((block) => block.type === "text")?.text || "{}",
  );
  const once = raw.repeat === "Once" || !CADENCES.includes(raw.repeat);
  return {
    task: {
      name: String(raw.name || text)
        .trim()
        .slice(0, 200),
      repeat: once ? "Once" : raw.repeat,
      ...(once ? {} : normalizeSchedule({ ...raw, cadence: raw.repeat })),
    },
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

module.exports = { parseTask, SCHEMA };
