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

Authenticated production verification used only the new client “Task Dash Verification 2026-10-09” (client 3, consultation 2) and its attached template copy. Verified intake save/reload, completion decision, program attachment/edit/save, and session save/close/resume retaining test weight/reps/notes. Clicking Finish session blocked the browser; completion/history/wrap-up and a real booking/calendar/cancellation cycle remain pending. Test records still exist pending cleanup approval; customer records were not changed. No email, invoice, or external sheet submission was sent.
