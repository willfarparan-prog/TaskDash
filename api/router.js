// Every /api/* request comes through this one function (vercel.json rewrites
// /api/<route> here), so Task Dash stays a single Vercel function however
// many routes it grows. Handlers live in lib/routes/ and load on first use;
// the requires are spelled out so Vercel bundles each handler.
const { reportError } = require("../lib/errors");

const ROUTES = {
  assistant: () => require("../lib/routes/assistant"),
  "auth/start": () => require("../lib/routes/auth-start"),
  "auth/callback": () => require("../lib/routes/auth-callback"),
  "calendar-manual": () => require("../lib/routes/calendar-manual"),
  "calendar-week": () => require("../lib/routes/calendar-week"),
  clients: () => require("../lib/routes/clients"),
  connections: () => require("../lib/routes/connections"),
  docs: () => require("../lib/routes/docs"),
  errors: () => require("../lib/routes/errors"),
  events: () => require("../lib/routes/events"),
  inbox: () => require("../lib/routes/inbox"),
  links: () => require("../lib/routes/links"),
  "meal-plans": () => require("../lib/routes/meal-plans"),
  programs: () => require("../lib/routes/programs"),
  tasks: () => require("../lib/routes/tasks"),
  workouts: () => require("../lib/routes/workouts"),
};

async function router(req, res) {
  const route = String(req.query.__route || "").replace(/^\/+|\/+$/g, "");
  delete req.query.__route;
  const load = ROUTES[route];
  if (!load) return res.status(404).json({ error: "Not found" });
  // Record any 5xx a handler sends, so failures show on the Connections page.
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) reportError(route, body?.error || "Server error");
    return json(body);
  };
  try {
    return await load()(req, res);
  } catch (err) {
    reportError(route, err.message, err.stack);
    if (res.headersSent) return;
    res.status(500);
    json({ error: err.message }); // the unwrapped json: already recorded above
  }
}

module.exports = router;
module.exports.ROUTES = ROUTES;
