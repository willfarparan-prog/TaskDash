// Resource hub: the SOP library (tabs, search, pop-up instructions) and the
// "Ask the hub" chat. SOPs are private and live in the database.
const SOP_STARTERS = [
  "Where do I start my shift?",
  "A member wants to start PT",
  "Plan an event",
  "Month-end reports",
];
async function loadSops() {
  try {
    const data = await getJSON("/api/sops");
    state.sops = data.sops || [];
    state.sopTabs = data.tabs || Sops.TABS;
    state.sopError = "";
  } catch (e) {
    state.sops = [];
    state.sopError = e.message;
  }
}
const sopById = (id) => state.sops.find((s) => s.id === id);
const sopLinkById = (id) => state.links.find((l) => String(l.id) === String(id));

function renderSops() {
  const card = $("#hubTools");
  if (!card) return;
  card.hidden = !state.sops.length;
  if (!state.sops.length) return;
  const q = state.sopQuery.trim(),
    tabs = state.sopTabs,
    counts = Sops.countByTab(state.sops),
    searching = !!q,
    list = searching
      ? Sops.search(state.sops, q)
      : state.sops.filter((s) => s.tab === state.sopTab);
  $("#sopTabs").innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="${!searching && state.sopTab === t.key ? "active" : ""}" data-sop-tab="${attr(t.key)}">${esc(t.label)}<small>${counts[t.key] || 0}</small></button>`,
    )
    .join("");
  $("#sopList").innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<button type="button" class="sop-item" data-sop="${attr(s.id)}"><strong>${esc(s.title)}</strong><small>${esc(searching ? `${Sops.tabLabel(s.tab)} · ${s.summary}` : s.summary)}</small></button>`,
        )
        .join("")
    : '<div class="empty-state compact">No SOP matches that search.</div>';
  renderHubChat();
}

// ----- The SOP pop-up -----
function sopStepHTML(step) {
  if (typeof step === "string") return `<li>${esc(step)}</li>`;
  return `<li>${esc(step.t)}${step.sub?.length ? `<ul>${step.sub.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</li>`;
}
function openSop(id) {
  const s = sopById(id),
    d = $("#sopDialog");
  if (!s || !d) return;
  const links = s.links.map(sopLinkById).filter(Boolean);
  d.innerHTML = `<div class="modal-head"><div><span class="kicker">${esc(Sops.tabLabel(s.tab).toUpperCase())}</span><h2>${esc(s.title)}</h2><small>${esc(s.summary)}</small></div><button class="icon-btn" type="button" data-sop-close aria-label="Close">×</button></div>
  <div class="sop-body">
    ${s.when ? `<p class="sop-when"><b>When:</b> ${esc(s.when)}</p>` : ""}
    ${s.warnings.map((w) => `<p class="sop-warning">${esc(w)}</p>`).join("")}
    ${s.steps.length ? `<ol class="sop-steps">${s.steps.map(sopStepHTML).join("")}</ol>` : ""}
    ${s.notes.length ? `<div class="sop-notes"><h3>Good to know</h3><ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    ${s.templates.map((t, i) => `<div class="sop-template"><div><b>${esc(t.label)}</b><button type="button" class="text-btn" data-sop-copy="${i}">Copy</button></div><pre>${esc(t.text)}</pre></div>`).join("")}
    ${links.length || s.app.length ? `<div class="sop-links"><h3>Open</h3><div>${links.map((l) => `<a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ↗</a>`).join("")}${s.app.map((a) => `<button type="button" data-sop-app="${attr(a.view)}">${esc(a.label)} →</button>`).join("")}</div></div>` : ""}
  </div>`;
  d.dataset.sop = s.id;
  if (!d.open) d.showModal();
  d.querySelector(".sop-body").scrollTop = 0;
}
function wireSopDialog() {
  const d = $("#sopDialog");
  d.onclick = (e) => {
    if (e.target === d || e.target.closest("[data-sop-close]")) return d.close();
    const copy = e.target.closest("[data-sop-copy]");
    if (copy) {
      const t = sopById(d.dataset.sop)?.templates[+copy.dataset.sopCopy];
      navigator.clipboard
        ?.writeText(t?.text || "")
        .then(() => toast("Copied"))
        .catch(() => toast("Couldn't copy"));
      return;
    }
    const app = e.target.closest("[data-sop-app]");
    if (app) {
      d.close();
      go(app.dataset.sopApp);
    }
  };
}

// ----- Ask the hub -----
function renderHubChat() {
  const box = $("#hubChatLog");
  if (!box) return;
  const turns = state.hubChat;
  box.innerHTML = turns.length
    ? turns
        .map((m) => {
          if (m.role === "user") return `<div class="hub-msg me">${esc(m.content)}</div>`;
          const sops = (m.sopIds || []).map(sopById).filter(Boolean),
            links = (m.linkIds || []).map(sopLinkById).filter(Boolean);
          return `<div class="hub-msg bot${m.error ? " error" : ""}"><p>${esc(m.content)}</p>${
            sops.length || links.length
              ? `<div class="hub-picks">${sops.map((s) => `<button type="button" data-sop="${attr(s.id)}">📋 ${esc(s.title)}</button>`).join("")}${links.map((l) => `<a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)} ↗</a>`).join("")}</div>`
              : ""
          }</div>`;
        })
        .join("") + (state.hubBusy ? '<div class="hub-msg bot pending">Looking…</div>' : "")
    : `<p class="hub-hint">Not sure where to start? Say what you're working on and I'll point you to the right guide and links.</p><div class="hub-starters">${SOP_STARTERS.map((t) => `<button type="button" data-hub-ask="${attr(t)}">${esc(t)}</button>`).join("")}</div>`;
  box.scrollTop = box.scrollHeight;
  $("#hubChatSend").disabled = state.hubBusy;
}
async function askHub(text) {
  text = String(text || "").trim();
  if (!text || state.hubBusy) return;
  state.hubChat.push({ role: "user", content: text });
  state.hubBusy = true;
  $("#hubChatInput").value = "";
  renderHubChat();
  try {
    const messages = state.hubChat
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
    const r = await getJSON("/api/hub-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    state.hubChat.push({ role: "bot", content: r.answer, sopIds: r.sopIds, linkIds: r.linkIds });
  } catch (e) {
    state.hubChat.push({ role: "bot", content: e.message || "Something went wrong.", error: true });
  }
  state.hubChat = state.hubChat.slice(-12);
  state.hubBusy = false;
  renderHubChat();
}
function wireHubTools() {
  const card = $("#hubTools");
  if (!card) return;
  wireSopDialog();
  $("#sopSearch").oninput = (e) => {
    state.sopQuery = e.target.value;
    renderSops();
  };
  card.onclick = (e) => {
    const tab = e.target.closest("[data-sop-tab]");
    if (tab) {
      state.sopTab = tab.dataset.sopTab;
      state.sopQuery = "";
      $("#sopSearch").value = "";
      return renderSops();
    }
    const sop = e.target.closest("[data-sop]");
    if (sop) return openSop(sop.dataset.sop);
    const ask = e.target.closest("[data-hub-ask]");
    if (ask) askHub(ask.dataset.hubAsk);
    if (e.target.closest("#hubChatClear")) {
      state.hubChat = [];
      renderHubChat();
    }
  };
  $("#hubChatForm").onsubmit = (e) => {
    e.preventDefault();
    askHub($("#hubChatInput").value);
  };
}
