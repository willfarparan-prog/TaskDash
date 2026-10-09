# Task Dash — Coach Command Center

Task Dash is William Farparan's private Exos at Adobe SF operating dashboard. It uses an Apex Coach–inspired left rail and a focused daily command center for tasks, client sessions, training programs, calendars, priority inbox items, events, and integration health.

## Product areas

- **Dashboard:** daily overview, an operating queue of scheduled tasks (daily, weekdays, weekly, every 2 weeks or monthly, with early notice and a Claude-powered Smart add), week agenda, event progress, connection readiness, and a quick-link preview.
- **Resource hub:** a dedicated sidebar destination for every private tracker, SOP, form, inbox, and recurring work link from the source sheet, with search and task-based filters.
- **Calendar:** read-only Google Calendar plus manual Adobe/Exos work blocks.
- **Scheduler:** a permanent, no-sign-in public booking link with live availability, configurable work hours, visit reasons, booking tracking, and work-calendar conflict protection.
- **Training programs:** client-linked, multi-day program builder with warm-ups, lettered blocks, week-by-week prescriptions, print-ready day sheets, and independent reusable stock templates.
- **Session wrap-up:** finishing a personal-training session (or logging one by hand) opens its four follow-up steps: the San Francisco Working Doc (a link), the Unredeemed PT Session Log (copy the client's new Total Used and Date of Last Session Redeemed, which sit side by side on their row), Workday (the exact line, for example `Derick Ngan: 10 sessions - 50min (9/10) - $44.65`, plus the override rate), and the paper signature form. A new package is added to the log with two pastes (name through purchase date, then sessions purchased) so the log's formula columns are never overwritten. Task Dash builds what to paste, links to each place and tracks which steps are done; it never writes to those systems. Package size, price and start date live on the client so "9/10" is automatic. Pay and override rates by session length, the links and the column layouts are set under Settings → Session wrap-up and follow William between devices.
- **PT consults:** the 14-question consult form (plus experience and goal questions) lives on its own screen (`#consult/<id>`), autosaves as you type, and can be started from the Clients page, a client's profile, or a "PT consultation" booking in Scheduler. Finishing asks whether they're starting personal training; on Yes it switches them to a Personal training client, starts the new-client checklist, suggests the three best stock programs for their days and goals, can have Claude build a custom program around their goal, injuries and preferences (reviewed before anything attaches), and pre-fills the meal plan questionnaire.
- **Wellbeing Strategy report:** the last step on an event card. Paste the Microsoft Forms results (names and emails are ignored and comments are never stored) and enter the head count; Task Dash computes the NPS, response count and Goal Met / Not Met itself, Claude drafts the description, takeaways and a Yes/No suggestion, and the finished text for the report sheet is one Copy away. Set the site name and the strategy wording under "Report settings".
- **Clients:** PT consult, InBody, and personal-training roster with session history and follow-ups.
- **Client programs and live sessions:** a client's profile attaches programs as independent copies (from the stock library or another client's program; the original is never changed), shows a day × week progress grid, and runs live sessions that log weight and reps per set. Each session pre-suggests the client's last weights (never logged until confirmed), exercises can be swapped, removed or added mid-session (for today only, or saved into the client's own copy), and the profile tracks last/best weights, trends and PRs per exercise.
- **Inbox:** unread important/starred mail from the personal Gmail and the Exos work Gmail (`william.farparan@teamexos.com`), with an Adobe Microsoft connection held as a separate future authorization.
- **Events:** the Exos event SOP with exact due dates, compressed-timeline rules, vendor escalation, attendance capture, and post-event survey follow-up.
- **Connections:** live integration status, API runs, token totals, and reported credits.
- **Settings:** local daily-overview and print preferences.

The resource hub keeps URLs in the private `links` database table, not in the public frontend bundle. It includes task-based filters, frequent shortcuts, source descriptions, usage frequency, and contextual links on matching recurring tasks.

## Account and privacy rules

Infrastructure ownership remains restricted to `willfarparan@gmail.com`. Both `willfarparan@gmail.com` and the approved work operator `william.farparan@teamexos.com` can create a signed dashboard session after Google verifies the returned identity. The work-operator sign-in requests identity scopes only and does not replace the personal Calendar/Gmail token. A signed, HTTP-only session cookie protects every private read and write, including tasks, events, client records, programs, calendar data, inbox data, private work links, connection health, and scheduler settings. Cross-site mutations are rejected and Vercel applies restrictive browser security headers.

The Scheduler has a second, purpose-limited Google connection restricted to `william.farparan@teamexos.com`. It reads the work inbox's unread important and starred messages for the Inbox page (read-only Gmail; nothing is stored), and it is used to read work-calendar events (busy times for booking conflicts, and event titles shown in purple on the Calendar page; nothing is stored) and to create or remove Task Dash booking events. Google Workspace shortcuts explicitly select the work account in the browser, while each underlying file still enforces its own sharing permissions. Future API-based work Docs and Sheets connections should follow this same pattern: ownership stays personal, while explicitly approved work data is accessed through a separate purpose-limited work authorization. Visitors never sign in and never receive dashboard access.

Personal Google scopes are read-only:

- `calendar.readonly`
- `gmail.readonly`

The work connection uses:

- `calendar.events`
- `gmail.readonly`

Microsoft is not connected automatically. It remains a separate, visible connection until the Adobe work account and an approved Microsoft OAuth application are available.

## Runtime

The frontend is a buildless static app deployed on Vercel: `index.html` loads one script per feature from `js/` (in order; `js/core.js` first, since the others use its helpers and state) and one stylesheet per feature from `css/` (order matters for the cascade). The booking page is `book.html`/`book.js`/`book.css`.

The API is a single Vercel function: `vercel.json` rewrites every `/api/<route>` to `api/router.js`, which loads the matching handler from `lib/routes/`. Add a route by creating `lib/routes/<name>.js` and listing it in the router; `tests/deployLimits.test.js` checks they match. Handlers use Postgres through the `neon` or `DATABASE_URL` environment variable. Server errors and browser errors are recorded in `app_errors` and listed on the Connections page.

`npm run check` syntax-checks every file and runs the unit tests; `npm run format` applies Prettier; `npm run smoke` drives the real app in Chrome against a fake API (see `scripts/smoke.js`).

Required environment variables:

- `neon` or `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DASHBOARD_SESSION_SECRET` (required; use a dedicated random value)
- `WORK_SOURCE_LINKS_JSON` (private server-side Resource Hub catalog)
- `ANTHROPIC_API_KEY` (optional)

Copy `.env.example` for local setup. Keep the database, OAuth application, GitHub repository, and Vercel project in the personal account. The work account is an approved dashboard operator and may use separate, purpose-limited OAuth connections; it does not own the deployment infrastructure.

`WORK_SOURCE_LINKS_JSON` is an array of link records with `id`, `title`, `category`, and `url`, plus optional `short`, `description`, `frequency`, `pinned`, and `sort` fields. The server validates and upserts the catalog into Neon during schema initialization. This keeps work URLs in Vercel and Neon rather than the public repository or browser bundle.

The production Google OAuth redirect URI must remain:

`https://task-dash-umber.vercel.app/api/auth/callback`

## Local checks

```bash
npm install
npm run check
python3 -m http.server 4173
```

The static preview intentionally falls back to browser-local demo data when serverless APIs are unavailable. Production writes require the signed owner session.

## Finishing release

`npm run build` validates the code and tests, then copies only browser assets to `public/`. Vercel serves that directory and the existing API router. The finishing release adds recoverable program drafts, stale-edit conflicts, Tomorrow rescheduling, a linked follow-up queue, safe calendar-sync retries, verified cancellation, and private JSON exports from Settings. Public booking pauses when work-calendar checks are unavailable unless the owner explicitly permits local-only booking. See `REVIEW.md` and `RELEASE.md` for review scope and validation.
