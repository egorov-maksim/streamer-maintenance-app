# Changelog

## Unreleased

### New features
- Optional per-project setting "Extra eBird in front of first section" (default off). When on, eBirds are renumbered by +1 so a streamer reads EB01, AS01, EB02, AS02..AS05, EB03 and so on; channels are unchanged. It applies to the heatmap, the planning page, EB ranges, the PDF export and eBird cleaning entry validation. Existing projects are unchanged.
- With the front eBird on, an EB range reads as the eBirds in front of and behind the span, so AS01 alone is "EB02 - EB01". Projects without it keep today's labels.
- With the front eBird on, the PDF heatmap labels EB01 above the first row.

### Changes and fixes
- PDF heatmap: the closing eBird on the last section now carries the same number as the heatmap (for 107 sections and a frequency of 4 it is EB28, not EB27). Previously it was one lower whenever the last section was not a regular eBird position, and an even closing eBird was left unlabelled. This changes the PDF of existing projects.

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
