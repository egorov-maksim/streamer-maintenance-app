# Streamer Maintenance App — Code Review & Analysis Report

**Version**: 1.4.0  
**Last Updated**: March 2026  
**Purpose**: Handoff document for code review and analysis. Describes deployment, architecture, and all paths/routes.

---

## 1. Application Overview

**Streamer Maintenance Tracker** is an internal web application for managing seismic streamer maintenance operations. It provides:

- **Real-time heatmap** of cable/section cleaning status (age-based coloring)
- **Project management** (multi-project, per-vessel, active project)
- **Event logging** (cleaning events with method, date, section range, EB range)
- **Role-based access** (GrandSuperUser, SuperUser, Admin, Viewer) with vessel scoping
- **Statistics & reporting** (coverage, distance, PDF reports, CSV export/import)
- **RMS noise overlay** (CSV upload, per-section data, planning suggestions)
- **Database backups** (scheduled + manual, restore with SuperUser+)

**Tech stack**: Node.js 20+, Express, SQLite (WAL), vanilla JS frontend (no framework), no build step. All API calls go through `public/js/api.js` with Bearer token auth.

---

## 2. Hosting & Deployment

The application is **hosted online on Hetzner** (no longer local-only). It runs as a single Node/Express process serving the same codebase:

- **Public URL**: **https://barnacle.boats**
- **CORS**: Configure `ALLOWED_ORIGINS` in `.env` to include `https://barnacle.boats`.
- **Database**: SQLite file (e.g. `./backend/streamer.db`) on the server; ensure the process has read/write access and that `backup/` directory exists for automated backups.
- **Session store**: In-memory tokens in `sessionStore.js` with `SESSION_TTL_MS` (default 8h) — sessions are lost on server restart; expired tokens are rejected.

For local development, the app still runs with `npm start` (default `http://localhost:3000`); `ALLOWED_ORIGINS` can include `http://localhost:3000` (and optionally `http://localhost:3001` when `PORT=3001`).

---

## 3. Directory Layout (Paths)

```
streamer-maintenance-app/
├── backend/
│   ├── server.js              # Express app, static files, route mounting, fallback SPA
│   ├── db.js                  # SQLite init, runAsync/allAsync/getAsync, createBackup
│   ├── sessionStore.js        # In-memory sessions, SESSION_TTL_MS, getSession eviction
│   ├── backupScheduler.js     # Periodic backups (setInterval → createBackup)
│   ├── schema.sql             # Idempotent DB schema
│   ├── config.js              # app_config load/save (key/value by vessel)
│   ├── activeProject.js       # Per-vessel active-project lookup
│   ├── tests/                 # Jest: backend/utils unit tests (npm test)
│   ├── middleware/
│   │   └── auth.js            # Token auth, RBAC, vessel scoping (req.user, req.vesselScope)
│   ├── routes/
│   │   ├── auth.js            # POST /api/login, /api/logout, GET /api/session
│   │   ├── backups.js         # GET/POST /api/backups, POST .../restore
│   │   ├── config.js          # GET/PUT /api/config
│   │   ├── events.js          # Events CRUD, bulk import, bulk delete
│   │   ├── noise.js           # Noise uploads list, get, POST upload
│   │   ├── projects.js        # Projects CRUD, active, deployments, cleanup-streamers
│   │   └── stats.js           # stats, last-cleaned, eb-range
│   └── utils/
│       ├── eb.js              # EB range calculator (pure)
│       ├── errors.js          # sendError(res, status, message)
│       ├── queryHelpers.js    # Dynamic WHERE builder
│       ├── sectionType.js     # Active/tail section split & validation (pure)
│       └── validation.js     # toInt(), requireValidId()
├── public/                    # Static root (express.static)
│   ├── index.html             # Main app (heatmap, events, stats)
│   ├── app.js                 # Frontend entry, auth bootstrap, event handlers
│   ├── config.html            # Config dashboard
│   ├── config-page.js         # Config page logic
│   ├── stats.html             # Standalone stats page
│   ├── stats-page.js          # Stats page entry
│   ├── planning.html          # Planning page (cleaning suggestions)
│   ├── planning-page.js       # Planning page entry
│   ├── styles.css             # Single global stylesheet
│   ├── pdf-generator.js       # PDF report (jsPDF, A3 landscape)
│   ├── libs/
│   │   └── jspdf.umd.min.js   # jsPDF (see INSTALL.md)
│   └── js/
│       ├── api.js             # All fetch wrappers; 401/403 handling
│       ├── auth.js            # Login/logout, session, role helpers
│       ├── state.js           # Single source of truth (events, config, projects, token)
│       ├── projects.js        # Project UI, config form, deployments, backups
│       ├── stats.js           # Shared stats rendering (app + stats-page)
│       ├── ui.js              # DOM helpers, toasts
│       ├── modals.js          # Modal open/close, focus trap
│       ├── streamer-utils.js  # Section labels, EB/channel ranges, age buckets
│       ├── streamer-tooltip.js# Column header tooltip data
│       └── noise-validation.js# Pure CSV validation (no imports)
├── backup/                    # Created at runtime; 12h scheduler + manual
├── .env                       # PORT, DB_FILE, ALLOWED_ORIGINS, AUTH_USERS
├── .env.example
├── package.json
├── README.md
├── INSTALL.md
├── API.md
└── CODE_REVIEW_REPORT.md      # This file
```

---

## 4. HTTP Routes (Complete Reference)

All routes are relative to the app root. Static files and HTML pages are served from `public/`. API routes use the `/api/` prefix. Auth: `Authorization: Bearer <token>`.

### 4.1 Page routes (server.js)

| Method | Path       | Description |
|--------|------------|-------------|
| GET    | `/`        | Serves `public/index.html` (via fallback) |
| GET    | `/config`  | Serves `public/config.html` |
| GET    | `/stats`   | Serves `public/stats.html` |
| GET    | `/planning`| Serves `public/planning.html` |
| GET    | `*`        | Fallback: `public/index.html` (SPA-style) |

Static assets (JS, CSS, images) are served from `public/` at their relative paths (e.g. `/js/api.js`, `/styles.css`).

### 4.2 Auth (routes/auth.js)

| Method | Path          | Auth   | Description |
|--------|---------------|--------|-------------|
| POST   | `/api/login`  | No     | Body: `{ username, password }`. Returns `{ token, username, role, vesselTag, isGlobal }`. |
| POST   | `/api/logout` | No     | Optional Bearer token; clears session. |
| GET    | `/api/session`| Yes    | Returns current user (username, role, vesselTag, isGlobal). |

### 4.3 Config (routes/config.js)

| Method | Path           | Auth        | Description |
|--------|----------------|-------------|-------------|
| GET    | `/api/config`  | Yes         | Current app config (vessel-scoped where applicable). |
| PUT    | `/api/config`  | SuperUser+ | Update config. |

### 4.4 Projects (routes/projects.js)

| Method | Path                                              | Auth        | Description |
|--------|---------------------------------------------------|-------------|-------------|
| GET    | `/api/projects/stats`                             | Yes         | Event counts by project. |
| GET    | `/api/projects`                                   | Yes         | List projects (vessel-scoped for non-global). |
| GET    | `/api/projects/active`                            | Yes         | Active project for user's vessel. |
| POST   | `/api/projects`                                   | SuperUser+ | Create project. |
| PUT    | `/api/projects/:id/activate`                      | SuperUser+ | Set project as active for its vessel. |
| PUT    | `/api/projects/:id`                               | SuperUser+ | Update project. |
| POST   | `/api/projects/deactivate`                        | SuperUser+ | Clear active project for vessel. |
| DELETE | `/api/projects/:id`                               | SuperUser+ | Delete project (409 if events/deployments exist). |
| DELETE | `/api/projects/:id/force`                         | SuperUser+ | Force delete project and related data. |
| GET    | `/api/projects/:id/streamer-deployments`           | Yes         | Per-streamer deployment config. |
| PUT    | `/api/projects/:id/streamer-deployments`          | SuperUser+ | Upsert deployment config. |
| DELETE | `/api/projects/:id/streamer-deployments/:streamerId` | SuperUser+ | Clear one streamer deployment. |
| POST   | `/api/cleanup-streamers`                          | SuperUser+ | Delete events/deployments for streamers above configured max. |

### 4.5 Events (routes/events.js)

| Method | Path                   | Auth       | Description |
|--------|------------------------|------------|-------------|
| GET    | `/api/events`          | Yes        | List events. Query: `?project=X`, `?start=`, `?end=` (ISO). Vessel-scoped. |
| POST   | `/api/events`         | Admin+     | Create event. Body: streamer/section/method/cleaned_at/project/vessel etc. |
| PUT    | `/api/events/:id`     | Admin+     | Update event. |
| DELETE | `/api/events/:id`     | Admin+     | Delete one event. |
| POST   | `/api/events/bulk`    | Admin+     | Bulk import (CSV rows). Body: `{ rows }`. |
| DELETE | `/api/events`         | Admin+     | Bulk clear. Query: optional `?project=X`. |

Note: CSV export is done **client-side** (events are fetched via `GET /api/events`, then converted to CSV in the browser). There is no `GET /api/events/export` endpoint.

### 4.6 Statistics & heatmap (routes/stats.js)

| Method | Path                       | Auth | Description |
|--------|----------------------------|------|-------------|
| GET    | `/api/eb-range`            | Yes  | Query: `start`, `end`; optional `sectionType=tail`. Returns EB range. |
| GET    | `/api/stats`               | Yes  | Overall stats. Query: `?project=X`. |
| GET    | `/api/stats/filter`        | Yes  | Filtered stats. Query: `?start=`, `?end=`, `?project=X`. |
| GET    | `/api/last-cleaned`        | Yes  | Last-cleaned data for heatmap. Query: `?project=X`. |
| GET    | `/api/last-cleaned-filtered` | Yes | Filtered heatmap data. Query: `?start=`, `?end=`, `?project=X`. |

### 4.7 Noise (routes/noise.js)

| Method | Path                          | Auth   | Description |
|--------|-------------------------------|--------|-------------|
| GET    | `/api/noise-data/uploads`     | Yes    | List upload batches. Query: `?project=X`. |
| GET    | `/api/noise-data`             | Yes    | Get RMS data. Query: `?project=X`, optional `&uploadId=Y`. |
| POST   | `/api/noise-data`             | Admin+ | Upload new RMS noise CSV batch. |

### 4.8 Backups (routes/backups.js)

| Method | Path                              | Auth        | Description |
|--------|-----------------------------------|-------------|-------------|
| GET    | `/api/backups`                    | SuperUser+  | List backup files. |
| POST   | `/api/backups`                   | SuperUser+  | Create manual backup. |
| POST   | `/api/backups/:filename/restore`  | SuperUser+  | Restore from backup (server restart required after). |

---

## 5. Frontend API usage (public/js/api.js)

All server calls use relative URLs (e.g. `api/config`, `api/projects`). Base URL is the same origin (app root). Functions:

- **Auth**: `fetchSession()`
- **Config**: `fetchConfig()`, `updateConfig(body)`
- **Projects**: `fetchProjects()`, `fetchProjectStats()`, `createProject()`, `updateProject()`, `activateProject()`, `deactivateProjects()`, `deleteProject()`, `forceDeleteProject()`, `fetchStreamerDeployments()`, `updateStreamerDeployments()`, `deleteStreamerDeployment()`, `cleanupStreamers()`
- **Events**: `fetchEvents(params)`, `createEvent()`, `bulkCreateEvents(rows)`, `updateEvent()`, `deleteEvent()`, `clearEvents(project?)`
- **Stats**: `fetchStats()`, `fetchFilteredStats()`, `fetchLastCleaned()`, `fetchLastCleanedFiltered()`
- **EB**: `getEBRange(startSection, endSection)`
- **Backups**: `fetchBackups()`, `createBackup()`, `restoreBackup(filename)`
- **Noise**: `getNoiseUploads(projectNumber)`, `getNoiseData(uploadId?, projectNumber)`, `uploadNoiseData(payload)`

401 → session expired: clears storage, redirects to login. 403 → access denied toast.

---

## 6. Data flow (summary)

- **Request**: Browser sends `Authorization: Bearer <token>`. CORS allows only `ALLOWED_ORIGINS`.
- **Auth**: `authMiddleware` resolves token → `req.user`, `req.vesselScope` (null = global).
- **DB**: Routes use `db.js` Promise wrappers; keys at boundary are converted with `humps` (camelCase ↔ snake_case).
- **Response**: JSON for API; HTML files for `/`, `/config`, `/stats`, `/planning`.

---

## 7. Security & configuration (for reviewers)

- **Auth**: Users from `.env` `AUTH_USERS` (format: `USERNAME:PASSWORD:ROLE:VESSEL_TAG[:GLOBAL]`). No DB-stored passwords.
- **Sessions**: In-memory; no TTL; lost on restart.
- **CORS**: `ALLOWED_ORIGINS` must include the Hetzner (or production) origin.
- **CSP**: Configured in `server.js` (Helmet); jsPDF CDN allowed.
- **SQL**: Parameterized queries; vessel scoping applied on all data reads.

---

## 8. References

- **README.md** — Feature overview, usage, troubleshooting.
- **INSTALL.md** — Installation and deployment (including Hetzner/online).
- **API.md** — Links to README and this report for route details.

---

**Document purpose**: Code review and analysis handoff. For day-to-day usage and setup, see README.md and INSTALL.md.
