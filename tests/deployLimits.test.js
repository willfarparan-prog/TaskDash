const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, statSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

// Vercel's Hobby plan rejects a deployment with more than 12 functions.
test("the api folder stays within the Hobby plan's 12 functions", () => {
  const count = (dir) =>
    readdirSync(dir).reduce((n, name) => {
      const path = join(dir, name);
      return n + (statSync(path).isDirectory() ? count(path) : name.endsWith(".js") ? 1 : 0);
    }, 0);
  assert.ok(count(join(__dirname, "..", "api")) <= 12);
});

test("rewritten API routes point at functions that handle them", () => {
  const config = JSON.parse(readFileSync(join(__dirname, "..", "vercel.json"), "utf8"));
  for (const r of config.rewrites || []) {
    const target = new URL(r.destination, "https://x"),
      resource = target.searchParams.get("resource"),
      source = readFileSync(join(__dirname, "..", `${target.pathname}.js`), "utf8");
    assert.match(source, new RegExp(`resource === "${resource}"`), r.source);
  }
});

// Vercel serves every file in the repo; server-only folders (client data in
// db/, server code in lib/) must be redirected away before that happens.
test("server-only folders are not served as static files", () => {
  const config = JSON.parse(readFileSync(join(__dirname, "..", "vercel.json"), "utf8"));
  const blocked = (config.redirects || []).map((r) => r.source);
  const root = join(__dirname, "..");
  const publicFiles = new Set(["index.html", "book.html", "app.js", "book.js", "styles.css", "book.css", "task-schedule.js", "meal-intake.js"]);
  for (const name of readdirSync(root)) {
    if (name.startsWith(".") || ["node_modules", "api"].includes(name)) continue;
    if (statSync(join(root, name)).isDirectory())
      assert.ok(blocked.includes(`/${name}/:path*`), `${name}/ is publicly served`);
    else if (/\.(js|json|sql|html|css)$/.test(name) && !["package.json", "package-lock.json", "vercel.json"].includes(name))
      assert.ok(publicFiles.has(name), `${name} would be public; add it to the list or move it`);
  }
});
