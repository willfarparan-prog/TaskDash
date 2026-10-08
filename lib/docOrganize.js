// Suggests how to file a doc: a clear title, category, short summary, tags
// and any action items with due dates. Claude Haiku reads the doc itself
// when it can (PDF or extracted text); otherwise it works from the title,
// link and note. The coach reviews every suggestion before it's saved.
const Anthropic = require("@anthropic-ai/sdk").default;

const MODEL = process.env.DOC_ORGANIZE_MODEL || "claude-haiku-4-5";

const CATEGORIES = [
  "Policies & HR",
  "SOPs & how-tos",
  "Events",
  "Classes & programming",
  "Reporting & tracking",
  "Schedules & staffing",
  "Training & certifications",
  "Communication & templates",
  "Meeting notes & updates",
  "Other",
];

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          due: { type: "string", description: "YYYY-MM-DD, or empty if no date" },
        },
        required: ["text", "due"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "category", "summary", "tags", "action_items"],
  additionalProperties: false,
};

const SYSTEM = `You file documents for an Exos performance coach working on-site at Adobe's San Francisco wellness centers. Most documents come from the coach's manager: policies, SOPs, event plans, reports, schedules, trainings, templates and meeting notes.

For each document return:
- title: a short, specific title (keep the document's own title if it is already clear; drop file extensions and words like "final" or "v2").
- category: the single best fit from the list.
- summary: two sentences at most, saying what it is and why it matters to the coach.
- tags: 2-5 short lowercase tags (people, programs, events, systems).
- action_items: only things the coach must actually do, each with a due date (YYYY-MM-DD) when the document states or clearly implies one, else "". Resolve relative dates against today's date. Return an empty list if there is nothing to do.
If you can only see a title or link, infer cautiously and keep the summary general.`;

function cleanSuggestion(raw = {}) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  return {
    title: String(raw.title || "").trim().slice(0, 200),
    category: CATEGORIES.includes(raw.category) ? raw.category : "Other",
    summary: String(raw.summary || "").trim().slice(0, 600),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((t) => String(t).trim().toLowerCase().slice(0, 40))
      .filter(Boolean)
      .slice(0, 6),
    action_items: (Array.isArray(raw.action_items) ? raw.action_items : [])
      .map((a) => ({
        text: String(a?.text || "").trim().slice(0, 240),
        due: isDate(a?.due) ? a.due : "",
      }))
      .filter((a) => a.text)
      .slice(0, 10),
  };
}

// doc: { title, fileName, url, note, from }; content: { pdf } | { text } | null
async function organizeDoc(doc, content, dayKey) {
  const client = new Anthropic();
  const facts = [
    `Today: ${dayKey}`,
    `Title as given: ${doc.title || "(none)"}`,
    doc.fileName ? `File name: ${doc.fileName}` : null,
    doc.url ? `Link: ${doc.url}` : null,
    `From: ${doc.from || "manager"}`,
    doc.note ? `Coach's note: ${doc.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const userContent = [];
  if (content?.pdf)
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: content.pdf },
    });
  userContent.push({
    type: "text",
    text: `${facts}${content?.text ? `\n\nDOCUMENT TEXT:\n${content.text}` : ""}\n\nFile this document.`,
  });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  if (response.stop_reason === "refusal")
    throw new Error("Claude couldn't read this doc.");
  const text = response.content.find((b) => b.type === "text")?.text || "{}";
  return {
    suggestion: cleanSuggestion(JSON.parse(text)),
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

module.exports = { CATEGORIES, organizeDoc, cleanSuggestion };
