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

Dashboard ownership remains restricted to `willfarparan@gmail.com`. The callback verifies the returned Google identity before saving tokens. A signed, HTTP-only session cookie protects every private read and write, including tasks, events, client records, programs, calendar data, inbox data, private work links, connection health, and scheduler settings. Cross-site mutations are rejected and Vercel applies restrictive browser security headers.

The Scheduler has a second, purpose-limited Google connection restricted to `william.farparan@teamexos.com`. It is used only to read busy work-calendar events and create or remove Task Dash booking events. Future work Docs and Sheets connections should follow this same pattern: ownership stays personal, while explicitly approved work data is accessed through a separate purpose-limited work authorization. Visitors never sign in and never receive dashboard access.

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
- `ANTHROPIC_API_KEY` (optional)

Copy `.env.example` for local setup. Keep the database, OAuth application, GitHub repository, and Vercel project in the personal account. Work-account permissions should be added only as separate, purpose-limited OAuth connections; never change the dashboard owner email to the work account.

The production Google OAuth redirect URI must remain:

`https://task-dash-umber.vercel.app/api/auth/callback`

## Local checks

```bash
npm install
npm run check
python3 -m http.server 4173
```

The static preview intentionally falls back to browser-local demo data when serverless APIs are unavailable. Production writes require the signed owner session.
