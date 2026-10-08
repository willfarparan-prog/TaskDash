// Plain text from an uploaded doc, for Claude to read when organizing it.
// PDFs go to Claude as documents instead; Office files are zip archives of
// XML, so their text is pulled out of the right XML parts.
const { unzipSync, strFromU8 } = require("fflate");

const MAX_CHARS = 40000;
const xmlText = (xml) =>
  xml
    .replace(/<\/(w:p|a:p|row)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n\s*/g, "\n")
    .trim();

function officeText(buffer, parts) {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (f) => parts.some((p) => p.test(f.name)),
  });
  return Object.keys(files)
    .sort()
    .map((name) => xmlText(strFromU8(files[name])))
    .join("\n");
}

// Returns text, or null when the type isn't readable here.
function extractText(buffer, fileName = "", contentType = "") {
  const name = fileName.toLowerCase();
  let text = null;
  try {
    if (name.endsWith(".docx"))
      text = officeText(buffer, [/^word\/document\.xml$/]);
    else if (name.endsWith(".xlsx"))
      text = officeText(buffer, [/^xl\/sharedStrings\.xml$/]);
    else if (name.endsWith(".pptx"))
      text = officeText(buffer, [/^ppt\/slides\/slide\d+\.xml$/]);
    else if (/\.(txt|csv|md)$/.test(name) || /^text\//.test(contentType))
      text = Buffer.from(buffer).toString("utf8");
  } catch {
    text = null;
  }
  return text ? text.slice(0, MAX_CHARS) : null;
}

module.exports = { extractText };
