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
        case "GET meal-plans":
          return json(route, { mealPlans: [] });
        case "GET workouts":
          return json(route, {
            workouts: db.workouts.filter(
              (w) => String(w.client_id) === q.clientId,
            ),
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
          return json(route, { events: [] });
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
