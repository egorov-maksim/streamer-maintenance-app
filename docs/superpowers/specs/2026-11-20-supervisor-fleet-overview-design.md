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
- The existing frontend is plain ES modules with a shared `styles.css`, KPI tile styles (`.kpi`), and chart helpers (`daily-distance-chart.js`, `noise-rms-history-chart.js`).
- Test setup: Jest + supertest on a scratch SQLite DB (`backend/tests/helpers/app.js`); frontend pure logic is tested in `tests/frontend/*.test.mjs`.

## Approaches considered

- **A. One new overview endpoint (chosen).** `GET /api/overview` aggregates server-side and returns everything in one payload; new route file, `overview.html`, `overview-page.js`. Supervisor-only rule lives in one place; nothing existing is touched. Risk: calculations resemble those on `/stats`, so shared logic must be extracted rather than copied.
- **B. Reuse existing stats endpoints.** Let a supervisor pass a vessel to `/api/stats` and friends and compose on the page. Less new code, but those endpoints assume the user's own vessel and active project, every change risks the main app, and period-over-period comparisons would still be new work.
- **C. Pre-computed daily summary table.** Fast, but a new table to keep in sync; overkill for a handful of vessels.

The user chose A.

## Design

### 1. Role and access

- Add `supervisor` to `ROLES`. `isGlobalUser` returns true for `grandsuperuser` and `supervisor` (so `getVesselScope` is `null`, login returns `isGlobal: true`, and `AUTH_USERS` accepts it with vessel tag `ALL`).
- **Caution:** `isGlobalUser` is also used to grant write powers (backups, config, projects, events, users). It keeps meaning "grandsuperuser" and its call sites do not change. Add `canSeeAllVessels(user)` (true for `grandsuperuser` and `supervisor`) and use it **only** inside the overview route and its vessel list. `getVesselScope` and the login `isGlobal` flag follow `canSeeAllVessels` only where the overview needs it; the builder checks each existing call site so a supervisor gains nothing outside the overview.
- A `supervisorOnly`-style guard (`requireRole`) protects `/api/overview`. It admits `supervisor` and `grandsuperuser` (the latter so the page can be reviewed by whoever manages accounts).
- **Lock-in on the server:** default-deny, implemented once in the auth middleware, not per route. A supervisor may call only `GET /api/overview`, `GET /api/overview/vessels` (a new minimal endpoint returning vessel tags only, so the picker never needs `/api/projects`), and the session endpoints (`/api/login`, `/api/logout`, and the one `validateSession` uses). Every other `/api/*` request from a supervisor returns 403, including routes added in future. Static assets and page HTML stay public, as today.
- **Lock-in on the client:** after login, a supervisor is redirected to `/overview`; any other page (`/`, `/stats`, `/planning`, `/config`, `/help`) redirects a logged-in supervisor to `/overview` on load. The overview page redirects non-supervisor/non-grandsuperuser users to `/`.
- Config page: the supervisor role appears in the role list for grandsuperuser only (not assignable by a vessel superuser); its vessel field is hidden/disabled like grandsuperuser; `canManage` lets only grandsuperuser manage supervisor accounts; the "last grandsuperuser" protection stays as it is. Label: "Supervisor", with a badge style.
- Migration: rebuild `users` with the extended CHECK (copy rows, preserve ids, unique username collation, indexes), idempotent and safe when run on an already-migrated table; run at startup and after restore; update `schema.sql`.

### 2. The endpoint — `GET /api/overview?vessel=TTN&days=30`

- `vessel` is required and must be an existing vessel (a vessel with at least one project); unknown vessels return 404, a missing one 400. `days` is one of 7, 30, 90 (default 30); other values return 400.
- **Which project:** the overview covers *all projects of the vessel*, restricted to the time window, so history and trends are not lost when the active project changes. Coverage and "overdue sections" use the vessel's **active project** only, since they describe the streamers currently in the water. If the vessel has no active project those tiles show "no active project".
- **Current period** = the last `days` days up to now; **previous period** = the `days` days before that. Each KPI returns `value`, `previous`, and `deltaPct` (null when previous is 0/missing).
- KPIs returned:
  - *Cleaning:* coverage % of the active project (unique sections cleaned vs available, same definition as `/api/stats`). Its change is in percentage points: coverage now versus coverage as of the start of the window (events before the cutoff only). Also distance cleaned (km) in the window; number of cleaning log entries; days since the last cleaning (`null`, shown as "no cleaning yet", when the vessel has none); sections overdue against `suggested_cleaning_threshold_days`. Overdue counts active sections of the active project whose last cleaning is older than the threshold, **and sections never cleaned**; tail sections are excluded.
  - *Noise:* current average RMS (latest noise upload, same active-section averaging as the noise history), change versus the previous upload, number of uploads in the window; the worst few streamers by average RMS.
  - *Efficiency (vessel-level):* mean noise improvement % across sections cleaned between two uploads (existing noise-efficiency calculation applied to the latest pair of uploads), share of cleaned sections that improved, and distance cleaned per cleaning day.
- **Projects and noise:** cleaning counts, distance and the daily series cover all projects of the vessel inside the window. Anything that needs consistent cable geometry (coverage, overdue, noise average, noise efficiency) uses the **active project** only, and the efficiency pair is the latest two uploads *of that project*. The "must match `/stats`" rule applies to the active project over its whole life (and to the window figures when the vessel has only one project); tests assert exactly that.
- Worst streamers: the five cables (streamers) with the highest average RMS in the latest noise upload of the active project.
- Trend series (for charts): daily distance cleaned; average RMS per noise upload over time; a weekly efficiency series if two or more upload pairs exist. Empty series are returned as empty arrays, never errors.
- Missing data is explicit: fewer than two noise uploads → efficiency is `null` with a reason string, and the page shows "Needs two noise uploads" rather than zero.
- Implementation: new `backend/routes/overview.js` plus pure helpers in `backend/utils/` (period windows, delta calculation). The calculations shared with `/stats` (coverage, section sets, noise efficiency, RMS averaging) are moved/exported from existing modules and used by both, so the two pages cannot drift. Aggregation uses SQL (`GROUP BY` date, counts, sums) wherever it does not require expanding section ranges; section-range expansion reuses the existing helpers. New query patterns follow the repo's database-optimization conventions (check indexes on `cleaned_at`, `vessel_tag`, `project_number`; add one only if the query plan needs it).

### 3. The page — `/overview`

```
Fleet Overview               Vessel: [ TTN ▾ ]   Period: [ 30 days ▾ ]   user · Sign out
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
- The vessel picker is filled from a list of vessels (derived from projects/events); the last selected vessel and period are remembered in `localStorage` (try/catch), and are validated against the list on load.
- The page has its own small login handling: it uses the same `auth.js` login screen and session check as the other pages.

## Parts decided by the user

- Role name `supervisor`; read-only; sees all vessels; picks a vessel on the page.
- After login a supervisor is redirected to one dedicated page, `/overview` on barnacle.boats.
- Content: how cleaning is going, noise levels on the streamers, crew efficiency, trends. No per-person data; crew efficiency is per vessel.
- Approach A.

## Calls made by the author (not yet confirmed by the user)

- The overview covers all projects of the vessel inside the time window, with coverage/overdue taken from the active project.
- Period choices 7 / 30 / 90 days, default 30, with a previous-period comparison.
- "Crew efficiency" = noise improvement after cleaning + distance per cleaning day, measured per vessel from existing data (no new data entry).
- Server-side lock-in: a supervisor can only call the overview API and session endpoints; all others return 403.
- `grandsuperuser` may also open `/overview`.
- Only a grandsuperuser can create or manage supervisor accounts.
- Overdue = active sections of the active project never cleaned or last cleaned longer ago than the project's `suggested_cleaning_threshold_days` (default 10). On a brand-new project nearly everything will show as overdue; that is intended.
- Coverage change is shown in percentage points (versus the start of the window); other changes are percent.
- Which direction is "good" is set per KPI (more distance, coverage and improvement are good; more noise, more overdue sections and more days since cleaning are bad).
- A dedicated `GET /api/overview/vessels` feeds the picker.
- "Worst streamers" = top 5 cables by average RMS in the latest upload of the active project.
- Authorization is default-deny for supervisors on `/api/*`.

## Left to the builder

- Exact table-rebuild SQL and where it runs in `db.js`, as long as it is idempotent and works after restore.
- How shared calculations are extracted from `routes/stats.js`, and the exact response field names.
- Chart rendering details, colours and responsive layout within the existing look.
- Whether an index is needed for the new queries.

## Testing expectations

- Backend (Jest/supertest): supervisor can read `/api/overview` for any vessel; viewer/admin/superuser get 403; supervisor gets 403 on a spread of other endpoints (events, config, backups, users, projects, stats) for both reads and writes; `isGlobalUser` call sites still behave for grandsuperuser; migration on an old-schema database; user creation with the new role; `AUTH_USERS` parsing; numbers on the overview match `/api/stats` for the same vessel and project.
- Pure helpers (period windows, deltas, empty data) get unit tests; frontend pure logic (formatting, delta classes) gets `tests/frontend/*.test.mjs`.
- Run the app and check the page in a browser at desktop and phone width before reporting done.
