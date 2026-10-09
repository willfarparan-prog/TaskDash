# Updated-code critique and finishing changes

Reviewed October 8, 2026 against main commit e5812fd and the finishing changes. The older dashboard-redesign checkout was behind main; this release preserves the latest modular frontend, Docs, SOP hub, client profiles, consultations, live sessions, session wrap-up, stock library, recurrence rules, and undo/redo.

The updated architecture is considerably stronger: browser features and server handlers are separated, one API router avoids the Vercel function limit, schema setup uses a version marker, and existing tests cover the workflows. A framework rewrite would add risk without an immediate usability benefit.

The remaining highest-impact weaknesses were failure handling and recovery. Failed task mutations could look successful, failed program saves could replace the in-memory saved record, program navigation could discard unsaved edits, calendar availability could continue after failed conflict checks, booking insertion did not serialize different overlapping starts, and retries could duplicate Google events after a lost response. Cancellation could free a slot even when the calendar event remained.

## Implemented in this release

- Retain existing task carryover and recurrence; add a deliberate Tomorrow action. Task creation preserves input on failure; completion/deletion failures restore the previous state.
- Recover program drafts in this browser, including titles, client selection, goals and partially written exercise rows. Keep undo/redo. Save failures retain the draft and the original saved record. Stale versions return a conflict; content-only saves retain the existing number of weeks. Closing an unchanged editor does not invent a draft.
- Combine overdue one-off tasks, client follow-ups, event deadlines and unsynced bookings into a linked queue. Preserve the existing onboarding and session-paperwork queues.
- Include manual blocks in booking conflicts and serialize overlapping reservation checks/inserts. Default to pausing public booking without verified work-calendar availability; an explicit owner setting allows local-only booking.
- Reconcile legacy Google events and use stable event IDs for repeatable retries. Automatic reconciliation on Scheduler visits is preserved with per-booking locks, and a visible Retry sync action is added. Cancellation shares the lock and keeps the reservation if calendar removal cannot be verified.
- Add durable hashed-IP booking-attempt limits, with old buckets pruned. No visitor IP addresses are stored directly.
- Add an authenticated consistent JSON snapshot of 15 work-record tables, including consultations, workouts and document metadata. OAuth tokens, secrets and diagnostic logs are excluded.
- Build only the intended HTML/JS/CSS assets into public/. Server code, source datasets, tests, scripts and review documents are excluded from static output while the existing API router remains deployed.
- Fix multibyte cookie-signature comparison, require a signing secret, bound browser requests, guard rapid calendar navigation, include inbox in refresh, retain the current-week dashboard agenda, and roll back failed client-onboarding changes.
- Move inventory metrics below operational work, replace misleading readiness percentages with active connection counts, label the agenda “This week,” provide mobile search, and preserve the existing visual style.

## Remaining work and usability opportunities

1. Rehearse an actual Neon restore. JSON export is a portable snapshot; this release does not add automatic import or verify provider backup retention. Uploaded document binaries remain in private Blob storage and need their own recovery plan.
2. Add a background calendar-sync worker and integration-health checks. Current retries run on Scheduler visits or by user action. Google calendar changes can still race with the final local availability check; the database lock serializes Task Dash reservations only.
3. Add recoverable deletion and booking rescheduling/confirmation delivery. Existing client deletion is permanent. Plan record retention before adding trash, and verify delivery before relying on reminders.
4. Finish consistent error/state handling across secondary workflows. Some event draft/report fields, consult/live-session edits and read caches still have their existing feature-specific offline behavior. A failed read is not proof of an empty dataset. Program, task and core creation paths are hardened here; this is not a claim that every offline workflow has been redesigned.
5. Add keyboard navigation and exact-item targeting to global search. Follow-up rows now target records directly; search remains section-oriented.
6. Improve calendar overlap and all-day rendering, with a phone agenda option. This release fixes request ordering and agenda range consistency, not the full grid layout.
7. Move schema changes to explicit versioned migrations and validate a fresh-database setup. The current setup still assumes some base tables and runs migrations at request startup.
8. Keep personal information out of unnecessary AI prompts and logs, and validate only the fields that each feature needs. The expanded consultation, nutrition and session workflows warrant ongoing review as real data grows.

## Validation scope

152 automated tests pass. These cover existing workflows plus booking overlap, retries/cancellation, export exclusions, stale program updates, production mutation rollback and draft recovery. Local browser checks cover partial-row recovery after refresh and phone search. Production smoke checks and deployment provenance are recorded in RELEASE.md. Authenticated database writes and Google event creation need an approved-account interactive session; tests simulate those boundaries.


## Follow-up save reliability

Fixed in this release: overlapping autosave acknowledgement, lost-response session-create duplication, non-transactional session completion, false-success consultation navigation/session close, report and messaging-draft recovery after reload, production preview-task fallback, and missing visibility of read outages. Explicit retry and unsynced-work exit warnings cover these drafts.

Production consult/program/session save-and-resume verification succeeded on a clearly named test client. Session finish/history/wrap-up and booking/calendar/cancellation verification remain pending the browser confirmation; see RELEASE.md for exact coverage. Recoverable deletion, restore rehearsal and background calendar recovery remain separate future improvements.
