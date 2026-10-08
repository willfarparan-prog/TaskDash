// Docs from the manager: adding, Claude-suggested filing, action items.
async function loadDocs() {
  try {
    const d = await getJSON("/api/docs");
    state.docs = d.docs || [];
    state.docCategories = d.categories || [];
  } catch {
    state.docs = readLocal("taskdash_docs", []);
  }
}
function docKindLabel(d) {
  if (d.kind === "link") {
    if (/docs\.google\.com\/document/.test(d.url)) return "DOC";
    if (/docs\.google\.com\/spreadsheets/.test(d.url)) return "SHEET";
    if (/docs\.google\.com\/presentation/.test(d.url)) return "SLIDES";
    if (/drive\.google\.com/.test(d.url)) return "DRIVE";
    return "LINK";
  }
  const ext = String(d.file_name || "")
    .split(".")
    .pop()
    .toUpperCase();
  return ext && ext.length <= 5 ? ext : "FILE";
}
function renderDocs() {
  const list = $("#docList");
  if (!list) return;
  const inbox = state.docs.filter((d) => d.status === "inbox"),
    q = ($("#docSearch")?.value || "").trim().toLowerCase(),
    f = state.docFilter,
    counts = {};
  for (const d of state.docs)
    if (d.category) counts[d.category] = (counts[d.category] || 0) + 1;
  $("#docsBadge").hidden = !inbox.length;
  $("#docsBadge").textContent = inbox.length;
  const chip = (key, label, n) =>
    `<button class="${f === key ? "active" : ""}" data-doc-filter="${attr(key)}">${esc(label)}${n != null ? ` <b>${n}</b>` : ""}</button>`;
  $("#docFilters").innerHTML = [
    chip("all", "All", state.docs.length),
    chip("inbox", "Needs filing", inbox.length),
    chip("pinned", "Pinned", state.docs.filter((d) => d.pinned).length),
    chip(
      "actions",
      "Has action items",
      state.docs.filter((d) => (d.action_items || []).length).length,
    ),
    ...Object.keys(counts)
      .sort()
      .map((c) => chip(`cat:${c}`, c, counts[c])),
  ].join("");
  const shown = state.docs.filter(
    (d) =>
      (f === "all" ||
        (f === "inbox" && d.status === "inbox") ||
        (f === "pinned" && d.pinned) ||
        (f === "actions" && (d.action_items || []).length) ||
        f === `cat:${d.category}`) &&
      (!q ||
        [
          d.title,
          d.summary,
          d.category,
          d.from_person,
          d.file_name,
          ...(d.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
  list.innerHTML = shown.length
    ? shown.map(docCardHTML).join("")
    : `<div class="empty-state">${state.docs.length ? "No docs match this view." : "<strong>No docs yet.</strong><br>Add a file or a Google Doc link from your manager and Claude will suggest where it goes."}</div>`;
}
function docCardHTML(d) {
  const actions = d.action_items || [];
  return `<article class="doc-card ${d.status === "inbox" ? "inbox" : ""}" data-doc="${attr(d.id)}"><span class="doc-kind">${esc(docKindLabel(d))}</span><div class="doc-main"><div class="doc-title-row"><button class="doc-title" data-doc-action="open">${esc(d.title)}</button>${d.pinned ? '<span class="doc-pin">PINNED</span>' : ""}</div><div class="doc-meta">${d.status === "inbox" ? '<span class="doc-needs">Needs filing</span>' : d.category ? `<span class="service-pill">${esc(d.category)}</span>` : ""}<span>${esc(d.from_person || "Manager")} · ${shortDate(d.received_on || d.created_at)}</span>${(d.tags || []).map((t) => `<span class="doc-tag">#${esc(t)}</span>`).join("")}</div>${d.summary ? `<p>${esc(d.summary)}</p>` : ""}${
    actions.length
      ? `<ul class="doc-actions-list">${actions
          .map(
            (a, i) =>
              `<li><span>${esc(a.text)}${a.due ? ` <em>· due ${shortDate(a.due)}</em>` : ""}</span><button class="step-link" data-doc-action="task" data-item="${i}">＋ Task</button></li>`,
          )
          .join("")}</ul>`
      : ""
  }</div><div class="doc-buttons"><button class="step-link" data-doc-action="open">Open</button><button class="step-link" data-doc-action="review">${d.status === "inbox" ? "File it" : "Edit"}</button><button class="step-link" data-doc-action="organize" title="Ask Claude to suggest the filing again">✦ Re-sort</button><button class="step-link" data-doc-action="pin">${d.pinned ? "Unpin" : "Pin"}</button><button class="text-btn danger-text" data-doc-action="delete">Delete</button></div></article>`;
}
async function docAction(e) {
  const b = e.target.closest("[data-doc-action]");
  if (!b) return;
  const d = state.docs.find(
    (x) => String(x.id) === b.closest("[data-doc]").dataset.doc,
  );
  if (!d) return;
  const a = b.dataset.docAction,
    patch = (body) =>
      getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  if (a === "open")
    window.open(
      d.kind === "file"
        ? `/api/docs?file=${encodeURIComponent(d.id)}`
        : workAccountUrl(d.url),
      "_blank",
      "noopener",
    );
  if (a === "review") openDocReview(d, null);
  if (a === "organize") {
    b.disabled = true;
    b.textContent = "Reading…";
    try {
      const r = await getJSON(
        `/api/docs?action=organize&id=${encodeURIComponent(d.id)}&dayKey=${todayKey}`,
        { method: "POST" },
      );
      openDocReview(d, r.suggestion);
    } catch (err) {
      toast(err.message || "Claude couldn't sort this doc");
    }
    b.disabled = false;
    b.textContent = "✦ Re-sort";
  }
  if (a === "pin") {
    Object.assign(
      d,
      await patch({ pinned: !d.pinned }).catch(() => ({ pinned: !d.pinned })),
    );
    renderDocs();
    renderLinks();
  }
  if (a === "delete") {
    if (
      !confirm(
        `Delete “${d.title}”?${d.kind === "file" ? " The stored file is deleted too." : ""}`,
      )
    )
      return;
    try {
      await getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "DELETE",
      });
    } catch {}
    state.docs = state.docs.filter((x) => x !== d);
    renderDocs();
    toast("Doc deleted");
  }
  if (a === "task") {
    const item = (d.action_items || [])[Number(b.dataset.item)];
    if (!item) return;
    const day = item.due || todayKey;
    try {
      await getJSON("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "daily_task",
          dayKey: day,
          name: `${item.text} — ${d.title}`.slice(0, 200),
        }),
      });
      if (day === todayKey) await loadTasks();
      renderDashboard();
      toast(
        day === todayKey
          ? "Added to today's tasks"
          : `Added to your tasks for ${shortDate(day)}`,
      );
    } catch (err) {
      toast(err.message || "Could not add the task");
    }
  }
}
function openAddDocDialog() {
  const lastFrom = readLocal("taskdash_doc_from", "");
  openDialog({
    kicker: "DOCS",
    title: "Add a doc",
    fields: [
      [
        "file",
        "Upload a file (PDF, Word, Excel, PowerPoint — up to 4 MB)",
        "file",
        "",
      ],
      [
        "url",
        "…or paste a Google Doc / Drive link",
        "url",
        "https://docs.google.com/…",
      ],
      ["title", "Title (optional)", "text", "Claude will suggest one"],
      ["from", "From", "text", "Who sent it?", lastFrom],
      [
        "note",
        "Note (optional)",
        "textarea",
        "What did your manager say about it?",
      ],
    ],
    submit: async (v) => {
      const file = $("#dialogForm").elements.file.files[0],
        url = v.url.trim();
      if (!file && !url) throw new Error("Choose a file or paste a link");
      if (file && file.size > 4 * 1024 * 1024)
        throw new Error(
          "That file is over 4 MB. Save it to Google Drive and paste the link instead.",
        );
      writeLocal("taskdash_doc_from", v.from.trim());
      const meta = {
        title: v.title.trim(),
        from: v.from.trim(),
        note: v.note.trim(),
      };
      $("#dialogSubmit").textContent = "Reading the doc…";
      const r = file
        ? await getJSON(`/api/docs?dayKey=${todayKey}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Doc-Meta": encodeURIComponent(
                JSON.stringify({ ...meta, name: file.name, type: file.type }),
              ),
            },
            body: file,
          })
        : await getJSON("/api/docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...meta, url, dayKey: todayKey }),
          });
      state.docs.unshift(r.doc);
      renderDocs();
      setTimeout(() => openDocReview(r.doc, r.suggestion), 60);
    },
  });
  $("#dialogSubmit").textContent = "Add doc";
}
// Review (or edit) how a doc is filed. `suggestion` is Claude's, if any.
function openDocReview(d, suggestion) {
  if (suggestion?.error) toast(`Claude couldn't sort it: ${suggestion.error}`);
  const s = suggestion && !suggestion.error ? suggestion : {},
    cats = state.docCategories.length ? state.docCategories : ["Other"],
    items = s.action_items || d.action_items || [];
  openDialog({
    kicker:
      suggestion && !suggestion.error
        ? "CLAUDE'S SUGGESTION · REVIEW"
        : "FILE THIS DOC",
    title: "Where does this go?",
    fields: [
      ["title", "Title", "text", "", s.title || d.title],
      [
        "category",
        "Category",
        "select",
        cats,
        s.category || d.category || cats.at(-1),
      ],
      [
        "summary",
        "Summary",
        "textarea",
        "What it is and why it matters",
        s.summary || d.summary || "",
      ],
      [
        "tags",
        "Tags (comma separated)",
        "text",
        "events, michelle, q4",
        (s.tags || d.tags || []).join(", "),
      ],
      ["from", "From", "text", "Who sent it?", d.from_person || ""],
      [
        "actions",
        "Action items (one per line; add | YYYY-MM-DD for a due date)",
        "textarea",
        "Send RSVP list to Michelle | 2026-10-15",
        items.map((a) => (a.due ? `${a.text} | ${a.due}` : a.text)).join("\n"),
      ],
      [
        "pinned",
        "Pin to the top of Docs and the Resource hub",
        "checkbox",
        !!d.pinned,
      ],
    ],
    submit: async (v) => {
      const body = {
        title: v.title.trim(),
        category: v.category,
        summary: v.summary.trim(),
        tags: v.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        from: v.from.trim(),
        actionItems: v.actions
          .split("\n")
          .map((line) => {
            const [text, due] = line.split("|").map((x) => x.trim());
            return {
              text,
              due: /^\d{4}-\d{2}-\d{2}$/.test(due || "") ? due : "",
            };
          })
          .filter((a) => a.text),
        pinned: v.pinned,
        status: "filed",
      };
      const saved = await getJSON(`/api/docs?id=${encodeURIComponent(d.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      Object.assign(d, saved);
      renderDocs();
      renderLinks();
      toast("Doc filed");
    },
  });
  $("#dialogSubmit").textContent = "File it";
}
