const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const event = {
  id: 7,
  name: "Recovery Lab",
  event_date: "2026-11-04",
  start_time: "11:30",
  end_time: "14:00",
  location: "Hooper Wellness Center",
  pillar: "Recovery",
  description: "Hands-on mobility and percussion therapy stations.",
  expected_attendance: 30,
  equipment: "1x Table, 2x Chairs",
  catering_needed: true,
  catering_budget: "Approximately $300",
  menu_ideas: "",
  event_link: null,
  needs_vendor: false,
};

// A stand-in for the Messages API that records what it was sent.
function mockClaude(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, () =>
      resolve({
        server,
        seen,
        url: `http://127.0.0.1:${server.address().port}`,
      }),
    ),
  );
}

function freshModule(baseUrl) {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = baseUrl;
  delete require.cache[require.resolve("../lib/eventDrafts")];
  return require("../lib/eventDrafts");
}

test("event facts state times, dates and missing values plainly", () => {
  const { eventFacts } = require("../lib/eventDrafts");
  const facts = eventFacts(event);
  assert.match(facts, /Date: Wednesday, November 4, 2026/);
  assert.match(facts, /Time: 11:30 AM - 2:00 PM/);
  assert.match(facts, /Catering budget: Approximately \$300/);
  assert.match(facts, /Menu ideas: none given/);
  assert.match(facts, /Registration \/ info link: none/);
  assert.match(eventFacts({ ...event, start_time: null }), /Time: not set/);
});

test("front-end draft list matches the server's draft types", () => {
  const { DRAFTS } = require("../lib/eventDrafts");
  const app = readFileSync(join(__dirname, "..", "js", "events.js"), "utf8");
  const block = app.slice(
    app.indexOf("const DRAFT_TYPES"),
    app.indexOf("];", app.indexOf("const DRAFT_TYPES")),
  );
  const uiKeys = [...block.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    uiKeys,
    DRAFTS.map((d) => d.key),
  );
  const uiSteps = [...block.matchAll(/step: "([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    uiSteps,
    DRAFTS.map((d) => d.step),
  );
});

test("catering draft only applies when catering is requested", () => {
  const { draftSpec } = require("../lib/eventDrafts");
  assert.equal(
    draftSpec("cateringEmail").needs({ catering_needed: false }),
    false,
  );
  assert.equal(
    draftSpec("cateringEmail").needs({ catering_needed: true }),
    true,
  );
  assert.equal(draftSpec("nope"), null);
});

test("generateDraft sends the event and returns only the text", async () => {
  const mock = await mockClaude({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: "Subject: Room request\n\nHi Sahar," },
    ],
    usage: { input_tokens: 1200, output_tokens: 80 },
  });
  try {
    const { generateDraft } = freshModule(mock.url);
    const result = await generateDraft(event, "roomEmail");
    assert.equal(result.text, "Subject: Room request\n\nHi Sahar,");
    assert.deepEqual(result.usage, { inputTokens: 1200, outputTokens: 80 });
    const sent = mock.seen[0];
    assert.match(sent.url, /\/v1\/messages/);
    assert.equal(sent.body.model, "claude-opus-5-5");
    assert.equal(sent.body.fallbacks, "default");
    assert.match(
      sent.headers["anthropic-beta"],
      /server-side-fallback-2026-07-01/,
    );
    assert.equal(sent.body.system[0].cache_control.type, "ephemeral");
    assert.match(sent.body.system[0].text, /Hi Sahar,/); // examples are the style guide
    assert.match(sent.body.messages[0].content, /Event name: Recovery Lab/);
    assert.match(sent.body.messages[0].content, /Sahar Rasheed/);
  } finally {
    mock.server.close();
  }
});

test("generateDraft reports a refusal instead of returning empty text", async () => {
  const mock = await mockClaude({
    id: "msg_2",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "refusal",
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 },
  });
  try {
    const { generateDraft } = freshModule(mock.url);
    await assert.rejects(generateDraft(event, "slack1"), /declined/);
  } finally {
    mock.server.close();
  }
});

test("2027 programming checklist steps only apply to events created after it started", () => {
  const vm = require("node:vm");
  const src = readFileSync(join(__dirname, "..", "js", "events.js"), "utf8");
  const head = src.slice(0, src.indexOf("// Messaging drafts generated"));
  const fn = src.slice(src.indexOf("function eventSteps"), src.indexOf("function surveyStats"));
  const ctx = {
    today: new Date(2027, 0, 4, 12),
    startOfDay: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    normalizeEvent: (raw) => ({ date: new Date(2027, 2, 1, 12), days: 56 }),
    SurveyFollowup: { sendState: () => ({ state: "waiting" }) },
    reportReady: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(`${head}\n${fn}\nthis.eventSteps = eventSteps; this.PIPE = PIPE;`, ctx);
  const keys = (raw) => ctx.eventSteps(raw).map((s) => s.key);
  const fresh = keys({ created_at: "2026-12-01T10:00:00Z", pipeline_state: {} });
  const old = keys({ created_at: "2026-10-20T10:00:00Z", pipeline_state: {} });
  for (const k of ["kickoff", "coco-pre", "prizes", "playbook", "inside-adobe", "surveys-build", "newsletter", "closeout"]) {
    assert.ok(fresh.includes(k), `new event has ${k}`);
    assert.ok(!old.includes(k), `old event skips ${k}`);
  }
  assert.ok(keys({ pipeline_state: {} }).includes("coco-pre"), "unsaved event shows the checklist");
  assert.ok(old.includes("room") && old.includes("survey"));
  const offsets = Array.from(ctx.PIPE, (s) => s.offset);
  assert.equal(offsets.join(), [...offsets].sort((a, b) => b - a).join(), "steps stay in date order");
  assert.equal(new Set(ctx.PIPE.map((s) => s.key)).size, ctx.PIPE.length);
});
