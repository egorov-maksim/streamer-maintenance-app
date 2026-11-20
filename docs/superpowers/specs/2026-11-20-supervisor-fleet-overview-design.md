# Supervisor fleet overview — design

Date: 2026-11-20 · Branch: `dev` (all work goes to `dev`; nothing targets `main`)

## Intent and why

A supervisor needs a single read-only page that shows how cleaning operations are going on any vessel in the fleet: cleaning progress, noise levels on the streamers, how efficiently cleaning is working, and how all of that is trending. There was no specific decision in mind; the page is for general situational awareness, so it leads with KPIs and trends rather than detail or editing tools.

The supervisor is a new role. Logging in as one lands directly on `/overview` (public: `barnacle.boats/overview`), and that is the only page they can use.

## Goals

- New role `supervisor`: sees **all vessels**, **read-only**, confined to the overview.
- `GET /overview` page: vessel picker, period picker, KPI tiles with change versus the previous period, trend charts, and short "needs attention" lists.
- One new endpoint, `GET /api/overview?vessel=<tag>&days=<n>`, which does the aggregation in the database and returns everything the page needs in one response.
- Supervisor accounts can be created and managed from the Config page by a grandsuperuser.

## Non-goals

- Side-by-side comparison of several vessels (the page shows one vessel at a time; a possible later addition).
- Any per-person breakdown. Cleaning is measured per vessel; `added_by_usertag` is not used.
- Editing, logging or importing anything from the overview.
- Export/PDF, alerts, targets/thresholds configuration.
- Changing how the existing `/stats` page behaves.

## Anti-goals

- A supervisor who can reach any other page or API (a hidden link is not enough; the server must refuse).
- Numbers on the overview that disagree with the same numbers on `/stats` for the same vessel and project.
- Anything that breaks existing logins, roles or backups restore.

## Constraints found in the code

- Roles live in `backend/middleware/auth.js` (`ROLES`), `backend/routes/users.js` (`ALL_ROLES`, `VESSEL_ROLES`, `canManage`), `public/js/users.js` (`ROLE_LABELS`) and the role badge code in `public/js/auth.js`. Only `grandsuperuser` is global today (`isGlobalUser`, `getVesselScope`).
- `users.role` has a SQL `CHECK (role IN ('grandsuperuser','superuser','admin','viewer'))`. SQLite cannot alter a CHECK, and `applyMigrations()` in `backend/db.js` only adds columns. Adding the role needs a **table-rebuild migration** that also runs after a backup restore (`applySchemaAndMigrations`), plus the same CHECK change in `schema.sql` for fresh installs.
- Users can also be seeded from `AUTH_USERS` (`USERNAME:HASH:ROLE:VESSEL_TAG`). `loadUsersFromEnv` currently skips non-global users without a vessel tag; `supervisor` must be treated as global like `grandsuperuser` there, and `isGlobal` in the login/session response must be true for it.
- Auth is a Bearer token kept in `localStorage` by the frontend, so page routes (`/`, `/stats`, ...) are served as static files without auth. Redirecting a supervisor is a client-side job (after login and on every page load); the real enforcement is on the API.
- Many API routes use `authMiddleware` only (any logged-in role, scoped by `req.vesselScope`). A global supervisor would therefore pass through today's read endpoints with no vessel restriction. They must be blocked explicitly.
- Existing numbers to match: coverage, distance and event counts come from `GET /api/stats` (unique active+tail sections cleaned vs available; distance = sections × section length). Noise efficiency comes from `backend/utils/cleaningNoiseEfficiency.js`; noise level history from `backend/utils/noiseRmsHistory.js`. Both are pure functions, and `getEffectiveConfig`/`buildSectionsPerCableMap` in `routes/stats.js` resolve per-project cable geometry.
- Data model is per project: cleaning events and noise uploads belong to a project, and a vessel has one active project (`vessel_context`). Section length, sections per cable and the suggested cleaning threshold (`suggested_cleaning_threshold_days`, default 10) are per project.
- **Coverage on `/stats` is computed in the browser** (`computeCoverageStats` in `public/js/stats.js`), from `/api/last-cleaned`-style data; the server's `/api/stats` only returns the raw counts (`uniqueCleanedSections`, `totalAvailableSections`, `totalAvailableTail`) and the page divides. There is no server-side coverage function to reuse: the overview needs one, and it must give the same percentage (active + tail sections cleaned ÷ active + tail sections available).
- **`getEffectiveConfig(req)` in `routes/stats.js` resolves the vessel from `req.vesselScope`, falling back to the default vessel in app config.** For a supervisor (`vesselScope` is null) that would silently load the wrong vessel's cable geometry. It must be changed to take the vessel tag explicitly before the overview reuses it.
- **Distance depends on each project's own `section_length`** (`/api/stats` multiplies sections by the active project's length). A window spanning several projects must join `projects` per event rather than multiply by one length.
- The CSP in `server.js` allows scripts only from `'self'` (and the jsPDF CDN), and the unknown-path fallback serves `index.html`. The overview page needs its own explicit `GET /overview` route before that fallback, no inline scripts, and no external chart library.
- The existing frontend is plain ES modules with a shared `styles.css`, KPI tile styles (`.kpi`), and chart helpers (`daily-distance-chart.js`, `noise-rms-history-chart.js`).
- Test setup: Jest + supertest on a scratch SQLite DB (`backend/tests/helpers/app.js`); frontend pure logic is tested in `tests/frontend/*.test.mjs`.

## Approaches considered

- **A. One new overview endpoint (chosen).** `GET /api/overview` aggregates server-side and returns everything in one payload; new route file, `overview.html`, `overview-page.js`. Supervisor-only rule lives in one place; nothing existing is touched. Risk: calculations resemble those on `/stats`, so shared logic must be extracted rather than copied.
- **B. Reuse existing stats endpoints.** Let a supervisor pass a vessel to `/api/stats` and friends and compose on the page. Less new code, but those endpoints assume the user's own vessel and active project, every change risks the main app, and period-over-period comparisons would still be new work.
- **C. Pre-computed daily summary table.** Fast, but a new table to keep in sync; overkill for a handful of vessels.

The user chose A.

## Design

### 1. Role and access

- Add `supervisor` to `ROLES`, to the `AUTH_USERS` parser (vessel tag `ALL`, no vessel stored, like `grandsuperuser`) and to the users routes: `ALL_ROLES` gains it, `VESSEL_ROLES` does not, so only a grandsuperuser can assign or manage it (`canManage` and `assignableRoles` then work unchanged), and `resolveVesselTag` returns no vessel for it.
- **`isGlobalUser` and the session `isGlobal` flag stay exactly as they are** (grandsuperuser only); they gate backups, config, projects, events and users, and `planning-page.js` reads `isGlobal` too. Add a separate `canSeeAllVessels(user)` (true for `grandsuperuser` and `supervisor`) used **only** by the overview routes. A supervisor's `vesselScope` stays `null`, so any existing route they could reach would be unscoped; this is why the lock-in below is default-deny.
- A `requireRole([supervisor, grandsuperuser])` guard protects `/api/overview*`. A grandsuperuser may open the page too (so whoever manages accounts can check it).
- **Lock-in on the server:** default-deny, in `createAuthMiddleware` (every protected route already uses it; the only routes without it are `POST /api/login` and `POST /api/logout`, which do not need it). A request from a `supervisor` session passes only for `GET /api/session`, `GET /api/overview` and `GET /api/overview/vessels` (a new minimal endpoint returning vessel tags, so the picker never touches `/api/projects`); everything else returns 403, including routes added later. Page HTML and static assets stay public, as today. Session invalidation on role change already exists (`deleteSessionsForUser`), so promoting a user to supervisor logs them out of old sessions.
- **Lock-in on the client:** one place, the shared `public/js/auth.js` that every page already imports: after login and after `validateSession`, a supervisor on any path other than `/overview` is sent to `/overview` with `location.replace`. The overview page sends anyone who is not a supervisor or grandsuperuser to `/`. `overview.html` needs its own login markup (each page carries a copy today) and the role badge code in `auth.js` gets a "Supervisor" label.
- Config page: `supervisor` appears in the role list for a grandsuperuser only; the vessel field is hidden/disabled for it like grandsuperuser (`public/js/users.js` `ROLE_LABELS` and the vessel-field toggle); the "last grandsuperuser" protection is unchanged. Badge style `supervisor`.
- Migration: rebuild `users` with the extended CHECK (copy rows, preserve ids, `COLLATE NOCASE` unique username), detect "already migrated" by looking for `'supervisor'` in `sqlite_master.sql` so it is idempotent. Run it from the same place that applies column migrations at startup **and** after a backup restore (`applySchemaAndMigrations`), because an old backup brings the old CHECK back. Update `schema.sql` for fresh installs.

### 2. The endpoint — `GET /api/overview?vessel=TTN&days=30`

- `vessel` is required and must be a vessel that has at least one project (the list comes from `projects.vessel_tag`); unknown → 404, missing → 400. `days` is one of 7, 30, 90 (default 30); other values → 400. Windows are whole UTC days, matching how `cleaned_at` is stored.
- **Which project:** counts, distance and the daily series cover *all projects of the vessel* inside the window, so history survives a project change. Anything that depends on one project's cable layout (coverage, overdue, noise average, noise efficiency) uses the vessel's **active project**. If there is none, those tiles show "no active project". The page header names the active project so the supervisor knows which one the numbers describe.
- **Current period** = the last `days` days up to now; **previous period** = the `days` days before that. Each KPI returns `value`, `previous`, and `deltaPct` (null when previous is 0/missing).
- KPIs returned:
  - *Cleaning:* coverage % of the active project (active + tail sections cleaned ÷ active + tail available, the `/stats` definition, computed server-side by a new shared helper extracted from the section-set loop in `/api/stats`). Its change is in percentage points: coverage now versus coverage with only events before the window start. Both come from **one pass** over the project's events that records, per section, its first and last cleaning time (first < cutoff → counted at start; last → overdue). Also: distance in the window (sum of range length × that event's own project `section_length`, via a join on `projects`); number of log entries; days since the last cleaning (`null` → "no cleaning yet"); overdue sections against `suggested_cleaning_threshold_days`. Overdue counts **active** sections of the active project that were never cleaned or last cleaned longer ago than the threshold; tail sections are excluded.
  - *Noise:* the latest upload's mean RMS (same active-section averaging as the noise history), compared with the last upload **before the window start** so it reads like the other tiles (no earlier upload → no delta); uploads in the window; **days since the last noise upload** (a stale number is itself something a supervisor wants to see); the five worst cables by RMS in the latest upload.
  - *Efficiency (vessel-level):* for the latest upload pair of the active project, mean noise improvement %, share of cleaned sections that improved (existing noise-efficiency calculation), and distance cleaned per cleaning day in the window.
- **Projects and noise:** cleaning counts, distance and the daily series cover all projects of the vessel inside the window. Anything that needs consistent cable geometry (coverage, overdue, noise average, noise efficiency) uses the **active project** only, and the efficiency pair is the latest two uploads *of that project*. The "must match `/stats`" rule applies to the active project over its whole life (and to the window figures when the vessel has only one project); tests assert exactly that.
- Worst streamers: the five cables (streamers) with the highest average RMS in the latest noise upload of the active project.
- Trend series: daily distance cleaned; mean RMS per upload over time (active project); noise improvement **per consecutive upload pair**, newest 8 pairs, using the events that fall between each pair's measured times (the existing `assessCleaningPeriod` logic). Each pair needs two noise uploads' rows (~1,300 each), so the cap keeps it cheap. Empty series are empty arrays, not errors.
- Missing data is explicit: fewer than two noise uploads → efficiency is `null` with a reason string, and the page shows "Needs two noise uploads" rather than zero.
- Implementation: new `backend/routes/overview.js` plus pure helpers in `backend/utils/` (period windows, deltas, coverage/overdue pass). Shared logic is *extracted and used by both routes*: the section-set loop and effective-config resolution from `routes/stats.js` (with the vessel passed in explicitly, never inferred from `vesselScope`), noise efficiency, RMS averaging. Aggregation stays in SQL where it does not need range expansion (`GROUP BY DATE(cleaned_at)`, counts, joined sums). Check the query plan against the existing indexes (`cleaned_at`, `project_number`, `vessel_tag`); add an index only if needed. `/stats` behaviour must not change.

### 3. The page — `/overview`

```
Fleet Overview               Vessel: [ TTN ▾ ]   Period: [ 30 days ▾ ]   user · Sign out
Project 2411-A (active) · last cleaning 2 d ago · last noise upload 4 d ago
┌ Coverage ┐ ┌ Distance ┐ ┌ Cleanings ┐ ┌ Avg noise ┐ ┌ Noise improvement ┐
│  68%     │ │ 412 km   │ │ 1,240     │ │ 3.1 µV    │ │ 14% after cleaning │
│  ▲ +5    │ │ ▲ +12%   │ │ ▼ -3%     │ │ ▼ -8%     │ │ 71% sections better │
└──────────┘ └──────────┘ └───────────┘ └───────────┘ └───────────────────┘
Cleaning   distance per day (chart) · overdue sections · days since last clean
Noise      average RMS per upload (chart) · worst streamers
Efficiency noise improvement per cleaning pair · distance per cleaning day
```

- Reuses `styles.css`, the `.kpi` tile styles and the existing chart modules where they fit; new styles only for the vessel/period header and delta indicators. Works at phone width.
- Delta colour is never the only signal: arrows plus text. For noise, "down" is good, so good/bad colouring is decided per KPI, not by direction.
- Loading, empty ("no cleaning in this period") and error states are handled per section so one missing data source does not blank the page.
- The vessel picker is filled from `GET /api/overview/vessels`; the last selected vessel and period are remembered in `localStorage` (try/catch) and validated against that list on load. Changing either control reloads the data without a full page reload; a stale response from an earlier selection must never overwrite a newer one.
- The page uses the shared `auth.js` login flow and session check, with its own copy of the login markup. Charts are drawn with the app's own self-hosted chart modules or plain SVG (CSP allows no external libraries or inline scripts).

## Parts decided by the user

- Role name `supervisor`; read-only; sees all vessels; picks a vessel on the page.
- After login a supervisor is redirected to one dedicated page, `/overview` on barnacle.boats.
- Content: how cleaning is going, noise levels on the streamers, crew efficiency, trends. No per-person data; crew efficiency is per vessel.
- Approach A.

## Calls made by the author (not yet confirmed by the user)

- The overview covers all projects of the vessel inside the time window; anything tied to cable layout uses the active project, which the header names.
- The session `isGlobal` flag and `isGlobalUser` do **not** change for supervisors; a separate `canSeeAllVessels` is used by the overview only.
- Added to the page beyond what was asked: a header line with the active project, days since last cleaning and days since the last noise upload (stale data is worth seeing).
- Noise "change" compares the latest upload with the last upload before the window start; the efficiency trend is per consecutive upload pair (newest 8), not per calendar week.
- Supervisor access is checked in one place (`createAuthMiddleware`), not on each route.
- Period choices 7 / 30 / 90 days, default 30, with a previous-period comparison.
- "Crew efficiency" = noise improvement after cleaning + distance per cleaning day, measured per vessel from existing data (no new data entry).
- Server-side lock-in: a supervisor can only call the overview API and session endpoints; all others return 403.
- `grandsuperuser` may also open `/overview`.
- Only a grandsuperuser can create or manage supervisor accounts.
- Overdue = active sections of the active project never cleaned or last cleaned longer ago than the project's `suggested_cleaning_threshold_days` (default 10). On a brand-new project nearly everything will show as overdue; that is intended.
- Coverage change is shown in percentage points (versus the start of the window); other changes are percent.
- Which direction is "good" is set per KPI (more distance, coverage and improvement are good; more noise, more overdue sections and more days since cleaning are bad).
- A dedicated `GET /api/overview/vessels` feeds the picker (vessel tags only).
- "Worst streamers" = top 5 cables by average RMS in the latest upload of the active project.

## Left to the builder

- Exact table-rebuild SQL and where it runs in `db.js`, as long as it is idempotent and works after restore.
- How shared calculations are extracted from `routes/stats.js`, and the exact response field names.
- Chart rendering details, colours and responsive layout within the existing look.
- Whether an index is needed for the new queries.

## Testing expectations

- Test setup: add a `supervisor` user to the `AUTH_USERS` in `backend/tests/jest.setup.js` (vessel tag `ALL`).
- Backend (Jest/supertest): supervisor can read `/api/overview` for any vessel; viewer/admin/superuser get 403; supervisor gets 403 on a spread of other endpoints (events, config, backups, users, projects, stats) for both reads and writes; a grandsuperuser's abilities are unchanged; a route added without an explicit allowlist entry is refused for a supervisor; migration on an old-schema database (old CHECK in place, rows and ids preserved, running twice is harmless, and again after `restoreFromFile` of an old backup); a supervisor on vessel A and B gets each vessel's own cable geometry (not the default vessel's); user creation with the new role; `AUTH_USERS` parsing; overview coverage, distance and event counts match `/api/stats` and the stats page for the active project; distance is right across two projects with different section lengths; coverage-at-window-start and overdue are right on hand-built events (never-cleaned sections count as overdue, tail sections do not).
- Pure helpers (period windows, deltas, empty data) get unit tests; frontend pure logic (formatting, delta classes) gets `tests/frontend/*.test.mjs`.
- Run the app and check the page in a browser at desktop and phone width before reporting done.
