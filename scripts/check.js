const { execFileSync } = require("node:child_process");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = join(__dirname, "..");
const ignored = new Set(["node_modules", ".git", ".vercel"]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const javascript = files(root).filter((path) => path.endsWith(".js"));
for (const path of javascript) {
  execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
}

for (const name of ["package.json", "vercel.json"]) {
  JSON.parse(readFileSync(join(root, name), "utf8"));
}

console.log(
  `Checked ${javascript.length} JavaScript files and deployment JSON.`,
);
console.log(javascript.map((path) => `  ✓ ${relative(root, path)}`).join("\n"));
