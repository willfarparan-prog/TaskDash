# Task Dash — Coach Command Center

Task Dash is William Farparan's private Exos at Adobe SF operating dashboard. It uses an Apex Coach–inspired left rail and a focused daily command center for tasks, client sessions, training programs, calendars, priority inbox items, events, and integration health.

## Product areas

- **Dashboard:** daily overview, operating queue, week agenda, event progress, connection readiness, and a quick-link preview.
- **Resource hub:** a dedicated sidebar destination for every private tracker, SOP, form, inbox, and recurring work link from the source sheet, with search and task-based filters.
- **Calendar:** read-only Google Calendar plus manual Adobe/Exos work blocks.
- **Scheduler:** a permanent, no-sign-in public booking link with live availability, configurable work hours, visit reasons, booking tracking, and work-calendar conflict protection.
- **Training programs:** client-linked, multi-day program builder with warm-ups, lettered blocks, week-by-week prescriptions, print-ready day sheets, and independent reusable stock templates.
- **Clients:** PT consult, InBody, and personal-training roster with session history and follow-ups.
- **Inbox:** unread important/starred Google mail, with an Adobe Microsoft connection held as a separate future authorization.
- **Events:** the Exos event SOP with exact due dates, compressed-timeline rules, vendor escalation, attendance capture, and post-event survey follow-up.
- **Connections:** live integration status, API runs, token totals, and reported credits.
- **Settings:** local daily-overview and print preferences.

The resource hub keeps URLs in the private `links` database table, not in the public frontend bundle. It includes task-based filters, frequent shortcuts, source descriptions, usage frequency, and contextual links on matching recurring tasks.

## Account and privacy rules

Infrastructure ownership remains restricted to `willfarparan@gmail.com`. Both `willfarparan@gmail.com` and the approved work operator `william.farparan@teamexos.com` can create a signed dashboard session after Google verifies the returned identity. The work-operator sign-in requests identity scopes only and does not replace the personal Calendar/Gmail token. A signed, HTTP-only session cookie protects every private read and write, including tasks, events, client records, programs, calendar data, inbox data, private work links, connection health, and scheduler settings. Cross-site mutations are rejected and Vercel applies restrictive browser security headers.

The Scheduler has a second, purpose-limited Google connection restricted to `william.farparan@teamexos.com`. It is used only to read busy work-calendar events and create or remove Task Dash booking events. Google Workspace shortcuts explicitly select the work account in the browser, while each underlying file still enforces its own sharing permissions. Future API-based work Docs and Sheets connections should follow this same pattern: ownership stays personal, while explicitly approved work data is accessed through a separate purpose-limited work authorization. Visitors never sign in and never receive dashboard access.

Personal Google scopes are read-only:

- `calendar.readonly`
- `gmail.readonly`

The work calendar connection uses:

- `calendar.events`

Microsoft is not connected automatically. It remains a separate, visible connection until the Adobe work account and an approved Microsoft OAuth application are available.

## Runtime

The frontend is a buildless static app (`index.html`, `styles.css`, `app.js`) deployed on Vercel. Node serverless functions in `api/` use Postgres through the `neon` or `DATABASE_URL` environment variable.

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
