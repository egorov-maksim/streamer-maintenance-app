# API Reference

Base URL: same origin as the app (e.g. `http://localhost:3000`).

## Authentication

- **Login**: `POST /api/login` — Body: `{ "username", "password" }`. Returns `{ "token", "user": { "username", "role" } }`.
- **Logout**: `POST /api/logout` — Body: `{ "token" }`.
- **Session**: `GET /api/session` — Requires `Authorization: Bearer <token>`. Returns `{ "username", "role" }`.

Protected routes require header: `Authorization: Bearer <token>`.

## Roles

| Role       | Value      | Capabilities |
|-----------|------------|--------------|
| SuperUser | `superuser`| Projects, config, deployments, backups, global clear, force-delete |
| Admin     | `admin`    | Event CRUD, per-project clear |
| Viewer    | `viewer`   | Read-only |

## Protected Routes by Role

### SuperUser only
- `PUT /api/config` — Update global config
- `POST /api/projects` — Create project
- `PUT /api/projects/:id` — Update project
- `PUT /api/projects/:id/activate` — Activate project
- `POST /api/projects/deactivate` — Clear active project
- `DELETE /api/projects/:id` — Delete project (409 if has data; then use force)
- `DELETE /api/projects/:id/force` — Force delete project and all related events/deployments
- `PUT /api/projects/:id/streamer-deployments` — Save deployment configs
- `DELETE /api/projects/:id/streamer-deployments/:streamerId` — Clear one streamer config
- `GET /api/backups` — List backups
- `POST /api/backups` — Create backup
- `POST /api/backups/:filename/restore` — Restore backup
- `POST /api/cleanup-streamers` — Body: `{ "maxStreamerId" }`. Delete events and deployments where `streamer_id > maxStreamerId`
- `DELETE /api/events` (no query) — Global clear all events (returns `deletedCount`)

### Admin or SuperUser
- `POST /api/events` — Create event (body: `streamerId`, `sectionIndexStart`, `sectionIndexEnd`, `cleaningMethod`, `cleanedAt`, …)
- `PUT /api/events/:id` — Update event
- `DELETE /api/events/:id` — Delete event
- `DELETE /api/events?project=<projectNumber>` — Clear events for one project (returns `deletedCount`)

### Authenticated (any role)
- `GET /api/config`
- `GET /api/projects`
- `GET /api/projects/active`
- `GET /api/projects/:id/streamer-deployments`
- `GET /api/events`, `GET /api/events?project=...`
- `GET /api/last-cleaned`, `GET /api/last-cleaned?project=...`
- `GET /api/stats`, `GET /api/stats/filter`, `GET /api/eb-range`, etc.

## Project Delete Flow

1. `DELETE /api/projects/:id`  
   - If project has no events/deployments: deletes and returns 200.  
   - If it has data: returns **409** with `{ "requiresConfirmation": true, "eventCount", "deploymentCount" }`.
2. Frontend shows modal: “Type DELETE to confirm.”
3. User types DELETE and confirms → `DELETE /api/projects/:id/force` (SuperUser only). Project and related data are removed.

## Schema (Fresh Install)

- **cleaning_events**: `streamer_id` INTEGER (1–12), `project_number` FK to `projects(project_number)` ON DELETE CASCADE.
- **streamer_deployments**: `streamer_id` INTEGER (1–12), `project_id` FK to `projects(id)` ON DELETE CASCADE; `is_coated` can be NULL (unknown), 0 (uncoated), 1 (coated).
- No migration from legacy schema; installs use current schema only.
