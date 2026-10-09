const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const mod = { exports: {} };
  const context = vm.createContext({
    module: mod,
    exports: mod.exports,
    require: (id) =>
      id in mocks
        ? mocks[id]
        : require(require.resolve(id, { paths: [path.dirname(filename)] })),
    console,
    process,
    Buffer,
    URLSearchParams,
    URL,
    Date,
    Intl,
    structuredClone,
    AbortSignal,
    ...globals,
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { exports: mod.exports, context };
}
function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
module.exports = { load, response };
