const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, statSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

// Everything under /api goes through one function, so Vercel's Hobby limit
// of 12 functions never comes into play.
test("the api folder holds only the router", () => {
  assert.deepEqual(readdirSync(join(__dirname, "..", "api")), ["router.js"]);
  const config = JSON.parse(
    readFileSync(join(__dirname, "..", "vercel.json"), "utf8"),
  );
  assert.deepEqual(config.rewrites, [
    { source: "/api/:route*", destination: "/api/router?__route=:route*" },
  ]);
});

test("the router knows every handler in lib/routes, and each loads", () => {
  const { ROUTES } = require("../api/router");
  const files = readdirSync(join(__dirname, "..", "lib", "routes"))
    .map((f) => f.replace(/\.js$/, ""))
    .sort();
  const routed = Object.keys(ROUTES)
    .map((r) => r.replace("/", "-"))
    .sort();
  assert.deepEqual(routed, files);
  for (const load of Object.values(ROUTES))
    assert.equal(typeof load(), "function");
});

function fakeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

test("the router answers unknown routes with 404 and passes the query on", async () => {
  const router = require("../api/router");
  const missing = fakeRes();
  await router({ query: { __route: "nope" }, headers: {} }, missing);
  assert.equal(missing.statusCode, 404);
  // A signed-out request reaches the handler with __route removed.
  const req = {
    query: { __route: "tasks", day: "2026-10-08" },
    headers: {},
    method: "GET",
  };
  const res = fakeRes();
  await router(req, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(req.query, { day: "2026-10-08" });
});

// Vercel serves every file in the repo; server-only folders (client data in
// db/, server code in lib/) must be redirected away before that happens.
test("server-only folders are not served as static files", () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, "..", "vercel.json"), "utf8"),
  );
  const blocked = (config.redirects || []).map((r) => r.source);
  const root = join(__dirname, "..");
  const publicFiles = new Set([
    "index.html",
    "book.html",
    "book.js",
    "book.css",
    "task-schedule.js",
    "meal-intake.js",
  ]);
  // Gitignored paths (node_modules/, tmp/, .env…) are never deployed.
  const ignored = readFileSync(join(root, ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const name of readdirSync(root)) {
    if (name.startsWith(".") || name === "api" || ignored.includes(name))
      continue;
    if (statSync(join(root, name)).isDirectory()) {
      if (["js", "css"].includes(name)) continue; // browser code, public by design
      assert.ok(
        blocked.includes(`/${name}/:path*`),
        `${name}/ is publicly served`,
      );
    } else if (
      /\.(js|json|sql|html|css)$/.test(name) &&
      !["package.json", "package-lock.json", "vercel.json"].includes(name)
    )
      assert.ok(
        publicFiles.has(name),
        `${name} would be public; add it to the list or move it`,
      );
  }
});
