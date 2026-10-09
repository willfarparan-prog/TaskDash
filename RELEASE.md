# Task Dash finishing release

Base: e5812fd (latest main at review time). Target: existing personal Vercel task-dash project, Node 22, https://task-dash-umber.vercel.app. Existing account permissions and production secrets are retained.

Changes: recoverable program drafts and stale-edit protection; task failure rollback and Tomorrow; linked follow-up queue; conflict-safe booking insertion, stable calendar retries and verified cancellation; private JSON exports; calendar-required booking default and durable attempt limits; mobile search and dashboard hierarchy; allowlisted static output. Existing Docs, hub chat, consultations, live sessions, wrap-up and recurrence features are preserved.

Validation: npm run build passes, including 152 tests and JavaScript/deployment checks. Browser-tested local partial exercise-note recovery across refresh and saving the recovered program. Dependency install reports zero vulnerabilities. Tests mock database/Google boundaries. Production smoke results will be appended after release.

Limitations: full authenticated Neon/Google write verification requires the approved account's interactive session. Backups export records and document metadata, not private document binaries; import/restore rehearsal and an automatic sync worker remain future work. See REVIEW.md.

## Production verification — October 9, 2026

Promoted deployment dpl_FudzVFUrx7krQQBs5EPaM4hbfGq2 (code commit cdf100e), https://task-dash-29bx10nf2-willfarparan-7346s-projects.vercel.app, to https://task-dash-umber.vercel.app. Vercel reports READY, Node 22, one API router, and public/ output. The remote build ran all 152 tests successfully; an earlier remote-only test assumption was repaired by checking generated assets instead of .gitignore.

Live checks: dashboard, booking page and program module return 200; served program code matches this checkout; work-calendar availability returns 200 with calendarConnected=true and paused=false; unauthenticated tasks and export return 401; invalid booking submission returns 400 without a reservation; package.json returns 404; server-code paths redirect away from source. Canonical production domain serves the verified new code after promotion. No customer records or Google events were created or deleted during these smoke checks.

The production browser is signed out. A full private create/edit and Google booking write cycle remains unverified interactively; automated tests cover those boundaries. Sign in with an approved Google account for normal use.


## Save reliability release — October 9, 2026

Serialized consultation, live-session, report and event-draft saves now drain edits made during an in-flight request before acknowledging Saved. Failed consultation navigation and session close/finish preserve the open draft; recoverable device drafts survive reload, explicit Retry save controls sync them, and leaving with unsynced work warns the user. Reports and event drafts persist immediately while typing. A read-outage banner distinguishes last-loaded records from live data; failed production task reads no longer invent preview duties. Storage failure is reported without claiming a device copy exists.

Session creation uses a stable request key backed by a unique client/key index, making a lost-response retry return the original log. Finishing uses one transaction holding the log row lock through its history insert and completion, preventing duplicate history and rolling back partial completion. The additive schema update runs through the existing schema-version migration mechanism.

Validation: build and all 165 checks passed locally and in Vercel. Isolated browser tests confirmed failed Save & close leaves the session open with notes, retry saves it, consultation save failure blocks false-success navigation, and report notes survive failure plus reload. Production deployment dpl_AVCq8wCoqxShjw9FxbNHWXDnhsT9 at https://task-dash-h4aivbsea-willfarparan-7346s-projects.vercel.app was READY and promoted to the canonical domain. Its served session module matched this checkout, and live booking availability returned 200, calendarConnected=true, paused=false, with 22 days. No booking was made in this check.

Authenticated production verification used only the new client “Task Dash Verification 2026-10-09” (client 3, consultation 2) and its copied program 62. Verified intake save/reload, completion decision, program attachment/edit/save, session save/close/resume retaining test weight/reps/notes, finish producing one history entry, progression to Day 2, and a wrap-up checkbox surviving reload. The test checkbox was reset afterward. A clearly named test booking for October 30, 2026, 9–10 AM Pacific appeared both as On work calendar in Scheduler and in the Google-backed calendar week. Cancellation removed the booking from Scheduler and restored its original 9 AM slot on a freshly loaded public booking page.

The user explicitly approved cleanup. Deleted copied program 62 and test client 3 with its dependent consult/session records through the dashboard. Fresh production loads show no matching client or program and retain the original one-client roster. The cancelled booking remains an audit record in the database, as designed. Customer records were not changed. No email, invoice, or external sheet submission was sent.

The live checks also exposed native browser-confirmation limitations. Client/program deletion and booking cancellation now use the dashboard dialog. A failed production program delete keeps the program/editor and reports failure rather than claiming success. Client removal filters by ID, preserving correct behavior if a refresh replaces object references while deletion is in flight. Local build passes 166 checks. Git release 2456064 deployed READY as dpl_C7MCsUVX6qK9QhZQk4HmBwT723MQ, https://task-dash-qtmgj8znm-willfarparan-7346s-projects.vercel.app; canonical served core code matched the checkout. The final documentation commit carries the ID-filter correction through the same production build pipeline.

## Editable event dates — October 9, 2026

Each existing event now has a Change date action with its current date prefilled. Saving updates only event_date, recalculates all SOP and survey deadlines, and refreshes the dashboard preview. Completed steps, survey counts, drafts and reports remain intact, including unsynced in-memory edits. The dialog explains that existing message text and external room/vendor/calendar bookings should be reviewed separately. Failed saves retain the old date and leave the chosen replacement in the dialog for retry. API validation rejects impossible calendar dates and reports missing events.

Validation: 170 tests and the production build pass. An isolated browser event was moved from October 7 to November 18; its completed step remained checked and its deadlines moved accordingly. Reload retained the new date. A forced save failure for November 25 left the saved date at November 18 and the dialog open. Production customer event dates were not changed for testing.
