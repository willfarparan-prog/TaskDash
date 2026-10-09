const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./helpers");
function frontend() {
  const nodes = new Map(),
    stored = new Map();
  const node = (s) => {
    if (!nodes.has(s))
      nodes.set(s, {
        hidden: false,
        value: "",
        disabled: false,
        innerHTML: "",
        textContent: "",
        querySelector: node,
        querySelectorAll: () => [],
        scrollIntoView() {},
        classList: { toggle() {}, add() {}, remove() {} },
      });
    return nodes.get(s);
  };
  const { context } = load(
    "js/core.js",
    {},
    {
      document: { querySelector: node, querySelectorAll: () => [] },
      TaskSchedule: require("../task-schedule"),
      location: { hostname: "task-dash-umber.vercel.app" },
      localStorage: {
        getItem: (k) => stored.get(k) || null,
        setItem: (k, v) => stored.set(k, v),
        removeItem: (k) => stored.delete(k),
      },
      setTimeout: () => 0,
      clearTimeout() {},
      fetch: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "Save failed" }),
      }),
    },
  );
  for (const file of ["tasks", "programs", "dashboard"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", file + ".js"), "utf8"),
      context,
    );
  vm.runInContext(
    "toast=(message)=>{globalThis.lastToast=message};renderDashboard=()=>{};renderPrograms=()=>{};",
    context,
  );
  return {
    node,
    stored,
    context,
    run: (code) => vm.runInContext(code, context),
  };
}
test("failed production task creation preserves input and does not invent a record", async () => {
  const f = frontend();
  f.node("#taskInput").value = "Call client";
  await f.run("addTask()");
  assert.equal(f.run("state.tasks.length"), 0);
  assert.equal(f.node("#taskInput").value, "Call client");
  assert.equal(f.context.lastToast, "Save failed");
});
test("failed production checkbox saves restore completion", async () => {
  const f = frontend();
  f.run('state.tasks=[{id:"1",kind:"daily",done:false}];');
  f.context.event = {
    target: { checked: true, closest: () => ({ dataset: { id: "1" } }) },
  };
  await f.run("toggleTask(event)");
  assert.equal(f.run("state.tasks[0].done"), false);
});
test("recovering a program draft retains metadata and the saved record", () => {
  const f = frontend();
  f.run(
    'state.authRequired=false;state.programs=[{id:1,name:"Saved",content:{days:[]}}];',
  );
  f.stored.set(
    "taskdash_draft_1",
    JSON.stringify({
      name: "Unsaved",
      goal: "Draft",
      content: { days: [] },
      updated_at: "2026-10-08T10:00:00Z",
    }),
  );
  f.run("openProgram(1)");
  assert.ok(f.node("#programEditor").innerHTML.includes("Unsaved"));
  assert.equal(f.run("state.programs[0].name"), "Saved");
  assert.equal(f.run("state.editorVersion"), "2026-10-08T10:00:00Z");
});
test("failed program saves keep a recoverable draft and unlock the editor", async () => {
  const f = frontend();
  f.run(
    'state.activeProgram="1";state.programs=[{id:1,name:"Saved"}];collectProgram=()=>({weeks:4,days:[{}]});programSnapshot=()=>({name:"Edited",content:{days:[]}});',
  );
  f.node('[data-meta="name"]').value = "Edited";
  await assert.rejects(() => f.run("saveProgram()"), /Save failed/);
  assert.ok(f.stored.has("taskdash_draft_1"));
  assert.equal(f.run("state.programs[0].name"), "Saved");
  assert.equal(f.node("#programEditor").inert, false);
});
