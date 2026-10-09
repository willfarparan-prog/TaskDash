const test = require("node:test");
const assert = require("node:assert/strict");
const Sops = require("../js/sops-core");
const { buildCatalog, cleanMessages, cleanAnswer } = require("../lib/hubChat");

const row = (id, tab, title, extra = {}) => ({
  id, tab, title, summary: `${title} summary`, when_text: "", keywords: "",
  links: [], body: { steps: ["Do the thing", { t: "Then", sub: ["a", "b"] }] }, ...extra,
});
const sops = [
  row("start", "daily", "Start of shift", { keywords: "open morning" }),
  row("fdt", "reporting", "Monthly FDT report", { body: { steps: ["Send the FDT spreadsheet"] } }),
  row("ev", "events", "Plan an event", { links: ["7"], body: { steps: ["Book the room"], app: [{ view: "events", label: "Open Events" }] } }),
].map(Sops.fromRow);

test("fromRow shapes a row and tolerates a bare body", () => {
  assert.equal(sops[0].steps.length, 2);
  assert.deepEqual(sops[0].steps[1], { t: "Then", sub: ["a", "b"] });
  const bare = Sops.fromRow({ id: "x", tab: "daily", title: "T", body: null });
  assert.deepEqual(bare.steps, []);
  assert.deepEqual(bare.links, []);
});

test("search needs every word and ranks title matches first", () => {
  assert.deepEqual(Sops.search(sops, "").length, 3);
  assert.equal(Sops.search(sops, "fdt report")[0].id, "fdt");
  assert.equal(Sops.search(sops, "spreadsheet")[0].id, "fdt"); // body match
  assert.equal(Sops.search(sops, "shift nonsense").length, 0);
});

test("countByTab counts every tab", () => {
  const c = Sops.countByTab(sops);
  assert.equal(c.daily, 1);
  assert.equal(c.hr, 0);
});

test("catalog lists SOPs and de-duplicated links", () => {
  const links = [
    { id: "7", title: "Event tracker", category: "tracking", description: "d", url: "https://a" },
    { id: "8", title: "Event tracker", category: "tracking", description: "d", url: "https://a" },
  ];
  const c = buildCatalog(sops, links);
  assert.ok(c.text.includes("[ev]") && c.text.includes("Open Events"));
  assert.equal(c.linkIds.size, 1);
  assert.ok(!c.text.includes("https://"));
});

test("answers keep only ids that exist and cap the lists", () => {
  const c = buildCatalog(sops, [{ id: "7", title: "L", category: "x", url: "u" }]);
  const out = cleanAnswer({ answer: " Try this. ", sop_ids: ["ev", "nope", "ev", "fdt"], link_ids: ["7", "99"] }, c);
  assert.deepEqual(out, { answer: "Try this.", sopIds: ["ev", "fdt"], linkIds: ["7"] });
});

test("messages are trimmed, role-mapped and end on the question", () => {
  assert.deepEqual(cleanMessages([]), []);
  const m = cleanMessages([
    { role: "bot", content: "hi" },
    { role: "user", content: "q1" },
    { role: "bot", content: "a1" },
    { role: "user", content: "x".repeat(900) },
  ]);
  assert.equal(m[0].role, "user");
  assert.equal(m.at(-1).content.length, 600);
  assert.deepEqual(cleanMessages([{ role: "user", content: "q" }, { role: "bot", content: "a" }]), []);
});
