# Optional Front eBird Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project tick that puts a fixed extra eBird directly in front of AS01 (`EB01 – AS01 – EB02 – AS02…AS05 – EB03 …`), without changing any existing project's output or data.

**Architecture:** One `getModuleLayout(sectionCount, moduleFreq, ebFront)` per runtime (backend CommonJS in `backend/utils/eb.js`, frontend ES module in `public/js/heatmap-layout.js`) defines EB numbers and positions. Backend EB range/validation, frontend EB range, both heatmaps, the planning page and the PDF go through it. A frozen copy of today's algorithm lives in the tests and pins flag-off output.

**Tech Stack:** Node/Express/SQLite (`backend/`), vanilla ES modules (`public/`), Jest (`npm test`; backend tests in `backend/tests/*.test.js`, frontend tests in `tests/frontend/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-27-front-ebird-design.md`

## Global Constraints

- **Nothing changes for existing projects.** New column `eb_front INTEGER DEFAULT 0`, so every existing row reads 0. Flag-off output of every function and screen must equal today's. No data migration, no renumbering of stored `eb_number`.
- Flag semantics: EB01 is always directly in front of AS01, EB02 always directly behind AS01 (independent of N). After that every N sections counted from AS01, plus the existing closing EB on the last active section when it has none. Every number is one higher than flag-off.
- Camel-case name is `ebFront` (boolean in API responses and `config`; stored 0/1). The spec said `ebird_at_front`; the plan uses `eb_front` so the camelised name is `ebFront` with no mapping. Task 1 updates the spec.
- Checkbox label: "Extra eBird in front of first section".
- Channel numbers never change.
- Work on `dev`; PRs use base `dev`, never `main`. Commit messages end with the session's attribution lines.

## Review Focus

1. Saving the planning-page suggestion threshold (`PUT /api/projects/:id` without `ebFront`) must not reset the flag. Task 1 test.
2. A one-section streamer and N = 1 with the flag on: `[front, first]` only, and EB after every section with sequential numbers. Task 2 test.
3. 105 sections, N = 4, flag on: last section is already regular, so no duplicate closing EB (count 28, not 29). Task 2 test.
4. The channel (CH) column must get the front module row, or channel labels no longer line up with the streamer columns, which is the whole reason for this change. Task 6 browser check.
5. Another project's flag (not the active one) must drive that project's PDF/range labels. Task 3 test.

---

### Task 1: Project setting, API plumbing, spec correction

**Files:**
- Modify: `backend/schema.sql` (projects table, after `use_rope_for_tail`), `backend/db.js` (`COLUMN_MIGRATIONS`), `backend/config.js` (`defaultConfig`, `BOOLEAN_KEYS`), `backend/routes/projects.js` (GET list, GET active, activate, POST, PUT), `backend/routes/config.js` (GET/PUT, vessel-scoped branches), `backend/utils/effectiveConfig.js`, `docs/superpowers/specs/2026-11-27-front-ebird-design.md` (rename `ebird_at_front` to `eb_front`)
- Modify: `backend/tests/helpers/app.js` (`createProject` accepts `ebFront = 0`)
- Test: `backend/tests/ebFront.test.js` (create)

**Interfaces:**
- Produces: `projects.eb_front` column; `ebFront: boolean` on every project/config JSON the routes return; `resolveEffectiveConfig(...)` result includes `ebFront: boolean` (from the project row, `false` when none). `createProject({..., ebFront})` test helper.

- [ ] **Step 1: Write failing tests** in `backend/tests/ebFront.test.js` (use `resetDb`, `createProject`, `activateProject`, `login`, `request`; superuser account from `jest.setup.js`):
  - `adds eb_front with default 0 to a database created before the column existed`: after `ready()`, `DROP`-free check: insert a project via raw SQL omitting `eb_front`, `GET /api/projects` returns `ebFront === false` for it.
  - `POST /api/projects stores ebFront true and GET returns boolean true`; `POST` without `ebFront` stores false.
  - `PUT /api/projects/:id without ebFront keeps the stored flag` (create with `ebFront: true`, PUT the same body minus `ebFront`, GET → still `true`). Same for `PUT /api/config` on a vessel-scoped user.
  - `PUT /api/projects/:id with ebFront false clears it`.
  - `GET /api/config returns ebFront from the active project` and `false` when there is no active project.
  - `resolveEffectiveConfig({ projectNumber })` returns `ebFront: true` for a flagged project (explicit project, not the active one), `false` otherwise.
- [ ] **Step 2: Run** `npx jest backend/tests/ebFront.test.js` (via `npm test -- backend/tests/ebFront.test.js`). Expected: FAIL (column/field missing).
- [ ] **Step 3: Implement.** Add `eb_front INTEGER DEFAULT 0` to `schema.sql` and `{ table: "projects", column: "eb_front", definition: "INTEGER DEFAULT 0" }` to `COLUMN_MIGRATIONS`. `defaultConfig.ebFront = false`, add `"ebFront"` to `BOOLEAN_KEYS`. In `routes/projects.js` convert `ebFront: p.ebFront === 1` wherever `useRopeForTail` is converted; INSERT writes `eb_front` as `body.ebFront === true ? 1 : 0`; UPDATE writes `eb_front = ?` with `body.ebFront === undefined ? existing.ebFront : (body.ebFront ? 1 : 0)` (never default to 0 on update). `routes/config.js` GET and PUT (both vessel branches): `base.ebFront = activeProject.ebFront === 1`; vessel-scoped PUT leaves `eb_front` untouched unless `ebFront` is present in the body, then updates it. Global (non-vessel) config PUT does not store `ebFront`. `resolveEffectiveConfig` adds `ebFront: projectRow != null ? projectRow.ebFront === 1 : false`. Test helper `createProject` inserts `eb_front`. In the spec, rename `ebird_at_front` to `eb_front`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, including every existing backend test unchanged.
- [ ] **Step 5: Commit** `feat: add per-project eb_front setting (default off)`.

### Task 2: Backend layout helper, range, count, cleaning validation

**Files:**
- Modify: `backend/utils/eb.js`, `backend/routes/ebCleanings.js:95`
- Create: `backend/tests/helpers/legacyEb.js` (verbatim copy of today's `calculateEBRange` and `countEBModules` from commit `8b89567`, exported as `legacyCalculateEBRange`, `legacyCountEBModules`)
- Test: `backend/tests/eb.test.js`, `backend/tests/ebCleanings.test.js`

**Interfaces:**
- Consumes: `ebFront` on config/project (Task 1).
- Produces: `getModuleLayout(sectionCount: number, moduleFreq: number, ebFront?: boolean): Array<{ num: number, afterSection: number, kind: "front"|"first"|"regular"|"closing" }>` (`afterSection` is the 0-based section the EB sits behind, `-1` for the front EB; empty array when `sectionCount < 1`; `moduleFreq` falls back to 4 when not a positive integer). `calculateEBRange(start, end, config)` reads `config.ebFront`. `countEBModules(sectionsPerCable, moduleFrequency, ebFront = false): number` returns `getModuleLayout(...).length`. All three exported from `backend/utils/eb.js`.

- [ ] **Step 1: Write failing tests** in `eb.test.js`:
  - `flag off matches the frozen legacy implementation`: for `sections` in `[1,2,3,4,5,8,9,13,20,105,107]`, `freq` in `[1,2,3,4,5,7]`, every `start <= end < sections` (for 105/107 step 1 over starts `[0,1,3,4,50,104]` and all ends): `calculateEBRange(s, e, {moduleFrequency, sectionsPerCable})` equals `legacyCalculateEBRange(...)`; `countEBModules(sections, freq)` equals `legacyCountEBModules(...)`.
  - `flag on, N=4, 12 sections` layout: `[ {1,-1,front}, {2,0,first}, {3,4,regular}, {4,8,regular}, {5,11,closing} ]`.
  - `flag on, N=4: EB01 directly before AS01 and EB02 directly behind it` for 1, 2 and 5 sections: 1 section → `[front, first]` (closing coincides with `first`, no duplicate); 2 sections → `[front, first, closing@1]`.
  - `flag on, N=1`: 4 sections → nums 1..5, `afterSection` `[-1,0,1,2,3]`.
  - `flag on, 105 sections, N=4`: `countEBModules(105, 4, true) === 28` and flag off `=== 27`; `countEBModules(107, 4, true) === 29`.
  - `flag on shifts every flag-off number by one`: for 107/4, layout nums equal flag-off nums + 1 at the same `afterSection`, plus the extra front entry.
  - `calculateEBRange with ebFront`: `(4,4)` → `"EB03"`; `(0,12)` on 20 sections N=4 → `"EB05 - EB02"` (same nearest-EB rule as today: EB at or before the start, EB at or after the end).
  In `ebCleanings.test.js`: a project with `ebFront: true` and 107 sections accepts EB 29 and rejects 30 (400); an unflagged project still rejects 29 and accepts 28.
- [ ] **Step 2: Run** `npm test -- backend/tests/eb.test.js backend/tests/ebCleanings.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `getModuleLayout` in `backend/utils/eb.js`: flag off emits `first@0`, `regular@s` for `s = freq, 2·freq, … < sectionCount`, and `closing@sectionCount-1` only if no module is there; numbers are sequential from 1. Flag on emits `front@-1` first and numbers everything one higher. Rewrite `calculateEBRange` on top of it (keep the existing before/after selection and formatting, including `after` falling back to the last module) and `countEBModules` as `.length` (keep returning 0 for non-finite or `< 1` sections). In `ebCleanings.js` pass `project.ebFront === 1` to `countEBModules`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: layout helper and front eBird in EB range and cleaning validation`.

### Task 3: Frontend layout helper, EB range, config plumbing

**Files:**
- Modify: `public/js/heatmap-layout.js`, `public/js/streamer-utils.js` (`getEBRangeForSectionRange`, `getConfigForProject`), `public/js/projects.js` (`populateConfigForm`, `getConfigFromForm`, `activateProject`'s `setConfig`), `public/js/auth.js:286`, `public/config.html`, `public/planning-page.js` (`effectiveCfg` objects at ~813 and ~957, threshold-save body at ~805)
- Test: `tests/frontend/eb-range.test.mjs`, `tests/frontend/heatmap-layout.test.mjs` (create)

**Interfaces:**
- Consumes: backend `getModuleLayout` and `legacyCalculateEBRange` (via `createRequire`, as `eb-range.test.mjs` already does).
- Produces: `getModuleLayout(sectionCount, moduleFreq, ebFront = false)` (same contract as Task 2) and `countHeatmapColumnRows(sectionCount, moduleFreq, tailSections, ebFront = false)` (adds 1 when `ebFront`), both exported from `public/js/heatmap-layout.js`. `shouldInsertModuleAfterSection` keeps its signature and behaviour (module positions behind sections are the same with the flag on; only the front cell and numbering differ). `getEBRangeForSectionRange(start, end, cfg)` reads `cfg.ebFront`. `getConfigForProject` returns `ebFront` from the named project (`project.ebFront === true || === 1`), not from the active project. Form: checkbox `#cfg-ebFront`; `getConfigFromForm()` returns `ebFront: boolean`.

- [ ] **Step 1: Write failing tests.** `heatmap-layout.test.mjs`: frontend `getModuleLayout` deep-equals backend `getModuleLayout` for every `sections` in 1..40 and `freq` in 1..6, flag on and off; sequential renderer numbering (front gets 1, then +1 at each section where `shouldInsertModuleAfterSection(s+1, count, freq)` is true) equals the layout's `num` list; `countHeatmapColumnRows(107, 4, 0)` is unchanged from today's value and `(…, true)` is exactly one more; flag off equals a frozen copy of the current implementation for the same grid. `eb-range.test.mjs`: add the existing all-ranges equality loop for `{ ebFront: true }`, and `getConfigForProject("B")` returns `ebFront: true` for project B flagged while the active project A is not.
- [ ] **Step 2: Run** `npm test -- tests/frontend`. Expected: FAIL.
- [ ] **Step 3: Implement.** Port `getModuleLayout` to `heatmap-layout.js`; make `getEBRangeForSectionRange` build its module list from it (keep the `—` tail rule and en-dash separator). Add the `#cfg-ebFront` checkbox with the label above next to "eBird Frequency" in `config.html`, plus one sentence under the existing note: "Turning this on or off renumbers all eBirds of this project; existing eBird cleaning records keep their stored numbers." Add the checkbox id to the disabled-for-non-superuser selector in `auth.js`. `populateConfigForm` sets `.checked` from `cfg.ebFront`; `getConfigFromForm` reads `.checked`; the project-save body carries it through `...formConfig`. Add `ebFront` to the `setConfig` in project activation and to both `effectiveCfg` objects and the threshold-save body in `planning-page.js` (`ebFront: activeProject.ebFront`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: frontend layout helper, EB range and config checkbox for front eBird`.

### Task 4: Heatmaps and planning page

**Files:**
- Modify: `public/app.js` (~1314-1335 `totalRows`/`modulesCount`; horizontal `buildRowCells` ~1369; vertical CH column ~1502-1522; vertical streamer column ~1540-1590), `public/planning-page.js` (same four spots, ~969, ~1010, ~1143, ~1178)

**Interfaces:**
- Consumes: `config.ebFront` (boolean), `countHeatmapColumnRows(..., ebFront)` (Task 3), `buildEbCell(streamerId, num, latestEbCleaning)` (app.js:196), `applyEbCleaningStatus`.

- [ ] **Step 1: Implement** in all four spots of both files, with `const ebFront = !!config.ebFront`:
  - `modulesCount` gains `+ (ebFront ? 1 : 0)`, so `totalRows` leaves room for the extra cell.
  - Each per-streamer builder (horizontal `buildRowCells`, vertical streamer column) appends a front EB cell (number 1) before the first section when `ebFront`, then starts `moduleNum` at 2 instead of 1. Pass `ebFront` to `countHeatmapColumnRows`.
  - The CH column/row (vertical channel column and horizontal CH row) appends one empty module cell (same class and `—` text as its other module cells) before the first section when `ebFront`, so channel labels stay level with their section cells.
  - Flag off: no code path differs from today.
- [ ] **Step 2: Run** `npm test`. Expected: PASS (nothing here is DOM-tested; Task 6 covers it in a browser).
- [ ] **Step 3: Commit** `feat: render front eBird in heatmap and planning page`.

### Task 5: PDF

**Files:**
- Modify: `public/js/heatmap-layout.js`, `public/pdf-generator.js` (~438-457, ~536-545, ~655-669 and the separator loop in the second PDF)
- Test: `tests/frontend/pdf-modules.test.mjs` (create)

**Interfaces:**
- Produces: `buildPdfModulePositions({ moduleFreq, maxSections, totalSections, ebFront }): { modulesBySection: Array<number|null>, separatorRows: number[] }`. `modulesBySection[s]` is the EB number drawn on the right of row `s` (only EBs that sit behind a row; the front EB has no row). `separatorRows` lists the section rows under which a bold line is drawn (today: even-numbered, non-closing EBs).

- [ ] **Step 1: Write failing tests.** Flag off: for `maxSections` in `[1,5,20,105,107]`, `freq` in `[1,3,4,5]`, `totalSections = maxSections` and `maxSections + 5`, `buildPdfModulePositions` equals a frozen copy of today's two PDF computations (copy the loops at `pdf-generator.js:438-457` and `:536-545` into the test as the reference, including the existing last-label rule `floor((max-1)/freq)+1`). Flag on, 107 sections N=4: row 0 carries 2, row 4 carries 3, `modulesBySection` has no 1, `separatorRows` contains 0 (EB02) and 8 (EB04) and not 4 (EB03, odd).
- [ ] **Step 2: Run** `npm test -- tests/frontend/pdf-modules.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Flag off reproduces today's numbers exactly (do not "fix" the last-label rule; see Open Findings). Flag on takes numbers and positions from `getModuleLayout(maxSections, moduleFreq, true)`, skipping `afterSection < 0`; separators are even-numbered, non-`closing` entries. Replace both duplicated blocks in `pdf-generator.js` with calls to it, passing `config.ebFront`; make the PDF caller pass the flag of the project being exported (`getConfigForProject`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: front eBird in PDF export`.

### Task 6: Browser check, docs, wrap-up

**Files:**
- Modify: `CHANGELOG.md`, `public/help.html` (eBird section), `API.md` (project/config `ebFront` field)

- [ ] **Step 1: Browser check** (Playwright is preinstalled; run `npm run start:test`, scratch DB). Create two projects with the same geometry, one with `ebFront`. For the heatmap and the planning page, in both orientations: assert the flagged project's first streamer column starts with a cell labelled `EB01`, then `1`, then `EB02`, then `2`…`5`, then `EB03`; the unflagged one starts `1`, `EB01`, `2`; and every `.hm-col` (including the CH column) has the same number of child cells. Expected: all assertions hold. Check the PDF export for both projects opens without errors.
- [ ] **Step 2: Docs.** CHANGELOG "Unreleased": the new setting and that existing projects are unchanged. Help page and `API.md`: one sentence each.
- [ ] **Step 3: Run** `npm test`. Expected: all green; also `git diff 8b89567 -- backend/schema.sql` shows only the one added column line.
- [ ] **Step 4: Commit and push** `docs: front eBird setting`; push `dev`; open a draft PR with base `dev` unless one is open.

## Open Findings (report to the user, do not fix here)

- `pdf-generator.js` labels the closing EB with `floor((max-1)/freq)+1`, one lower than the heatmap's closing number whenever the last section is not a regular position (107 sections, N=4: PDF 27, heatmap 28). Flag-off PDF output is kept as is because existing output must not change.
- `GET /api/eb-range` uses the global `moduleFrequency`, not the project's (`resolveEffectiveConfig` never resolves it), unlike `POST /api/eb-cleanings`. Left alone for the same reason; `ebFront` is resolved from the project.
- EB range labels keep today's convention (nearest EB at or before the start and at or after the end), so AS01 alone reads `EB02` with the flag on, as AS05 reads `EB03`.
