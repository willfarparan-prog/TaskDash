// /api/docs (served by api/links.js; see vercel.json rewrites) — docs from
// the manager. Files go to the private Vercel Blob store and are only served
// back through this signed-in route; links are stored as-is. New docs land
// in the inbox with Claude's filing suggestion for the coach to confirm.

const crypto = require("crypto");
const { Readable } = require("stream");
const { getPool, ensureWorkspaceSchema, trackUsage } = require("./db");
const { requireOwnerSession } = require("./session");

const MAX_BYTES = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB.
const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

function blob() {
  return require("@vercel/blob");
}

async function blobBuffer(pathname) {
  const result = await blob().get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) throw new Error("File not found");
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

// What Claude can read from the doc: a PDF, extracted text, or nothing.
function readableContent(buffer, fileName, contentType) {
  if (!buffer) return null;
  if (/pdf/i.test(contentType) || /\.pdf$/i.test(fileName))
    return { pdf: buffer.toString("base64") };
  const text = require("./docText").extractText(buffer, fileName, contentType);
  return text ? { text } : null;
}

async function suggestFor(doc, buffer, dayKey) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { organizeDoc } = require("./docOrganize");
    const { suggestion, usage } = await organizeDoc(
      {
        title: doc.title,
        fileName: doc.file_name,
        url: doc.url,
        note: doc.note,
        from: doc.from_person,
      },
      readableContent(buffer, doc.file_name || "", doc.content_type || ""),
      dayKey,
    );
    trackUsage("Claude API", "Organize doc", "ok", usage);
    return suggestion;
  } catch (err) {
    trackUsage("Claude API", "Organize doc", "error");
    return { error: err.message };
  }
}

module.exports = async (req, res) => {
  if (!requireOwnerSession(req, res)) return;
  try {
    await ensureWorkspaceSchema();
    const db = getPool();
    const id = Number(req.query.id);
    const dayKey = isDate(req.query.dayKey || req.body?.dayKey)
      ? req.query.dayKey || req.body.dayKey
      : new Date().toISOString().slice(0, 10);

    // Serve a stored file to the signed-in owner.
    if (req.method === "GET" && req.query.file) {
      const row = (
        await db.query("select * from docs where id=$1 and kind='file'", [
          Number(req.query.file),
        ])
      ).rows[0];
      if (!row) return res.status(404).json({ error: "Doc not found" });
      const result = await blob().get(row.blob_pathname, { access: "private" });
      if (!result || result.statusCode !== 200)
        return res.status(404).json({ error: "File not found" });
      res.setHeader("Content-Type", row.content_type || "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || "document")}`,
      );
      return Readable.fromWeb(result.stream).pipe(res);
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const { CATEGORIES } = require("./docOrganize");
      const docs = await db.query(
        "select * from docs order by pinned desc, status='inbox' desc, coalesce(received_on, created_at::date) desc, id desc",
      );
      return res.status(200).json({ docs: docs.rows, categories: CATEGORIES });
    }

    if (req.method === "POST" && req.query.action === "organize") {
      const row = (await db.query("select * from docs where id=$1", [id])).rows[0];
      if (!row) return res.status(404).json({ error: "Doc not found" });
      const buffer = row.kind === "file" ? await blobBuffer(row.blob_pathname) : null;
      return res.status(200).json({ doc: row, suggestion: await suggestFor(row, buffer, dayKey) });
    }

    if (req.method === "POST") {
      const isFile = Buffer.isBuffer(req.body);
      // File uploads carry their details in a header (the body is the file),
      // so notes and names stay out of URLs and logs.
      let meta = req.body || {};
      if (isFile) {
        try {
          meta = JSON.parse(decodeURIComponent(req.headers["x-doc-meta"] || "%7B%7D"));
        } catch {
          meta = {};
        }
      }
      const from = clean(meta.from, 80) || null;
      const note = clean(meta.note, 1000) || null;
      const received = isDate(meta.receivedOn) ? meta.receivedOn : dayKey;
      let row;
      if (isFile) {
        const fileName = clean(meta.name, 160).replace(/[\\/]/g, "_") || "document";
        if (!req.body.length) return res.status(400).json({ error: "The file is empty" });
        if (req.body.length > MAX_BYTES)
          return res.status(413).json({
            error: "Files over 4 MB can't be uploaded here. Save it to Google Drive and add the link instead.",
          });
        const contentType = clean(req.headers["content-type"], 120) || "application/octet-stream";
        const stored = await blob().put(
          `docs/${crypto.randomUUID()}/${fileName}`,
          req.body,
          { access: "private", contentType: meta.type || contentType },
        );
        row = (
          await db.query(
            `insert into docs (kind, title, blob_pathname, file_name, content_type, size_bytes, from_person, received_on, note)
             values ('file',$1,$2,$3,$4,$5,$6,$7,$8) returning *`,
            [
              clean(meta.title, 200) || fileName.replace(/\.[a-z0-9]+$/i, ""),
              stored.pathname,
              fileName,
              clean(meta.type, 120) || contentType,
              req.body.length,
              from,
              received,
              note,
            ],
          )
        ).rows[0];
      } else {
        const url = clean(meta.url, 2000);
        if (!/^https:\/\//i.test(url))
          return res.status(400).json({ error: "Paste a link that starts with https://" });
        row = (
          await db.query(
            `insert into docs (kind, title, url, from_person, received_on, note)
             values ('link',$1,$2,$3,$4,$5) returning *`,
            [clean(meta.title, 200) || "Untitled link", url, from, received, note],
          )
        ).rows[0];
      }
      trackUsage("Task Dash API", "Add doc");
      const suggestion = await suggestFor(row, isFile ? req.body : null, dayKey);
      return res.status(201).json({ doc: row, suggestion });
    }

    if (req.method === "PATCH") {
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Doc id is required" });
      const b = req.body || {};
      const { cleanSuggestion, CATEGORIES } = require("./docOrganize");
      const filed = cleanSuggestion({
        title: b.title,
        category: b.category,
        summary: b.summary,
        tags: b.tags,
        action_items: b.actionItems,
      });
      const result = await db.query(
        `update docs set
           title = coalesce(nullif($2,''), title),
           category = coalesce($3, category),
           summary = coalesce($4, summary),
           tags = coalesce($5::jsonb, tags),
           action_items = coalesce($6::jsonb, action_items),
           from_person = coalesce($7, from_person),
           note = coalesce($8, note),
           status = coalesce($9, status),
           pinned = coalesce($10, pinned),
           updated_at = now()
         where id=$1 returning *`,
        [
          id,
          filed.title,
          "category" in b && CATEGORIES.includes(b.category) ? b.category : null,
          "summary" in b ? filed.summary : null,
          "tags" in b ? JSON.stringify(filed.tags) : null,
          "actionItems" in b ? JSON.stringify(filed.action_items) : null,
          "from" in b ? clean(b.from, 80) : null,
          "note" in b ? clean(b.note, 1000) : null,
          ["inbox", "filed"].includes(b.status) ? b.status : null,
          typeof b.pinned === "boolean" ? b.pinned : null,
        ],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Doc not found" });
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === "DELETE") {
      if (!Number.isInteger(id) || id <= 0)
        return res.status(400).json({ error: "Doc id is required" });
      const row = (await db.query("delete from docs where id=$1 returning *", [id])).rows[0];
      if (row?.blob_pathname)
        await blob().del(row.blob_pathname).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
