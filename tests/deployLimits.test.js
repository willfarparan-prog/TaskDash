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

// Validate the actual generated output; Vercel omits .gitignore in remote builds.
test("server-only files are excluded from generated static output", () => {
  const root = join(__dirname, "..");
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.equal(config.outputDirectory, "public");
  require("../scripts/build");
  assert.deepEqual(
    readdirSync(join(root, "public")).sort(),
    [
      "book.css",
      "book.html",
      "book.js",
      "css",
      "index.html",
      "js",
      "meal-intake.js",
      "task-schedule.js",
    ].sort(),
  );
  const html = readFileSync(join(root, "public", "index.html"), "utf8");
  for (const match of html.matchAll(/(?:src|href)="(\/(?:js|css)\/[^"?]+)"/g))
    assert.ok(statSync(join(root, "public", match[1])).isFile(), match[1]);
});
