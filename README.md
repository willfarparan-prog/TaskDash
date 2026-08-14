# TaskDash — Coach Dashboard (Exos @ Adobe SF)

A personal task console for the SF wellness-center coach role. Static single-file app (no build step) so it deploys to Vercel as-is and opens instantly on a work computer.

## What's in v1
- Recurring engine seeded from the Exos/Adobe SOP cadence (daily / weekly / monthly / quarterly).
- Today panel with a color status rail (amber = due, red = overdue, green = done) as a peripheral-glance reminder.
- Event pipeline — set a date and all 8 steps back-fill (room, flyer, catering, Slack posts).
- Add task inline; state persists in the browser (localStorage).
- Placeholders wired for the next pass: read-only Google Calendar feeds (personal + work) and the Claude drafting assistant.

## Deploy to Vercel (no CLI needed)
1. Vercel: Add New, Project, Import this repo.
2. Framework preset: Other. No build command; output = repo root.
3. Deploy, then bookmark the .vercel.app URL on your work computer.

## Next
- Neon Postgres for multi-device sync + server-side recurring generation.
- Google Calendar read-only feeds (personal + work).
- Claude API assistant for newsletter / Slack-post drafting.
