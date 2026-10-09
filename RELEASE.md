# Task Dash finishing release

Base: e5812fd (latest main at review time). Target: existing personal Vercel task-dash project, Node 22, https://task-dash-umber.vercel.app. Existing account permissions and production secrets are retained.

Changes: recoverable program drafts and stale-edit protection; task failure rollback and Tomorrow; linked follow-up queue; conflict-safe booking insertion, stable calendar retries and verified cancellation; private JSON exports; calendar-required booking default and durable attempt limits; mobile search and dashboard hierarchy; allowlisted static output. Existing Docs, hub chat, consultations, live sessions, wrap-up and recurrence features are preserved.

Validation: npm run build passes, including 152 tests and JavaScript/deployment checks. Browser-tested local partial exercise-note recovery across refresh and saving the recovered program. Dependency install reports zero vulnerabilities. Tests mock database/Google boundaries. Production smoke results will be appended after release.

Limitations: full authenticated Neon/Google write verification requires the approved account's interactive session. Backups export records and document metadata, not private document binaries; import/restore rehearsal and an automatic sync worker remain future work. See REVIEW.md.

## Production verification — October 9, 2026

Promoted deployment dpl_FudzVFUrx7krQQBs5EPaM4hbfGq2 (code commit cdf100e), https://task-dash-29bx10nf2-willfarparan-7346s-projects.vercel.app, to https://task-dash-umber.vercel.app. Vercel reports READY, Node 22, one API router, and public/ output. The remote build ran all 152 tests successfully; an earlier remote-only test assumption was repaired by checking generated assets instead of .gitignore.

Live checks: dashboard, booking page and program module return 200; served program code matches this checkout; work-calendar availability returns 200 with calendarConnected=true and paused=false; unauthenticated tasks and export return 401; invalid booking submission returns 400 without a reservation; package.json returns 404; server-code paths redirect away from source. Canonical production domain serves the verified new code after promotion. No customer records or Google events were created or deleted during these smoke checks.

The production browser is signed out. A full private create/edit and Google booking write cycle remains unverified interactively; automated tests cover those boundaries. Sign in with an approved Google account for normal use.
