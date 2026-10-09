// SOP library logic, shared by the browser (window.Sops), the API and the
// tests: the tab list, turning a database row into what the page shows, and
// searching the library.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sops = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TABS = [
    { key: "daily", label: "Daily & Weekly" },
    { key: "members", label: "Members & PT" },
    { key: "events", label: "Events & Marketing" },
    { key: "reporting", label: "Reporting & Month-End" },
    { key: "facility", label: "Facility & Safety" },
    { key: "hr", label: "HR & Policy" },
    { key: "contacts", label: "Who to Ask" },
  ];
  const tabLabel = (key) => TABS.find((t) => t.key === key)?.label || key;

  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const list = (v, max, length) =>
    (Array.isArray(v) ? v : []).map((t) => text(t, length)).filter(Boolean).slice(0, max);
  // A step is plain text, or { t, sub: [...] } for a step with sub-steps.
  function cleanStep(step) {
    if (typeof step === "string") return text(step, 1200);
    if (!step || typeof step.t !== "string") return null;
    return { t: text(step.t, 400), sub: list(step.sub, 30, 700) };
  }

  // A database row → the shape the page uses.
  function fromRow(row) {
    const body = row.body && typeof row.body === "object" ? row.body : {};
    return {
      id: String(row.id),
      tab: String(row.tab),
      title: text(row.title, 200),
      summary: text(row.summary, 400),
      when: text(row.when_text, 300),
      keywords: text(row.keywords, 600),
      links: Array.isArray(row.links) ? row.links.map(String) : [],
      steps: (Array.isArray(body.steps) ? body.steps : [])
        .map(cleanStep)
        .filter(Boolean)
        .slice(0, 40),
      notes: list(body.notes, 12, 900),
      warnings: list(body.warnings, 8, 900),
      templates: (Array.isArray(body.templates) ? body.templates : [])
        .map((t) => ({ label: text(t?.label, 120), text: text(t?.text, 6000) }))
        .filter((t) => t.label && t.text)
        .slice(0, 8),
      app: (Array.isArray(body.app) ? body.app : [])
        .map((a) => ({ view: text(a?.view, 40), label: text(a?.label, 120) }))
        .filter((a) => a.view && a.label)
        .slice(0, 3),
    };
  }

  const stepText = (s) => (typeof s === "string" ? s : `${s.t} ${(s.sub || []).join(" ")}`);
  const firstStep = (sop) => {
    const s = sop.steps[0];
    return s ? (typeof s === "string" ? s : s.t) : "";
  };

  // Search: every word must appear somewhere; title matches rank first, then
  // keywords and summary, then the steps themselves.
  function search(sops, query) {
    const words = String(query || "")
      .toLowerCase()
      .split(/[^a-z0-9$%]+/)
      .filter((w) => w.length > 1);
    if (!words.length) return sops;
    return sops
      .map((sop) => {
        const title = sop.title.toLowerCase(),
          near = `${sop.summary} ${sop.keywords} ${tabLabel(sop.tab)}`.toLowerCase(),
          body = `${sop.steps.map(stepText).join(" ")} ${sop.notes.join(" ")} ${sop.warnings.join(" ")}`.toLowerCase();
        let score = 0;
        for (const w of words) {
          const here = title.includes(w) ? 10 : near.includes(w) ? 4 : body.includes(w) ? 1 : 0;
          if (!here) return { sop, score: 0 };
          score += here;
        }
        return { sop, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.sop.title.localeCompare(b.sop.title))
      .map((x) => x.sop);
  }

  const countByTab = (sops) =>
    Object.fromEntries(TABS.map((t) => [t.key, sops.filter((s) => s.tab === t.key).length]));

  return { TABS, tabLabel, fromRow, firstStep, search, countByTab };
});
