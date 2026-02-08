# Legacy Code Removal Log

This document records legacy patterns removed during the streamer_id refactor (Steps 2 and 7).

## Removed

- **`cable_id` (TEXT)** – Replaced with `streamer_id` (INTEGER 1-12) in schema, backend, and frontend.
- **`toStreamerNum(cableId)`** – No longer needed; events use `streamerId` directly.
- **`cable-N` string format** – Replaced with integer streamer id everywhere.
- **Migration logic in db.js** – `migrateCleaningEvents()`, `migrateProjectsTable()`, and `migrateDatabase()` removed. Fresh install only; schema applied from `schema.sql`.
- **`ALTER TABLE` / migration scripts** – Not used; no migration path.

## Backend

- **server.js**: All event and deployment endpoints use `streamer_id` / `streamerId`. Last-cleaned and stats use `streamerId`-keyed maps.
- **schema.sql**: `cleaning_events.streamer_id INTEGER`, `streamer_deployments.streamer_id`, foreign keys with CASCADE.

## Frontend

- **app.js**: `dragState.streamerId`, `dataset.streamer`, all payloads use `streamerId`. No `cableId` or `toStreamerNum`.
- **pdf-generator.js**: Uses `evt.streamerId` for labels.

## Verification

- Grep for `cable_id`, `cableId`, `toStreamerNum`, `cable-` in source (excluding docs) returns no matches in application code.
- Docs (TEST_*.md, testing-results.md) may still mention old names for historical context.
