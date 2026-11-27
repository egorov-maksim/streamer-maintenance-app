# Optional front eBird (EB01 ahead of AS01) — design

Size: small change (short design). Date: 2026-11-27. Branch: `dev`.

## Intent and why

A boat (HYP) has an extra eBird physically in front of the first section, and
this is expected to become standard. The app currently puts EB01 *after* AS01,
so eBird numbers and positions in the heatmap, EB ranges, PDFs and cleaning
entries do not match what the crew sees on the cable. A per-project tick lets a
vessel switch to the real layout.

With the tick on, the layout along a streamer is:

`EB01 – AS01 – EB02 – AS02 – AS03 – AS04 – AS05 – EB03 – …` (N = 4 shown)

## Rules (confirmed with the requester)

- **Tick off (default):** nothing changes. Existing projects are unaffected.
- **Tick on:**
  - EB01 is always directly in front of AS01.
  - EB02 is always directly behind AS01. Both are fixed and independent of N.
  - After that the existing rule continues unchanged: one EB after every
    N sections counted from AS01 (N = 4 gives EB03 after AS05, EB04 after
    AS09, …) and a closing EB on the last active section of each streamer
    when it does not already carry one.
  - Every EB number is one higher than without the tick (old EB01 becomes EB02).
- Channel numbers do not change; EB cells carry no channels.
- No data migration. HYP has no eBird cleaning records yet, so stored
  `eb_number` values are interpreted under the project's current setting.
  (Flipping the tick on a project that already has records would shift their
  meaning; the config UI should say so near the checkbox.)

## Goals / non-goals / anti-goals

- Goals: one project-level boolean; every screen, the PDF, the EB range
  labels and cleaning-entry validation agree on EB numbering and position.
- Non-goals: other EB patterns (a tail EB, per-streamer overrides, a custom
  EB list); migrating old records.
- Anti-goal: a screen where EB numbers disagree with another screen, or a
  changed layout for projects that did not tick the box.

## Approaches considered

- **A. One layout helper, then the flag (chosen).** Put the EB placement rule
  in a single function per runtime, route every consumer through it, then add
  the flag. Removes the duplicated copies of the rule; the existing tests with
  the flag off are the safety net. Larger diff.
- **B. Patch each copy with an offset.** Smaller per-file diff, but any missed
  copy shows a different EB number on one screen.

Chosen by the requester: A.

## Design

**Setting.** New project column `eb_front INTEGER DEFAULT 0` (added via
the existing `ALTER TABLE … ADD COLUMN` helper in `backend/db.js` and
`schema.sql`), exposed as `ebFront` (boolean) in config, alongside
`moduleFrequency` in `backend/config.js`, `routes/config.js`,
`routes/projects.js` (create + update) and `public/js/projects.js`. Checkbox
"Extra eBird in front of first section" next to "eBird Frequency" in
`public/config.html`, with a short note about renumbering.

**Layout helper.** Backend: `getModuleLayout(sectionCount, moduleFreq, ebFront)`
in `backend/utils/eb.js`, returning an ordered list of
`{ num, afterSection }`, where `afterSection = -1` means "before AS01".
Frontend: the same function in `public/js/heatmap-layout.js` (the backend is
CommonJS and the frontend ES modules, so there are two copies, with a shared
test fixture asserting they return the same layouts). Existing exports
(`shouldInsertModuleAfterSection`, `countHeatmapColumnRows`,
`calculateEBRange`, `countEBModules`, `getEBRangeForSectionRange`) are
rewritten on top of it and gain an `ebFront` argument.

**Consumers to move onto the helper:** `calculateEBRange` and `countEBModules`
(`backend/utils/eb.js`; used by `routes/stats.js` and
`routes/ebCleanings.js` validation); `getEBRangeForSectionRange`
(`public/js/streamer-utils.js`); both heatmap renderers (horizontal and
vertical) in `public/app.js` and the planning page in `public/planning-page.js`,
including the `modulesCount` / `totalRows` calculation and the CH column's
module rows; the EB lists in `public/pdf-generator.js` (two places);
`public/js/eb-status.js` if it assumes EB01 sits after AS01.

## Testing

- Helper unit tests, flag off: output identical to today's for a range of
  section counts and N (including N = 1, sections = 1, last section on a
  regular boundary).
- Helper unit tests, flag on: the exact pattern above for N = 4, EB numbers
  shifted by one, closing EB present once, and a streamer with one section.
- Backend/frontend parity fixture; `ebCleanings` rejects EB numbers above the
  new maximum and accepts the extra one; stats EB range with the flag on.
- Config round-trip: create/update project and `GET /api/config` carry the
  flag.
- Manual check on `dev`: heatmap vertical and horizontal, planning page and a
  PDF show the same EB numbering for a flagged project.

## Left to the builder

- Exact function and parameter names, and how `ebFront` reaches renderers that
  take a `cfg` object.
- Wording of the config note, and the CHANGELOG and help-page entries.
- Whether the PDF EB loops fold into the helper cleanly or need a thin adapter.

## Calls I made (flag for review)

- Setting is per project, matching where `moduleFrequency` lives, rather than a
  separate "vessel" record (the app has no vessel-level config).
- Two helper copies (backend, frontend) with a parity test, instead of trying
  to share one file across CommonJS and ES modules.
- Warn-only note rather than a block when the tick is changed on a project
  that already has EB cleaning records.
