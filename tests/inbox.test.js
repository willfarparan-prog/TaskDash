const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Swap the API's database, Google and session modules for fakes.
function load(tokens) {
  const stub = (rel, exports) => {
    const file = require.resolve(path.join("..", rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  stub("lib/google.js", {
    OWNER_EMAIL: "willfarparan@gmail.com",
    WORK_EMAIL: "william.farparan@teamexos.com",
    getVerifiedGoogleToken: async (kind = "owner") => tokens[kind] ?? null,
  });
  delete require.cache[require.resolve("../lib/routes/inbox.js")];
  return require("../lib/routes/inbox.js");
}

function call(handler) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    handler({ method: "GET", headers: {} }, res);
  });
}

test("work and personal priority mail are merged, newest first", async (t) => {
  const mailbox = {
    "work-token": [{ id: "w1", time: 2000, from: "Michelle <m@teamexos.com>" }],
    "owner-token": [{ id: "p1", time: 1000, from: "Kelly <k@x.com>" }],
  };
  t.mock.method(global, "fetch", async (url, opts) => {
    const token = opts.headers.Authorization.replace("Bearer ", "");
    const items = mailbox[token];
    const id = /messages\/([^?]+)/.exec(url)?.[1];
    const body = id
      ? (() => {
          const m = items.find((x) => x.id === id);
          return {
            id,
            internalDate: String(m.time),
            snippet: "hi",
            payload: {
              headers: [
                { name: "From", value: m.from },
                { name: "Subject", value: "S" },
              ],
            },
          };
        })()
      : { messages: items.map((m) => ({ id: m.id })) };
    return { ok: true, json: async () => body };
  });
  const handler = load({
    owner: {
      access_token: "owner-token",
      scope: "x gmail.readonly",
      account_email: "willfarparan@gmail.com",
    },
    work: {
      access_token: "work-token",
      scope: "calendar.events gmail.readonly",
      account_email: "william.farparan@teamexos.com",
    },
  });
  const { code, body } = await call(handler);
  assert.equal(code, 200);
  assert.deepEqual(body.connections, {
    google: true,
    work: true,
    microsoft: false,
  });
  assert.deepEqual(
    body.messages.map((m) => [m.source, m.from]),
    [
      ["work", "Michelle"],
      ["google", "Kelly"],
    ],
  );
  assert.deepEqual(body.notices, []);
  // The account rides in the standard authuser parameter, not a /u/<email>/ path.
  assert.equal(
    body.messages[0].link,
    "https://mail.google.com/mail/?authuser=william.farparan%40teamexos.com#all/w1",
  );
  assert.equal(
    body.messages[1].link,
    "https://mail.google.com/mail/?authuser=willfarparan%40gmail.com#all/p1",
  );
  for (const m of body.messages)
    assert.doesNotMatch(m.link, /\/mail\/u\//, "no path-style account selector");
});

test("a work account connected for calendar only asks to reconnect", async (t) => {
  t.mock.method(global, "fetch", async () => ({
    ok: true,
    json: async () => ({ messages: [] }),
  }));
  const handler = load({
    owner: {
      access_token: "o",
      scope: "gmail.readonly",
      account_email: "willfarparan@gmail.com",
    },
    work: {
      access_token: "w",
      scope: "calendar.events",
      account_email: "william.farparan@teamexos.com",
    },
  });
  const { body } = await call(handler);
  assert.equal(body.connections.work, false);
  assert.equal(body.notices.length, 1);
  assert.equal(body.notices[0].account, "work");
  assert.match(body.notices[0].text, /calendar only/);
});
