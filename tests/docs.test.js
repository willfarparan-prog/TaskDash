const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { zipSync, strToU8 } = require("fflate");

const { extractText } = require("../lib/docText");
const { cleanSuggestion, CATEGORIES } = require("../lib/docOrganize");

test("text comes out of Word, Excel and plain-text files", () => {
  const docx = Buffer.from(
    zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Holiday party &amp; RSVP</w:t></w:r></w:p><w:p><w:t>Due Oct 15</w:t></w:p></w:body></w:document>",
      ),
    }),
  );
  assert.equal(
    extractText(docx, "Plan.docx"),
    "Holiday party & RSVP\nDue Oct 15",
  );
  const xlsx = Buffer.from(
    zipSync({
      "xl/sharedStrings.xml": strToU8(
        "<sst><si><t>Badge</t></si><si><t>Count</t></si></sst>",
      ),
    }),
  );
  assert.equal(extractText(xlsx, "report.xlsx"), "Badge Count");
  assert.equal(extractText(Buffer.from("hello"), "notes.txt"), "hello");
  assert.equal(extractText(Buffer.from("%PDF"), "scan.pdf"), null);
  assert.equal(extractText(Buffer.from("not a zip"), "broken.docx"), null);
});

test("Claude's filing suggestion is kept to known, tidy values", () => {
  const s = cleanSuggestion({
    title: "  Q4 Event Plan ",
    category: "Made up",
    tags: ["Events", " Michelle ", ""],
    action_items: [
      { text: "Send RSVPs", due: "2026-10-15" },
      { text: "Book room", due: "soon" },
      { text: "" },
    ],
  });
  assert.equal(s.title, "Q4 Event Plan");
  assert.equal(s.category, "Other");
  assert.ok(CATEGORIES.includes(s.category));
  assert.deepEqual(s.tags, ["events", "michelle"]);
  assert.deepEqual(s.action_items, [
    { text: "Send RSVPs", due: "2026-10-15" },
    { text: "Book room", due: "" },
  ]);
});

function stub(rel, exports) {
  const file = require.resolve(
    rel.startsWith("@") ? rel : path.join("..", rel),
  );
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
function call(handler, req) {
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
    handler({ headers: {}, query: {}, ...req }, res);
  });
}

test("adding a file stores it privately and returns Claude's suggestion", async () => {
  const puts = [],
    inserts = [];
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({
      async query(sql, params) {
        if (sql.includes("insert into docs")) {
          inserts.push(params);
          return {
            rows: [
              {
                id: 1,
                kind: "file",
                title: params[0],
                file_name: params[2],
                content_type: params[3],
                from_person: params[5],
                note: params[7],
              },
            ],
          };
        }
        return { rows: [] };
      },
    }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  stub("@vercel/blob", {
    put: async (pathname, body, opts) => {
      puts.push({ pathname, opts, size: body.length });
      return { pathname };
    },
  });
  let seen;
  stub("lib/docOrganize.js", {
    CATEGORIES: ["Events", "Other"],
    organizeDoc: async (doc, content) => {
      seen = { doc, content };
      return {
        suggestion: { title: "Holiday Party Plan", category: "Events" },
        usage: {},
      };
    },
  });
  process.env.ANTHROPIC_API_KEY = "test";
  delete require.cache[require.resolve("../lib/routes/docs.js")];
  const handler = require("../lib/routes/docs.js");
  const { code, body } = await call(handler, {
    method: "POST",
    query: { dayKey: "2026-10-07" },
    headers: {
      "content-type": "application/octet-stream",
      "x-doc-meta": encodeURIComponent(
        JSON.stringify({
          name: "party/plan.pdf",
          type: "application/pdf",
          from: "Michelle",
          note: "Read before Friday",
        }),
      ),
    },
    body: Buffer.from("%PDF-1.4 fake"),
  });
  assert.equal(code, 201);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].opts.access, "private");
  assert.match(puts[0].pathname, /^docs\/[0-9a-f-]+\/party_plan\.pdf$/);
  assert.equal(inserts[0][3], "application/pdf");
  assert.equal(inserts[0][5], "Michelle");
  assert.equal(seen.doc.note, "Read before Friday");
  assert.ok(seen.content.pdf);
  assert.equal(body.suggestion.category, "Events");
});

test("links must be https and files over 4 MB are turned away", async () => {
  stub("lib/db.js", {
    ensureWorkspaceSchema: async () => {},
    trackUsage: () => {},
    getPool: () => ({ query: async () => ({ rows: [] }) }),
  });
  stub("lib/session.js", { requireOwnerSession: () => true });
  delete require.cache[require.resolve("../lib/routes/docs.js")];
  const handler = require("../lib/routes/docs.js");
  const bad = await call(handler, {
    method: "POST",
    body: { url: "javascript:alert(1)" },
  });
  assert.equal(bad.code, 400);
  const big = await call(handler, {
    method: "POST",
    headers: { "x-doc-meta": encodeURIComponent('{"name":"big.pdf"}') },
    body: Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  assert.equal(big.code, 413);
});

test("only safe file types open in the browser; the rest download", () => {
  delete require.cache[require.resolve("../lib/routes/docs.js")];
  const { servedAs } = require("../lib/routes/docs.js");
  assert.deepEqual(servedAs({ content_type: "application/pdf" }), {
    contentType: "application/pdf",
    disposition: "inline",
  });
  for (const type of [
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "",
    "TEXT/HTML; charset=utf-8",
  ])
    assert.deepEqual(servedAs({ content_type: type }), {
      contentType: "application/octet-stream",
      disposition: "attachment",
    });
});
