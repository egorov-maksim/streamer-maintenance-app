# Supervisor Fleet Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `supervisor` role that lands on `/overview`, a page with per-vessel cleaning, noise and efficiency KPIs and trends.

**Architecture:** One new endpoint pair (`GET /api/overview`, `GET /api/overview/vessels`) backed by pure helper modules in `backend/utils/` and calculations extracted from `routes/stats.js` so `/stats` and the overview share them. Supervisor access is default-deny inside `createAuthMiddleware`. The page is a new static `overview.html` + ES module using the app's existing Chart.js setup and shared `auth.js`.

**Tech Stack:** Node 20, Express 4, sqlite3, Jest + supertest (backend, `.test.js`), Jest ESM (frontend pure logic, `tests/frontend/*.test.mjs`), plain ES modules, Chart.js from `/libs/chart.umd.min.js` (as `stats.html` does).

**Spec:** `docs/superpowers/specs/2026-11-20-supervisor-fleet-overview-design.md`

## Global Constraints

- All commits go to `dev`; never open a PR against or merge into `main` (CLAUDE.md). Commit messages end with the `Co-Authored-By:` and `Claude-Session:` trailer lines the session instructs.
- Run tests with `npm test`. Baseline must be green before Task 1; every task ends green.
- `isGlobalUser(user)` and the session `isGlobal` flag stay **grandsuperuser only**. A separate `canSeeAllVessels(user)` (grandsuperuser or supervisor) is used by the overview routes only.
- `GET /api/stats` and the `/stats` page behave exactly as before (existing tests are the guard).
- Supervisor server allowlist, exactly: `GET /api/session`, `GET /api/overview`, `GET /api/overview/vessels`. Everything else behind `authMiddleware` is 403 for a supervisor.
- `days` is one of `7`, `30`, `90` (default `30`), whole UTC days; current window `[start, end)`, previous window is the `days` before it. Anything else → 400.
- `vessel` required; must be a `projects.vessel_tag` value (exact match); missing → 400, unknown → 404.
- Overdue threshold: the active project's `suggested_cleaning_threshold_days` (default 10). Overdue counts active sections never cleaned or last cleaned longer ago; tail sections excluded.
- Worst streamers: top 5 cables by mean RMS in the latest upload of the active project. Efficiency trend: newest 8 consecutive upload pairs.
- Distance = Σ (range length × that event's own project `section_length`). Coverage = (active + tail sections cleaned) ÷ (active + tail available), 1 decimal, as the `/stats` page shows it.
- CSP: no inline scripts, no external libraries. Page needs an explicit `GET /overview` route before the `*` fallback.
- Migration of `users` CHECK must be idempotent and run from `applyMigrations()` (startup and restore).

## Review Focus

Failure modes the spec implies that no single feature task would otherwise test; each is pinned by a test in the task named.

- A vessel with no events, no noise uploads or no active project returns nulls/empty arrays and a 200, never a 500 (Task 6).
- A supervisor reaching an allowed route by a variant — `POST /api/overview`, `/api/overview/` with a trailing slash, `?x=1` — is handled by method and normalized path: POST refused, trailing slash allowed, query ignored (Task 3).
- Events exactly on the window boundary: start included, end excluded, and `cleaned_at` stored as date-only text still lands in the right window (Task 5).
- A vessel with two projects (different section lengths, one active): counts/distance span both, coverage/noise use only the active one (Task 5).
- Events whose section range now exceeds the project's section count (geometry edited after logging) never push coverage above 100% (Task 4).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/schema.sql`, `backend/db.js` | `users.role` CHECK gains `supervisor`; `migrateUsersRoleCheck()` |
| `backend/middleware/auth.js` | `ROLES.SUPERVISOR`, `canSeeAllVessels`, `isSupervisorAllowed`, default-deny in `createAuthMiddleware`, `AUTH_USERS` parsing |
| `backend/routes/users.js`, `public/js/users.js` | assign/manage supervisor accounts (grandsuperuser only) |
| `backend/utils/effectiveConfig.js` (new) | `buildSectionsPerCableMap`, `resolveEffectiveConfig` extracted from `routes/stats.js` |
| `backend/utils/cleanedSections.js` (new) | `collectCleanedSections`, `summarizeSectionCoverage` |
| `backend/utils/overviewPeriods.js` (new) | `parseDays`, `buildPeriods`, `kpi`, `deltaPoints` |
| `backend/utils/overviewNoise.js` (new) | `buildNoiseOverview`, `buildEfficiencyPairs` |
| `backend/routes/overview.js` (new) | the two endpoints; wires the helpers |
| `public/overview.html`, `public/overview-page.js`, `public/js/overview-format.js`, `public/js/role-routing.js` (new) | page, page logic, pure formatting, pure redirect rule |
| `public/js/auth.js`, `backend/server.js`, `public/styles.css` | redirect hook, `/overview` route, badge/styles |

---

### Task 1: `users.role` CHECK migration

**Files:**
- Modify: `backend/schema.sql` (users CHECK), `backend/db.js` (`applyMigrations`, exports)
- Test: `backend/tests/usersRoleMigration.test.js`

**Interfaces:**
- Produces: `migrateUsersRoleCheck(): Promise<void>` (internal to `db.js`, called by `applyMigrations`); `applyMigrations` exported from `backend/db.js`.

- [ ] **Step 1: Run `npm test`; note it is green.**
- [ ] **Step 2: Write the failing test** `usersRoleMigration.test.js` using `ready()` from `./helpers/app` and `runAsync/getAsync/allAsync/applyMigrations` from `../db`:
  - `it("rebuilds an old users table, keeps ids and rows")`: `DROP TABLE users`; create it with the old CHECK (`'grandsuperuser','superuser','admin','viewer'`) and the same columns as `schema.sql`; insert ids 7 (`grand1`, grandsuperuser, vessel NULL) and 9 (`v1`, viewer, `TTN`); `await applyMigrations()`; assert both rows read back with the same ids/roles; assert `INSERT ... role 'supervisor', vessel_tag NULL` now succeeds; assert `'bogus'` still fails with a CHECK error.
  - `it("is idempotent")`: call `applyMigrations()` twice more; row count unchanged, no throw.
  - `it("keeps usernames case-insensitively unique")`: inserting `V1` after `v1` fails.
- [ ] **Step 3: Run it — expect FAIL** (`supervisor` insert rejected / `applyMigrations` not exported).
- [ ] **Step 4: Implement.** Add `supervisor` to the CHECK in `schema.sql`. In `db.js` write `async function migrateUsersRoleCheck()`: read `sqlite_master.sql` for `users`; return if it already contains `'supervisor'`; otherwise in one transaction (`BEGIN`/`COMMIT`, rollback on error) create `users_new` with the new DDL, `INSERT INTO users_new SELECT <same columns> FROM users`, drop `users`, rename `users_new` to `users`. Call it at the end of `applyMigrations()` (errors logged like the column migrations). Export `applyMigrations`.
- [ ] **Step 5: Run `npm test` — expect all green.**
- [ ] **Step 6: Commit** `feat: allow supervisor in the users role check`.

---

### Task 2: Supervisor role plumbing (backend + Config page)

**Files:**
- Modify: `backend/middleware/auth.js`, `backend/routes/users.js`, `backend/tests/jest.setup.js`, `backend/tests/users.test.js` (seeded-user count 5 → 6), `public/js/users.js`, `public/js/auth.js` (badge label), `public/styles.css` (`.user-role-badge.supervisor`)
- Test: `backend/tests/supervisorRole.test.js`

**Interfaces:**
- Produces: `ROLES.SUPERVISOR = "supervisor"`; `canSeeAllVessels(user): boolean`; test user `sup` (password `TEST_PASSWORD`, role supervisor, vessel `ALL`) in `jest.setup.js`.

- [ ] **Step 1: Add `sup:${hash}:supervisor:ALL` to `AUTH_USERS` in `jest.setup.js`; update the count assertion in `users.test.js` to 6.**
- [ ] **Step 2: Write failing tests** in `supervisorRole.test.js` (use `login`, `resetDb`, `request`, `app` from `./helpers/app`):
  - `loadUsersFromEnv` with `"s:h:supervisor:ALL"` → `{ role: "supervisor", vesselTag: null, isGlobal: false }`; `isGlobalUser` false; `canSeeAllVessels` true for supervisor and grandsuperuser, false for admin/viewer/superuser/undefined.
  - Login `sup` → 200, body `role: "supervisor"`, `isGlobal: false`, `vesselTag: null`.
  - Grandsuperuser `POST /api/users {username:"newsup",password:"long-enough-1",role:"supervisor"}` → 201, `role: "supervisor"`, `vesselTag: null`.
  - `ttnsuper` same request → 403; `ttnsuper` `GET /api/users` lists no supervisor and `assignableRoles` lacks `supervisor`; grand's `assignableRoles` contains it.
  - Grand `PUT /api/users/:id {role:"supervisor"}` on a viewer → role supervisor, vessel null, and the viewer's old token now gets 401 on `/api/session`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement.** `auth.js`: add the role, `canSeeAllVessels`, export it; `loadUsersFromEnv` treats supervisor like grandsuperuser for the vessel-tag requirement (tag optional, stored null) but `isGlobal` stays grandsuperuser-only. `users.js`: `ALL_ROLES = [GRAND_SUPER_USER, SUPERVISOR, ...VESSEL_ROLES]` (not in `VESSEL_ROLES`); `resolveVesselTag` returns `{ vesselTag: null }` for supervisor like grandsuperuser. Frontend: `ROLE_LABELS.supervisor = "Supervisor"`, `syncVesselField` treats supervisor like grandsuperuser with the hint "Supervisor has read-only access to all vessels.", `auth.js` badge branch for supervisor, CSS badge colour.
- [ ] **Step 5: Run `npm test` — expect green.**
- [ ] **Step 6: Commit** `feat: add supervisor role`.

---

### Task 3: Server lock-in (default-deny)

**Files:**
- Modify: `backend/middleware/auth.js`
- Test: `backend/tests/supervisorLockin.test.js`

**Interfaces:**
- Produces: `isSupervisorAllowed(method: string, path: string): boolean`; `createAuthMiddleware` returns 403 `{ error: "Access denied" }` for a supervisor session on any other route.

- [ ] **Step 1: Write failing tests.**
  - Unit: `isSupervisorAllowed("GET","/api/session")`, `("GET","/api/overview")`, `("GET","/api/overview/")`, `("GET","/api/overview/vessels")` true; `("POST","/api/overview")`, `("GET","/api/stats")`, `("GET","/api/overview/vessels/x")`, `("GET","/api/overviewx")` false.
  - Integration (token from `login("sup")`): 403 on `GET /api/stats`, `/api/projects`, `/api/events`, `/api/config`, `/api/users`, `/api/backups`; `POST /api/events` and `DELETE /api/users/1` also 403; `GET /api/session` 200 with `role: "supervisor"`.
  - Control: `ttnadmin` still gets 200 on `GET /api/stats`; `grand` unaffected on `GET /api/users`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `isSupervisorAllowed` (strip one trailing slash, ignore query, exact path + method match against the three allowed pairs) and call it in `createAuthMiddleware` after the session is resolved, before `next()`.
- [ ] **Step 4: Run `npm test` — expect green.**
- [ ] **Step 5: Commit** `feat: confine supervisors to the overview endpoints`.

---

### Task 4: Shared calculations extracted from `/api/stats`

**Files:**
- Create: `backend/utils/effectiveConfig.js`, `backend/utils/cleanedSections.js`
- Modify: `backend/routes/stats.js` (use the new modules; behaviour unchanged)
- Test: `backend/tests/cleanedSections.test.js`, `backend/tests/effectiveConfig.test.js`

**Interfaces:**
- Produces:
  - `buildSectionsPerCableMap(projectId: number|null, numCables: number, defaultSections: number): Promise<Object<number,number>>` (moved verbatim).
  - `resolveEffectiveConfig({ projectNumber?: string, vesselTag: string, vesselScope?: string|null }): Promise<Config>` — same result shape as today's `getEffectiveConfig`; resolves the project by `projectNumber` or else the active project of `vesselTag`; throws `httpError(403)` if `vesselScope` is set and the project's vessel differs. `routes/stats.js` `getEffectiveConfig(req)` becomes a thin wrapper passing `vesselTag: req.vesselScope || config.vesselTag || defaultConfig.vesselTag`.
  - `collectCleanedSections(events, config): { active: Set<string>, tail: Set<string>, all: Set<string> }` — events `{streamerId, sectionIndexStart, sectionIndexEnd, sectionType}`; key `${streamerId}-${globalIdx}` exactly as `/api/stats` builds today.
  - `summarizeSectionCoverage(events, config, { windowStart: string, now: string, thresholdDays: number }): { cleanedSections: number, totalSections: number, coveragePct: number, coverageAtStartPct: number, overdueSections: number, totalActiveSections: number, lastCleanedAt: string|null }` — events also carry `cleanedAt`; one pass tracks per-section first/last cleaning time; indices outside a streamer's section count are ignored (as `/api/last-cleaned` does); percentages 1 decimal; `totalSections = Σ active + numCables × (useRopeForTail ? 0 : 5)`.

- [ ] **Step 1: Write failing tests.**
  - `collectCleanedSections`: two overlapping active events + one tail event → sizes match hand-counted (`active` 6, `tail` 2, `all` 8).
  - `summarizeSectionCoverage` with config `{ numCables: 2, sectionsPerCable: 10, sectionsPerCableMap: {1:10,2:10}, useRopeForTail: true }`: events cleaning 5 sections of streamer 1 at `2024-03-01` and 5 more at `2024-03-20`, `windowStart "2024-03-10"`, `now "2024-03-21"`, `thresholdDays 10` → `coveragePct 50`, `coverageAtStartPct 25`, `overdueSections 15` (the 5 cleaned 3/01 are overdue, plus 10 never-cleaned on streamer 2 → total 15), `totalActiveSections 20`.
  - Clamp: an event covering indices 0–40 on a 10-section streamer → `coveragePct` ≤ 100 and `cleanedSections` ≤ `totalSections`.
  - No events → coverage 0, `lastCleanedAt: null`, overdue = all active sections.
  - `resolveEffectiveConfig` with `vesselTag: "RAM"` and no project param loads RAM's active-project geometry, not the default vessel's (create two projects with different `numCables`, activate one per vessel using `createProject`/`activateProject`); a mismatched `vesselScope` throws a 403.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Move `buildSectionsPerCableMap` and the body of `getEffectiveConfig` into `effectiveConfig.js`; extract the section-set loop from `/api/stats` into `collectCleanedSections` and call it from the route; write `summarizeSectionCoverage` (reuse `collectCleanedSections` for the global key sets only if it keeps the code simpler).
- [ ] **Step 4: Run `npm test` — all existing stats tests plus new ones green.**
- [ ] **Step 5: Commit** `refactor: share stats calculations with the overview`.

---

### Task 5: Periods/deltas helpers + `GET /api/overview/vessels` + cleaning half of `GET /api/overview`

**Files:**
- Create: `backend/utils/overviewPeriods.js`, `backend/routes/overview.js`
- Modify: `backend/server.js` (mount router)
- Test: `backend/tests/overviewPeriods.test.js`, `backend/tests/overviewCleaning.test.js`

**Interfaces:**
- Produces (`overviewPeriods.js`): `parseDays(raw: any): 7|30|90|null` (undefined/"" → 30; invalid → null); `buildPeriods(days: number, now?: Date): { start: string, end: string, prevStart: string }` (ISO strings; `end` = start of the next UTC day, `start = end − days`, previous window `[prevStart, start)` with `prevStart = start − days`); `kpi(value: number|null, previous: number|null): { value, previous, deltaPct: number|null }` (deltaPct 1 decimal, null when either is null or previous is 0); `deltaPoints(now: number|null, before: number|null): number|null`.
- Produces (route): `createOverviewRouter(authMiddleware): express.Router` (guard `requireRole([SUPERVISOR, GRAND_SUPER_USER])`); `GET /api/overview/vessels → { vessels: string[] }` (distinct `projects.vessel_tag`, sorted); `GET /api/overview?vessel=&days=` → at this task: `{ vessel, days, generatedAt, project: {projectNumber, projectName}|null, freshness: { lastCleaningAt, daysSinceLastCleaning, lastNoiseUploadAt: null, daysSinceLastNoiseUpload: null }, cleaning: { coverage: { pct, atWindowStartPct, deltaPoints, cleanedSections, totalSections }|null, distanceKm: Kpi, events: Kpi, overdueSections: { count, thresholdDays, totalActiveSections }|null, dailyDistanceKm: Array<{ date: string, km: number }> } }`. Coverage/overdue are `null` when the vessel has no active project. Distance and events span all the vessel's projects.

- [ ] **Step 1: Write failing unit tests** (`overviewPeriods.test.js`): `parseDays(undefined)===30`, `"7"→7`, `"14"→null`; `buildPeriods(30, new Date("2024-03-15T10:00:00Z"))` → `end "2024-03-16T00:00:00.000Z"`, `start "2024-02-15T00:00:00.000Z"`, `prevStart "2024-01-16T00:00:00.000Z"`; `kpi(10, 8).deltaPct === 25`, `kpi(5, 0).deltaPct === null`, `kpi(null, 3).deltaPct === null`; `deltaPoints(68, 63) === 5`.
- [ ] **Step 2: Write failing integration tests** (`overviewCleaning.test.js`; supertest with `login("sup")` token; `createProject`, `activateProject`, direct `INSERT INTO cleaning_events` like `roles.test.js`; use `jest.useFakeTimers().setSystemTime(...)` or insert dates relative to now):
  - 400 for missing `vessel`, for `days=14`; 404 for `vessel=NOPE`; 403 for `ttnadmin`; 200 for `grand`.
  - `/vessels` returns `["RAM","TTN"]` for projects on both.
  - Distance: vessel TTN has project A (`section_length` 75, active) and project B (`section_length` 50); one 4-section event in each inside the window → `distanceKm.value === (4*75 + 4*50) / 1000`; `events.value === 2`.
  - Boundary: an event at exactly `start` counts, one at exactly `end` does not; an event whose `cleaned_at` is date-only (`"2024-03-10"`) lands in the right window; an event in the previous window feeds `previous`/`deltaPct`.
  - Coverage numbers equal `/api/stats` for the active project: `coverage.cleanedSections === stats.uniqueCleanedSections` and `coverage.totalSections === stats.totalAvailableSections + stats.totalAvailableTail` (call `/api/stats?project=` as `grand`).
  - Two-project vessel: coverage/overdue reflect only the active project's events.
  - Vessel with a project but no events and no active project → 200, `cleaning.coverage === null`, `overdueSections === null`, `dailyDistanceKm` `[]`, `distanceKm.value === 0`, `freshness.daysSinceLastCleaning === null`.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement** the helpers and the router. Window filters use `datetime(cleaned_at) >= datetime(?) AND datetime(cleaned_at) < datetime(?)`; distance and daily series use a `JOIN projects p ON p.project_number = e.project_number` summing `(section_index_end − section_index_start + 1) * p.section_length`; coverage/overdue run `summarizeSectionCoverage` over the active project's events (`getActiveProjectForVessel`, `resolveEffectiveConfig({ projectNumber, vesselTag })`, threshold from the project). Mount in `server.js` with `createOverviewRouter(authMiddleware)` before the `*` fallback.
- [ ] **Step 5: Run `npm test` — green.**
- [ ] **Step 6: Commit** `feat: overview endpoint with cleaning KPIs`.

---

### Task 6: Noise and efficiency in `GET /api/overview`

**Files:**
- Create: `backend/utils/overviewNoise.js`
- Modify: `backend/routes/overview.js`
- Test: `backend/tests/overviewNoise.test.js` (pure), `backend/tests/overviewNoiseRoute.test.js`

**Interfaces:**
- Consumes: `buildNoiseRmsHistory`, `buildNoiseMap`, `expandEventsToSectionKeys`, `computeNoiseEfficiency`, `assessCleaningPeriod`, `withMeasuredAt`, `MEASURED_AT_SQL` (existing utils).
- Produces (`overviewNoise.js`):
  - `buildNoiseOverview(uploads, noiseRows, sectionsPerCableMap, numCables, windowStart: string): { latestAvgRms: number|null, previousAvgRms: number|null, deltaPct: number|null, uploadsInWindow: number, worstStreamers: Array<{ streamerId: number, avgRms: number }>, rmsHistory: Array<{ uploadId: number, measuredAt: string, avgRms: number|null }> }` — `uploads` oldest first, with `measuredAt`; an upload's `avgRms` = mean of the streamers' per-upload averages ignoring nulls (2 decimals); `previousAvgRms` = the last upload measured before `windowStart` that is not the latest, else null; `worstStreamers` top 5 of the latest upload, highest first.
  - `buildEfficiencyPairs(uploads, rowsByUploadId: Map<number, Array>, activeEvents, maxPairs = 8): Array<{ beforeUploadId, afterUploadId, beforeMeasuredAt, afterMeasuredAt, meanImprovementPct: number|null, improvedSharePct: number|null, cellsPaired: number }>` — oldest first, newest `maxPairs` kept; per pair only events `assessCleaningPeriod` marks `"inside"` are used.
- Route extends the response with: `freshness.lastNoiseUploadAt`, `freshness.daysSinceLastNoiseUpload`; `noise: {...BuildNoiseOverview result, uploadsInWindow}|null` (null without an active project); `efficiency: { status: "ok"|"insufficient_uploads"|"no_events"|"no_active_project", reason: string|null, meanImprovementPct, improvedSharePct, distancePerCleaningDayKm: number|null, pairs: [...] }` where the top-level figures are the newest pair's and `distancePerCleaningDayKm` = window distance ÷ distinct cleaning days in the window (null if none).

- [ ] **Step 1: Write failing pure tests.** Two uploads (ids 1, 2), 2 cables × 3 sections, RMS 10/10/10 on cable 1 and 4/4/4 on cable 2 in upload 1; 5/5/5 and 4/4/4 in upload 2 → `latestAvgRms 4.5`, `worstStreamers[0] = {streamerId:1, avgRms:5}`, `rmsHistory.length 2`. `previousAvgRms` is 7 when upload 1 predates `windowStart`, null when it does not. Pairs: one event inside the pair covering cable 1 sections 1–3 → `meanImprovementPct 50`, `improvedSharePct 100`, `cellsPaired 3`. With 12 uploads → `pairs.length === 8`.
- [ ] **Step 2: Write failing route tests** (`createProject`, insert `noise_uploads` with `recorded_at` and `noise_data` rows directly): active project with two uploads and a cleaning event between them → `efficiency.status "ok"`, `meanImprovementPct` as hand-computed, matches `/api/stats/cleaning-noise-efficiency` for the same two uploads (`grand` token); one upload → `status "insufficient_uploads"`, non-empty `reason`; uploads but no event between → `"no_events"`; no active project → `noise null`, `efficiency.status "no_active_project"`, 200; `freshness.daysSinceLastNoiseUpload` correct.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement** the helpers and extend the route: load the active project's uploads (`ORDER BY ${MEASURED_AT_SQL} ASC, id ASC`, vessel and project filters, `withMeasuredAt`), one `noise_data` query for all selected upload ids (only the newest `maxPairs + 1` uploads are needed for pairs; history uses all), active-section events for the pairs.
- [ ] **Step 5: Run `npm test` — green.**
- [ ] **Step 6: Commit** `feat: overview noise and efficiency`.

---

### Task 7: `/overview` page shell, redirects, role routing

**Files:**
- Create: `public/overview.html`, `public/js/role-routing.js`, `tests/frontend/role-routing.test.mjs`
- Modify: `backend/server.js` (`GET /overview`), `public/js/auth.js` (redirect hook), `backend/tests/supervisorLockin.test.js` (add route test)

**Interfaces:**
- Produces: `redirectTarget(role: string|undefined, pathname: string): string|null` in `role-routing.js` — supervisor on any path other than `/overview` → `"/overview"`; a role other than supervisor/grandsuperuser on `/overview` → `"/"`; otherwise `null`. `auth.js` calls it with `location.pathname` after a successful login and after a successful `validateSession`, and uses `location.replace(target)` when non-null.

- [ ] **Step 1: Write failing tests.** `role-routing.test.mjs`: `redirectTarget("supervisor","/")==="/overview"`, `("supervisor","/stats")`, `("supervisor","/overview")===null`, `("viewer","/overview")==="/"`, `("grandsuperuser","/overview")===null`, `("admin","/stats")===null`, `(undefined,"/overview")==="/"`. Backend: `GET /overview` returns 200 `text/html` containing `Fleet Overview` and is not the `index.html` fallback; unauthenticated is fine (page is static; data needs a token).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `app.get("/overview", ...)` next to the other page routes. `overview.html`: copy the login block, user header (username, role badge, logout) and script tags from `stats.html`; main area has `<header>` with vessel `<select id="overview-vessel">`, period `<select id="overview-days">` (7/30/90), a context line `<p id="overview-context">`, a KPI tile row `<div id="overview-kpis">`, and three sections (`cleaning`, `noise`, `efficiency`) with canvases/containers for charts and lists; loads `/libs/chart.umd.min.js` then `<script type="module" src="/overview-page.js">`. No navigation links to other pages. `auth.js`: wire `redirectTarget`; non-supervisor behaviour on other pages unchanged.
- [ ] **Step 4: Run `npm test` — green.**
- [ ] **Step 5: Commit** `feat: overview page shell and supervisor redirects`.

---

### Task 8: Overview page logic and charts

**Files:**
- Create: `public/overview-page.js`, `public/js/overview-format.js`, `tests/frontend/overview-format.test.mjs`
- Modify: `public/styles.css`

**Interfaces:**
- Produces (`overview-format.js`, pure): `formatDelta(deltaPct: number|null, unit: "pct"|"pts"): string` (`"▲ +12%"`, `"▼ -3%"`, `"▲ +5 pts"`, `"—"` for null, `"= 0%"` for zero); `deltaTone(kpiKey: string, delta: number|null): "good"|"bad"|"neutral"` with higher-is-good for `coverage`, `distance`, `improvement`, `events`, and higher-is-bad for `noise`, `overdue`, `daysSinceCleaning`; `formatKm(n: number): string` (1 decimal, thousands separators); `formatDays(n: number|null): string` (`"today"`, `"1 d"`, `"4 d"`, `"no data"`).

- [ ] **Step 1: Write failing tests** for the four helpers with the examples above (including `deltaTone("noise", -8)==="good"`, `deltaTone("noise", 8)==="bad"`, `deltaTone("coverage", 0)==="neutral"`, `deltaTone("x", null)==="neutral"`).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement the helpers.**
- [ ] **Step 4: Implement `overview-page.js`** (ES module, `safeGet`/`apiCall` from the existing modules, same init pattern as `stats-page.js`): load `/api/overview/vessels` to fill the picker; restore `{vessel, days}` from `localStorage` (try/catch, validated against the list); on change call `/api/overview?vessel=&days=` and render: context line (active project, last cleaning, last noise upload), KPI tiles (coverage, distance, cleanings, avg noise, noise improvement) with arrow + text deltas coloured by `deltaTone`, daily-distance bar chart, RMS-per-upload line chart, efficiency-per-pair bar chart, overdue / worst-streamers lists, and section-level empty or reason messages (`efficiency.reason`, "No active project", "No cleaning in this period"). A request counter discards any response that is not for the newest selection. Handle `401` via the existing unauthorized handler; render an inline error with a retry button on failure. Add the page's styles to `styles.css`; layout must work at 360 px width (tiles wrap, charts full-width).
- [ ] **Step 5: Run `npm test` — green.**
- [ ] **Step 6: Commit** `feat: overview page KPIs and charts`.

---

### Task 9: Docs and end-to-end check

**Files:**
- Modify: `API.md`, `README.md`, `INSTALL.md` (supervisor in the `AUTH_USERS` role list: vessel tag `ALL`), `public/help.html` only if it lists roles

- [ ] **Step 1: Document** the two endpoints (params, response fields from Tasks 5–6, error codes), the supervisor role and its restrictions, and the `AUTH_USERS` format with `supervisor`.
- [ ] **Step 2: Run the app** with `npm run start:test` on a scratch DB (`public/libs` is git-ignored: if Chart.js is missing locally, see `INSTALL.md` for how it is provided). Seed data: two vessels' projects, events and noise uploads (script in the scratchpad, not committed). Log in as a supervisor created from the Config page by the grandsuperuser; confirm: lands on `/overview`; visiting `/`, `/stats`, `/config` bounces back; vessel switch and period switch update the page; no console errors; screenshots at 1280 px and 390 px width.
- [ ] **Step 3: Confirm a viewer/admin cannot open `/overview` (redirected to `/`) and that the main app and `/stats` for them are unchanged.**
- [ ] **Step 4: Run `npm test`; report the result and the verification evidence honestly, including anything not checked.**
- [ ] **Step 5: Commit** `docs: supervisor role and overview API`; push `dev`.

---

## Self-review notes

- Spec coverage: role/AUTH_USERS/users routes/Config UI (T2), migration incl. restore path (T1), default-deny (T3), shared coverage + explicit-vessel config (T4), cleaning KPIs, per-project distance, boundaries, vessel list (T5), noise, freshness, efficiency pairs, error states (T6), redirect/route/CSP/own login markup (T7), page behaviour, stale-response guard, charts, responsive (T8), docs and browser verification (T9).
- The header line (active project, freshness) is in T5/T6 (data) and T8 (display).
