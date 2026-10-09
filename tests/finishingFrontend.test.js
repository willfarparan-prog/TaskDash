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
      document: {
        querySelector: node,
        querySelectorAll: () => [],
        body: { classList: { remove() {} } },
      },
      CSS: { escape: String },
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
  for (const file of [
    "tasks",
    "programs",
    "dashboard",
    "consult",
    "live-session",
    "events",
    "event-report",
  ])
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

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
test("consult autosave drains newer edits before acknowledging saved", async () => {
  const f = frontend(),
    gate = deferred(),
    payloads = [];
  f.context.getJSON = async (_, opts) => {
    payloads.push(JSON.parse(opts.body));
    if (payloads.length === 1) await gate.promise;
    return {};
  };
  f.run('state.consult={id:1, answers:{name:"First"},unsaved:true};');
  const saved = f.run("saveConsult()");
  f.run('state.consult.answers.name="Latest";queueConsultSave();');
  const concurrent = f.run("saveConsult()");
  assert.equal(payloads.length, 1);
  gate.resolve();
  await Promise.all([saved, concurrent]);
  assert.deepEqual(
    payloads.map((p) => p.answers.name),
    ["First", "Latest"],
  );
  assert.equal(f.run("state.consult.unsaved"), false);
  assert.equal(
    JSON.parse(f.stored.get("taskdash_consult_1")).answers.name,
    "Latest",
  );
});
test("failed consult save retains dirty draft and blocks profile navigation", async () => {
  const f = frontend();
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  f.run(
    'state.consult={id:1,client_id:2,answers:{name:"Edited"}};openClientProfile=()=>{globalThis.navigated=true};',
  );
  f.context.click = {
    target: { closest: () => ({ dataset: { consult: "profile" } }) },
  };
  await f.run("consultClick(click)");
  assert.equal(f.context.navigated, undefined);
  assert.equal(f.run("state.consult.unsaved"), true);
  assert.ok(JSON.parse(f.stored.get("taskdash_consult_1")).unsaved);
});
function liveFixture(f) {
  f.run(
    'state.live={client:{id:1},program:{id:2,name:"Test"},entries:[],notes:"",dayIndex:0,weekIndex:0};normalizeProgramContent=()=>({days:[]});',
  );
}
test("overlapping session saves create one log and serialize latest edits", async () => {
  const f = frontend(),
    gate = deferred(),
    calls = [];
  liveFixture(f);
  f.context.getJSON = async (_, opts) => {
    calls.push({ method: opts.method, body: JSON.parse(opts.body) });
    if (opts.method === "POST") await gate.promise;
    return { id: 3, started_at: new Date().toISOString() };
  };
  const first = f.run("saveLiveSession()");
  f.run('state.live.notes="New note";queueLiveSave();');
  const second = f.run("saveLiveSession()");
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(calls.filter((x) => x.method === "POST").length, 1);
  assert.equal(calls.at(-1).body.notes, "New note");
  assert.equal(f.run("state.live.unsaved"), false);
});
test("failed session close stays open with a recoverable draft", async () => {
  const f = frontend();
  liveFixture(f);
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  f.context.click = {
    target: {
      closest: (s) =>
        s === "[data-live]"
          ? { dataset: { live: "close" }, closest: () => null }
          : null,
    },
  };
  await f.run("liveClick(click)");
  assert.ok(f.run("state.live"));
  assert.equal(JSON.parse(f.stored.get("taskdash_live_1")).unsaved, true);
});
test("failed session finish retains draft and unlocks session", async () => {
  const f = frontend();
  liveFixture(f);
  f.context.getJSON = async (_, opts) => {
    if (JSON.parse(opts.body).finish) throw Error("Finish failed");
    return { id: 3, started_at: new Date().toISOString() };
  };
  await assert.rejects(() => f.run("saveLiveSession(true)"), /Finish failed/);
  assert.equal(f.run("state.live.unsaved"), true);
  assert.equal(f.node("#liveSession").inert, false);
  assert.ok(f.stored.has("taskdash_live_1"));
});
test("report save failure retains edits across an event reload and retry clears recovery", async () => {
  const f = frontend();
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  f.run('state.events=[{id:5,report:{notes:"Keep this"}}];');
  assert.equal(await f.run("saveReport(state.events[0])"), false);
  f.context.getJSON = async () => ({
    events: [{ id: 5, report: { notes: "Old" } }],
  });
  await f.run("loadEvents()");
  assert.equal(f.run("state.events[0].report.notes"), "Keep this");
  assert.equal(await f.run("saveReport(state.events[0])"), true);
  assert.equal(f.stored.has("taskdash_report_5"), false);
});
test("failed live reads keep existing tasks without inventing built-in records", async () => {
  const f = frontend();
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  f.run('state.tasks=[{id:"actual",name:"Real task"}];');
  await f.run("loadTasks()");
  assert.equal(f.run("state.tasks[0].id"), "actual");
  assert.equal(f.run("state.recurTasks.length"), 0);
});
test("storage exhaustion never claims the device copy was saved", async () => {
  const f = frontend();
  f.context.localStorage.setItem = () => {
    throw Error("Full");
  };
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  f.run('state.consult={id:1,answers:{name:"Keep open"}};');
  await assert.rejects(() => f.run("saveConsult()"), /Offline/);
  assert.match(f.node("#consultSaveState").textContent, /keep this page open/);
});

test("lost session-create responses retry with the same request ID", async () => {
  const f = frontend(),
    keys = [];
  liveFixture(f);
  f.run('state.live.requestKey="12345678-1234-1234-1234-123456789abc";');
  f.context.getJSON = async (_, opts) => {
    if (opts.method === "POST") {
      keys.push(JSON.parse(opts.body).requestKey);
      if (keys.length === 1) throw Error("Response lost");
    }
    return { id: 3, started_at: new Date().toISOString() };
  };
  await assert.rejects(() => f.run("saveLiveSession()"), /Response lost/);
  assert.equal(JSON.parse(f.stored.get("taskdash_live_1")).requestKey, keys[0]);
  await f.run("saveLiveSession()");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});
test("draft text is preserved after failure, reload, and successful retry", async () => {
  const f = frontend();
  f.run(
    'state.events=[{id:5,drafts:{roomEmail:{text:"My edits",edited:true}}}];',
  );
  f.context.getJSON = async () => {
    throw Error("Offline");
  };
  assert.equal(
    await f.run('saveEventDraft(state.events[0],"roomEmail")'),
    false,
  );
  f.context.getJSON = async () => ({
    events: [{ id: 5, drafts: { roomEmail: { text: "Old server text" } } }],
  });
  await f.run("loadEvents()");
  assert.equal(
    f.run("eventDrafts(state.events[0]).roomEmail.text"),
    "My edits",
  );
  assert.equal(
    await f.run('saveEventDraft(state.events[0],"roomEmail")'),
    true,
  );
  assert.equal(f.stored.has("taskdash_eventdraft_5_roomEmail"), false);
});
test("a read outage warning clears after a successful refresh", async () => {
  const f = frontend();
  f.context.fetch = async () => {
    throw Error("Offline");
  };
  // Keep this test deterministic while exercising the real GET retry path.
  f.context.setTimeout = (fn) => {
    fn();
    return 0;
  };
  await assert.rejects(() => f.run('getJSON("/api/clients")'), /Offline/);
  assert.equal(f.node("#dataStatus").hidden, false);
  assert.match(f.node("#dataStatus").textContent, /clients/);
  f.context.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ clients: [] }),
  });
  await f.run('getJSON("/api/clients")');
  assert.equal(f.node("#dataStatus").hidden, true);
});

test("failed production program deletion keeps the program and editor", async () => {
  const f = frontend();
  f.context.confirmAction = async () => true;
  f.context.getJSON = async () => {
    throw Error("Delete failed");
  };
  f.run('state.programs=[{id:62,name:"Keep me"}];');
  await f.run("deleteProgram(state.programs[0])");
  assert.equal(f.run("state.programs.length"), 1);
  assert.equal(f.node("#programEditor").hidden, false);
  assert.equal(f.context.lastToast, "Delete failed");
});
