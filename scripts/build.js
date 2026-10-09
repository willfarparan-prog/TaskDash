const { mkdirSync, copyFileSync, cpSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const root = join(__dirname, "..");
const out = join(root, "public");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const file of [
  "index.html",
  "book.html",
  "book.js",
  "book.css",
  "task-schedule.js",
  "meal-intake.js",
])
  copyFileSync(join(root, file), join(out, file));
for (const dir of ["js", "css"])
  cpSync(join(root, dir), join(out, dir), { recursive: true });
console.log("Built allowlisted browser assets in public/");
