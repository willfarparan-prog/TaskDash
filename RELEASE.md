# Task Dash finishing release

Base: e5812fd (latest main at review time). Target: existing personal Vercel task-dash project, Node 22, https://task-dash-umber.vercel.app. Existing account permissions and production secrets are retained.

Changes: recoverable program drafts and stale-edit protection; task failure rollback and Tomorrow; linked follow-up queue; conflict-safe booking insertion, stable calendar retries and verified cancellation; private JSON exports; calendar-required booking default and durable attempt limits; mobile search and dashboard hierarchy; allowlisted static output. Existing Docs, hub chat, consultations, live sessions, wrap-up and recurrence features are preserved.

Validation: npm run build passes, including 152 tests and JavaScript/deployment checks. Browser-tested local partial exercise-note recovery across refresh and saving the recovered program. Dependency install reports zero vulnerabilities. Tests mock database/Google boundaries. Production smoke results will be appended after release.

Limitations: full authenticated Neon/Google write verification requires the approved account's interactive session. Backups export records and document metadata, not private document binaries; import/restore rehearsal and an automatic sync worker remain future work. See REVIEW.md.
