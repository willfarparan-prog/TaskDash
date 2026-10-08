// End-to-end smoke test: serves this folder, opens the real dashboard in
// Chrome with the API replaced by an in-memory fake, clicks through the main
// flows and fails on any page error. Run with `npm run smoke` (needs Google
// Chrome installed; playwright-core drives it without downloading browsers).
const http = require("http");
const { readFileSync, existsSync, statSync } = require("fs");
const { join, extname } = require("path");
const { chromium } = require("playwright-core");

const ROOT = join(__dirname, "..");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serve() {
  const server = http.createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    const file = join(ROOT, path);
    if (
      !file.startsWith(ROOT) ||
      !existsSync(file) ||
      statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "text/plain",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// The fake API: just enough of each route for the flows below.
function fakeApi() {
  const card = JSON.parse(
    readFileSync(join(ROOT, "db/stock-programs-training-card.json"), "utf8"),
  );
  const db = {
    seq: 100,
    errors: [],
    daily: [{ id: 1, name: "Carry-over task", done: false, day_key: day(-2) }],
    clients: [
      {
        id: 1,
        name: "Jordan Lee",
        email: "jordan@example.com",
        service_type: "Personal training",
        status: "active",
        onboarding: {},
        first_session: day(2),
      },
    ],
    sessions: [],
    programs: [
      ...card
        .slice(0, 4)
        .map((p, i) => ({
          ...p,
          id: 10 + i,
          is_stock: true,
          status: "active",
        })),
      {
        ...card[0],
        id: 50,
        name: "Jordan · Program",
        is_stock: false,
        client_id: 1,
        client_name: "Jordan Lee",
        status: "active",
      },
    ],
    workouts: [],
    events: [
      {
        id: 31,
        name: "Recovery Lab",
        event_date: day(-2),
        pillar: "Recovery",
        expected_attendance: 30,
        description: "Mobility and percussion stations.",
        pipeline_state: {},
        drafts: {},
        report: {},
      },
    ],
    docs: [],
  };
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  return {
    db,
    async handle(route) {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname.replace(/^\/api\//, ""),
        method = req.method(),
        q = Object.fromEntries(url.searchParams),
        body = (() => {
          try {
            return req.postDataJSON() || {};
          } catch {
            return {};
          }
        })();
      switch (`${method} ${path}`) {
        case "GET tasks":
          return json(route, { daily: db.daily, checks: [], recur: [] });
        case "POST tasks": {
          const t = {
            id: db.seq++,
            name: body.name,
            done: false,
            day_key: body.dayKey,
          };
          db.daily.push(t);
          return json(route, t, 201);
        }
        case "PATCH tasks": {
          const t = db.daily.find((x) => String(x.id) === String(body.id));
          if (t && typeof body.done === "boolean") t.done = body.done;
          return json(route, { ok: true });
        }
        case "GET clients":
          return json(route, { clients: db.clients, sessions: db.sessions });
        case "POST clients": {
          const c = {
            id: db.seq++,
            name: body.name,
            email: body.email,
            service_type: body.serviceType,
            status: "active",
            first_session: body.firstSession,
            onboarding: body.serviceType === "Personal training" ? {} : null,
          };
          db.clients.push(c);
          return json(route, c, 201);
        }
        case "PATCH clients": {
          const c = db.clients.find((x) => String(x.id) === q.id);
          if (q.resource === "onboarding") {
            c.onboarding = { ...(c.onboarding || {}) };
            if (body.done) c.onboarding[body.step] = body.dayKey;
            else delete c.onboarding[body.step];
          }
          return json(route, c);
        }
        case "GET programs":
          return json(route, { programs: db.programs });
        case "POST programs": {
          // Attaching a program copies the source into a new, separate row.
          const src = db.programs.find(
            (x) => String(x.id) === String(body.sourceId),
          );
          if (!src) return json(route, { error: "Program not found" }, 404);
          const copy = {
            ...structuredClone(src),
            id: db.seq++,
            name: body.name,
            is_stock: false,
            client_id: body.clientId,
            client_name: body.clientName,
            status: body.status || "draft",
            source_program_id: src.id,
          };
          db.programs.unshift(copy);
          return json(route, copy, 201);
        }
        case "PATCH programs": {
          const p = db.programs.find((x) => String(x.id) === q.id);
          if (body.content) p.content = body.content;
          return json(route, p);
        }
        case "GET meal-plans":
          return json(route, { mealPlans: [] });
        case "GET workouts":
          return json(route, {
            // Newest first, like the real API.
            workouts: db.workouts
              .filter((w) => String(w.client_id) === q.clientId)
              .reverse(),
          });
        case "POST workouts": {
          const w = {
            id: db.seq++,
            client_id: body.clientId,
            program_id: body.programId,
            program_name: body.programName,
            day_index: body.dayIndex,
            day_name: body.dayName,
            week_index: body.weekIndex,
            entries: body.entries,
            status: "in_progress",
            started_at: new Date().toISOString(),
          };
          db.workouts.push(w);
          return json(route, w, 201);
        }
        case "PATCH workouts": {
          const w = db.workouts.find((x) => String(x.id) === q.id);
          Object.assign(w, { entries: body.entries, notes: body.notes });
          if (body.finish && w.status !== "finished") {
            w.status = "finished";
            db.sessions.push({
              id: db.seq++,
              client_id: w.client_id,
              session_type: "Personal training",
              session_date: body.dayKey,
            });
          }
          return json(route, w);
        }
        case "GET docs":
          return json(route, {
            docs: db.docs,
            categories: ["Events", "Other"],
          });
        case "POST docs": {
          const d = {
            id: db.seq++,
            kind: "link",
            title: body.title || "Untitled link",
            url: body.url,
            from_person: body.from,
            status: "inbox",
            tags: [],
            action_items: [],
            received_on: day(),
          };
          db.docs.unshift(d);
          return json(
            route,
            {
              doc: d,
              suggestion: {
                title: "Holiday Party Plan",
                category: "Events",
                summary: "Plan for the party.",
                tags: ["events"],
                action_items: [{ text: "Send RSVPs", due: day(3) }],
              },
            },
            201,
          );
        }
        case "PATCH docs": {
          const d = db.docs.find((x) => String(x.id) === q.id);
          Object.assign(d, {
            title: body.title,
            category: body.category,
            status: body.status,
            tags: body.tags,
            action_items: body.actionItems,
            pinned: body.pinned,
          });
          return json(route, d);
        }
        case "GET inbox":
          return json(route, {
            messages: [
              {
                id: "work-1",
                source: "work",
                from: "Michelle",
                subject: "Staffing",
                snippet: "Can you cover?",
                received: "Oct 8",
                link: "https://mail.google.com/mail/u/x/#all/1",
              },
            ],
            connections: { google: true, work: true },
            notices: [],
          });
        case "GET errors":
          return json(route, { errors: [] });
        case "POST errors":
          db.errors.push(body);
          return json(route, { ok: true }, 201);
        case "GET events":
          return json(route, { events: db.events });
        case "PATCH events": {
          const ev = db.events.find((x) => String(x.id) === q.id);
          if (body.report) ev.report = body.report;
          if (body.pipelineState) ev.pipeline_state = body.pipelineState;
          return json(route, body.report ? { report: body.report } : ev);
        }
        case "POST events": {
          if (q.action !== "report") return json(route, { error: "unmocked" }, 400);
          db.reportRequest = body;
          return json(route, {
            description: ["Hands-on mobility stations", "Percussion therapy"],
            takeaways: ["Attendees wanted longer sessions"],
            strategy: { answer: "yes", reason: "Recovery pillar." },
          });
        }
        case "GET connections":
          return json(route, {
            connections: [],
            usage: { calls: 0, tokens: 0, runs: [] },
          });
        case "GET calendar-week":
          return json(route, { events: [], connected: false });
        case "GET calendar-manual":
          return json(
            route,
            q.resource === "availability"
              ? { days: [], settings: {} }
              : { settings: {}, bookings: [] },
          );
        case "GET links":
          return json(route, { links: [] });
      }
      return json(route, { error: `fake API has no ${method} ${path}` }, 404);
    },
  };
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const failures = [];
  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures.push(name);
      console.log(`  ✗ ${name}\n    ${err.message.split("\n")[0]}`);
    }
  };
  try {
    const api = fakeApi();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 860 },
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
        pageErrors.push(m.text());
    });
    page.on("dialog", (d) => d.accept());
    await page.route("**/api/**", (route) => api.handle(route));
    await page.goto(base);
    await page.waitForSelector("#taskList .task-row");

    await step("dashboard shows carried-over tasks", async () => {
      const text = await page.textContent("#taskList");
      if (!text.includes("Carry-over task"))
        throw new Error("carry-over task missing");
    });

    await step("adding a one-off task", async () => {
      await page.fill("#taskInput", "Smoke test task");
      await page.click("#taskAdd");
      await page.waitForSelector("#taskList :text('Smoke test task')");
    });

    await step("every page opens", async () => {
      for (const view of [
        "resources",
        "docs",
        "calendar",
        "scheduler",
        "programs",
        "clients",
        "inbox",
        "events",
        "connections",
        "settings",
        "dashboard",
      ]) {
        await page.click(`.nav-item[data-view="${view}"]`);
        await page.waitForSelector(`#view-${view}.active`);
      }
    });

    await step("stock library filters and previews", async () => {
      await page.click('.nav-item[data-view="programs"]');
      await page.click('#programFilters [data-filter="stock"]');
      await page.waitForSelector("#stockFilters select");
      if (!(await page.locator(".program-preview").count()))
        throw new Error("no previews");
      const before = await page.locator("#programGrid .program-card").count();
      await page.selectOption('[data-stock-filter="days"]', "2");
      const after = await page.locator("#programGrid .program-card").count();
      if (!(after > 0 && after < before))
        throw new Error(`filter gave ${before} → ${after}`);
      await page.click('[data-stock-filter="clear"]');
    });

    await step(
      "adding a personal-training client starts the checklist",
      async () => {
        await page.click('.nav-item[data-view="clients"]');
        await page.click("#newClientBtn");
        await page.fill('#dialogForm [name="name"]', "Smoke Client");
        await page.selectOption(
          '#dialogForm [name="serviceType"]',
          "Personal training",
        );
        await page.click("#dialogSubmit");
        await page.waitForSelector("#clientRows :text('Smoke Client')");
        const chip = await page.textContent(
          "#clientRows tr:last-child .onboard-chip",
        );
        if (!chip.includes("0/5")) throw new Error(`chip says ${chip}`);
      },
    );

    await step("client page and live session", async () => {
      await page.click('#clientRows tr:first-child [data-action="profile"]');
      await page.waitForSelector("#view-client.active");
      if (!page.url().includes("#client/1"))
        throw new Error(`url ${page.url()}`);
      await page.click('[data-profile="live"]');
      await page.waitForSelector("#liveSession:not([hidden]) .live-set");
      await page.fill('.live-set [data-field="weight"] >> nth=0', "135");
      await page.click(".live-check >> nth=0");
      await page.click('[data-live="finish"]');
      await page.waitForSelector("#liveSession", { state: "hidden" });
      if (api.db.sessions.length !== 1)
        throw new Error("finishing didn't log a session");
      const first = api.db.workouts[0].entries[0].sets[0];
      if (first.weight !== "135" || !first.done)
        throw new Error(`set saved as ${JSON.stringify(first)}`);
    });

    await step("attach a stock program from the client's profile", async () => {
      const stock = api.db.programs.find((p) => p.is_stock);
      const before = JSON.stringify(stock);
      await page.click('[data-profile="add-stock"]');
      await page.waitForSelector('#dialogForm select[name="source"]');
      await page.fill(".picker-search", stock.name.slice(0, 8));
      await page.selectOption(
        '#dialogForm select[name="source"]',
        { index: 0 },
      );
      await page.click("#dialogSubmit");
      await page.waitForSelector(".client-program[data-program]:nth-of-type(2)");
      const copy = api.db.programs.find(
        (p) => !p.is_stock && p.source_program_id === stock.id,
      );
      if (!copy || copy.client_id !== 1 || copy.status !== "active")
        throw new Error(`copy was ${JSON.stringify(copy)}`);
      if (copy.id === stock.id) throw new Error("copy reused the template row");
      if (JSON.stringify(stock) !== before)
        throw new Error("the stock template changed");
      const text = await page.textContent(`.client-program[data-program="${copy.id}"] header small`);
      if (!text.includes("copied from")) throw new Error(`label: ${text}`);
    });

    await step("last weights pre-fill and the plan can change mid-session", async () => {
      const stockContent = JSON.stringify(
        api.db.programs.find((p) => p.is_stock).content,
      );
      // Jordan's program already has one finished session (135 lb on the first set).
      // Day 1, week 2 straight from the program grid.
      await page.click('.client-program[data-program="50"] [data-day="0"][data-week="1"]');
      await page.waitForSelector("#liveSession:not([hidden]) .live-set");
      const first = '.live-set [data-field="weight"] >> nth=0';
      if (!(await page.locator(first).evaluate((el) => el.classList.contains("suggested"))))
        throw new Error("first set isn't suggesting last session's weight");
      if ((await page.getAttribute(first, "placeholder")) !== "135")
        throw new Error("suggestion isn't 135");
      if ((await page.inputValue(first)) !== "")
        throw new Error("a suggestion was logged as a weight");
      await page.click('[data-live="use-last"]');
      if ((await page.inputValue(first)) !== "135")
        throw new Error("Use last weights didn't fill it in");

      // Swap the first exercise, for this client's program too.
      const name = await page.textContent(".live-ex >> nth=0 >> header strong");
      await page.click(".live-more >> nth=0");
      await page.click('[data-live="swap"]');
      await page.fill('#dialogForm [name="name"]', "Smoke Goblet Squat");
      await page.selectOption('#dialogForm [name="scope"]', { index: 1 });
      await page.click("#dialogSubmit");
      await page.waitForFunction(
        () => document.querySelector(".live-ex strong")?.textContent === "Smoke Goblet Squat",
      );
      const program = api.db.programs.find((p) => p.id === 50);
      if (program.content.days[0].blocks[0].exercises[0].name !== "Smoke Goblet Squat")
        throw new Error("the client's program wasn't updated");

      // Add one just for today.
      await page.click('[data-live="add-exercise"]');
      await page.fill('#dialogForm [name="name"]', "Smoke Face Pull");
      await page.click("#dialogSubmit");
      await page.waitForSelector('.live-ex strong:text("Smoke Face Pull")');
      await page.click('[data-live="finish"]');
      await page.waitForSelector("#liveSession", { state: "hidden" });

      const logged = api.db.workouts.at(-1).entries;
      if (!logged.some((e) => e.name === "Smoke Face Pull"))
        throw new Error("added exercise missing from the log");
      if (JSON.stringify(program.content).includes("Smoke Face Pull"))
        throw new Error("a today-only exercise leaked into the program");
      if (JSON.stringify(api.db.programs.find((p) => p.is_stock).content) !== stockContent)
        throw new Error("the stock template changed");
      if (name === "Smoke Goblet Squat") throw new Error("swap didn't change the name");
    });

    await step("the profile shows program progress", async () => {
      await page.waitForSelector(".client-program[data-program=\"50\"] .run-grid td button.done");
      await page.click(".progress-panel summary");
      await page.waitForSelector('.progress-table :text("Smoke Goblet Squat")');
    });

    await step("Wellbeing Strategy report: numbers, draft, copy-ready text", async () => {
      await page.click('.nav-item[data-view="events"]');
      await page.waitForSelector(".event-card .report-panel");
      await page.click(".report-panel > summary");
      await page.fill('[data-report-field="actual"]', "34");
      await page.press('[data-report-field="actual"]', "Tab");
      await page.waitForSelector('[data-report-field="paste"]');
      const header =
        "ID\tName\tHow likely are you to recommend this event? (0-10)\tComments";
      const rows = [10, 9, 9, 8, 6, 10, 9, 3].map(
        (n, i) => `${i + 1}\tPat ${i}\t${n}\t${n < 7 ? "Too crowded" : ""}`,
      );
      await page.fill('[data-report-field="paste"]', [header, ...rows].join("\n"));
      await page.click('[data-report-action="read"]');
      await page.waitForSelector(".report-nps");
      const nps = await page.textContent(".report-nps");
      // 5 promoters, 1 passive, 2 detractors of 8 → (5 - 2) / 8 = 38
      if (!nps.includes("NPS 38") || !nps.includes("8 responses"))
        throw new Error(`NPS line: ${nps}`);
      await page.click('[data-report-action="draft"]');
      await page.waitForSelector('.seg.on[data-value="yes"]');
      const text = await page.textContent("[data-report-preview]");
      for (const want of [
        "WELLBEING STRATEGY? YES",
        "* Hands-on mobility stations",
        "* Attendees wanted longer sessions",
        "Objective: 30 Participants",
        "Outcome: Goal Met 34 Participants",
        "NPS Score: 38",
      ])
        if (!text.includes(want)) throw new Error(`missing "${want}" in:\n${text}`);
      const saved = api.db.events[0].report;
      if (saved.nps.score !== 38 || saved.actual !== 34)
        throw new Error(`saved ${JSON.stringify(saved)}`);
      if (JSON.stringify(saved).includes("Too crowded"))
        throw new Error("pasted comments were saved");
      if (JSON.stringify(saved).includes("Pat 1"))
        throw new Error("names were saved");
      if (!api.db.reportRequest.comments.includes("Too crowded"))
        throw new Error("comments weren't sent for drafting");
      if (JSON.stringify(api.db.reportRequest).includes("Pat "))
        throw new Error("names were sent to Claude");
      // Flipping the goal by hand sticks.
      await page.click('[data-report-action="goal"][data-value="not_met"]');
      await page.waitForSelector('.seg.on[data-value="not_met"]');
      if (!(await page.textContent("[data-report-preview]")).includes("Goal Not Met"))
        throw new Error("goal toggle didn't reach the text");
      // The survey tracker follows the pasted response count.
      if (api.db.events[0].pipeline_state._survey.responses !== 8)
        throw new Error("survey tracker wasn't updated");
    });

    await step("filing a doc from Claude's suggestion", async () => {
      await page.click('.nav-item[data-view="docs"]');
      await page.click("#addDocBtn");
      await page.fill(
        '#dialogForm [name="url"]',
        "https://docs.google.com/document/d/x/edit",
      );
      await page.click("#dialogSubmit");
      await page.waitForFunction(() =>
        document.querySelector("#dialogKicker")?.textContent.includes("CLAUDE"),
      );
      await page.click("#dialogSubmit");
      await page.waitForSelector("#docList :text('Holiday Party Plan')");
      if (api.db.docs[0].status !== "filed") throw new Error("doc not filed");
    });

    await step("inbox messages link to Gmail", async () => {
      await page.click('.nav-item[data-view="inbox"]');
      await page.waitForSelector("a.mail-row");
      const href = await page.getAttribute("a.mail-row", "href");
      if (!href.startsWith("https://mail.google.com/")) throw new Error(href);
    });

    await step("phone layout has no sideways scroll", async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const view of ["dashboard", "clients", "programs", "docs"]) {
        await page.evaluate((v) => go(v), view);
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        if (wide) throw new Error(`${view} scrolls sideways`);
      }
    });

    await step("no page or browser errors", async () => {
      const all = [...pageErrors, ...api.db.errors.map((e) => e.message)];
      if (all.length) throw new Error(all.slice(0, 3).join(" | "));
    });
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} smoke step(s) failed.`);
    process.exit(1);
  }
  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
