# Changelog

## v2.0 - 2026-11-20

Changes since the previous main (ec6ebba, v1.2.0 line): 59 commits, 107 files.

### New features
- Supervisor role with a fleet overview page: cleaning KPIs, noise and efficiency charts, days since cleaning, daily distance. Supervisors are confined to the overview endpoints and never carry a vessel tag. Role badge shown on the overview page.
- Overview API endpoint (backend/routes/overview.js), sharing stats calculations with the stats routes.
- User management on the Config page (create/edit users, roles).
- Planning heatmap: eBird cleaning dates and status, hover tooltip with full cleaning history, user-selectable number of recent cleanings, heatmap method toggles.
- Average RMS per section across selected sequences, with a dropdown sequence picker; averaged sequences apply only on "Show on heatmap".
- Per-section clean counts.
- Noise sequence time, plus a warning when a cleaning falls outside the upload period.

### Changes and fixes
- Role permissions aligned with the intended role model.
- Hardened backups, uploads, vessel scoping and date handling; startup backup now runs after migrations and user import finish.
- UTC timestamp parsing fixed; overview daily distance covers every day.
- UI fixes for phone navigation, heatmap, login and accessibility; access-level note removed from login page.
- "Most frequently cleaned sections" removed from the main page.
- Removed unreachable Tail Adaptor branches from the EB range calculation.
- CRLF line endings restored in app.js and schema.sql.

### Tests and tooling
- New Jest suite under backend/tests (users, roles, overview, supervisor lock-in, section clean counts, noise efficiency).
- Removed e2e scripts and the Playwright dependency.

### Docs
- README refreshed (bcrypt users, noise stats, API list, per-streamer sections override, production install); supervisor role and overview API documented; design and plan docs for the fleet overview; CLAUDE.md with the dev-first branch workflow.
