# Testing

This document describes the automated test suite and how to run manual checks. For API endpoint reference, see [API.md](API.md).

---

## Quick reference

```bash
# Install Playwright browsers (one-time)
npx playwright install chromium

# Run API tests
npm test

# Run E2E tests
npm run test:e2e

# Run with visible browser
npm run test:e2e:headed

# Run all tests (API then E2E)
npm run test:all
```

**Test users** (from `.env`): `superuser` / `super123` (SuperUser), `admin` / `admin123` (Admin), `viewer` / `view123` (Viewer).

**Test database:** `backend/test.db`. Reset with: `rm backend/test.db backend/test.db-*`.

**Expected runtime:** API ~10–30 s (90 tests); E2E ~2–8 min (server startup + 39 tests on one worker).

---

## Backend API tests

**Location:** `tests/*.test.js` and `tests/unit/*.test.js`  
**Runner:** Node built-in test runner (`node --test`) + supertest.  
**Database:** `DB_FILE=./backend/test.db` (set by `npm test`).  
**Command:** `npm test` runs both API and unit tests (`tests/*.test.js tests/unit/*.test.js`).

### Structure

| File | Coverage |
|------|----------|
| `tests/helpers.js` | Shared utilities, app import, `loginAs`, `authHeader` |
| `tests/auth.test.js` | Login, logout, session (all roles) |
| `tests/backups.test.js` | Backups list, create, restore (SuperUser only); auth/role checks |
| `tests/config.test.js` | Config GET/PUT, role checks |
| `tests/projects.test.js` | Project CRUD, GET active, GET stats, PUT :id, activate, deactivate, delete, force-delete, streamer-deployments (GET/PUT/DELETE), cleanup-streamers |
| `tests/events.test.js` | Event CRUD, PUT :id, bulk delete by project, global delete (SuperUser), validation (400) |
| `tests/stats.test.js` | GET /api/stats, GET /api/eb-range, GET /api/last-cleaned, GET /api/last-cleaned-filtered, GET /api/stats/filter |
| `tests/unit/eb.test.js` | `calculateEBRange` (backend/utils/eb.js) |
| `tests/unit/queryHelpers.test.js` | `buildEventsWhereClause` (backend/utils/queryHelpers.js) |
| `tests/unit/validation.test.js` | `toInt`, `requireValidId` (backend/utils/validation.js) |

### Conventions

- **Project and config** create/update/delete require **SuperUser**; use `superuser` / `super123`.
- **Events** use **streamerId** (integer 1–12), not `cableId`.
- **Backups** restore does not overwrite the DB file when `NODE_ENV=test` (avoids corrupting shared test DB).

### Coverage

- Authentication and authorization (superuser, admin, viewer), including logout and session invalidation
- Backups API (list, create, restore; SuperUser only; invalid filename, 404)
- Role-based access (403 for unauthorized actions)
- Configuration CRUD with role checks
- Project lifecycle (create, activate, deactivate, delete, force-delete), project update (PUT :id), streamer-deployments, cleanup-streamers
- Cleaning events (CRUD, PUT :id, bulk delete by project, global clear SuperUser only, validation 400)
- Statistics and filtering (stats, stats/filter, last-cleaned, last-cleaned-filtered, eb-range)
- Unit tests for backend utils: `eb.calculateEBRange`, `queryHelpers.buildEventsWhereClause`, `validation.toInt` / `requireValidId`
- Error handling and validation

### Test fixtures / test data

API tests use a **fresh test database** (`backend/test.db` when `DB_FILE=./backend/test.db`). The schema is applied when the server module is loaded; no seed data is required for auth, config, or events critical-path tests. To reset the test DB: `rm backend/test.db backend/test.db-*`. Ensure `AUTH_USERS` in `.env` (or the environment) includes at least one user for login tests; for config PUT tests a **superuser** role is required.

---

## E2E tests (Playwright)

**Location:** `e2e/*.spec.js`  
**Runner:** Playwright (Chromium).  
**Server:** Started automatically by `playwright.config.js` on **port 3001** with test DB (`PORT=3001 npm run start:test`). CORS allows `http://localhost:3001` when the app runs on that port.

### Structure

| File | Coverage |
|------|----------|
| `e2e/auth.spec.js` | Login, logout, session persistence |
| `e2e/backups.spec.js` | Backup section visibility (SuperUser), create backup, list; viewer cannot see backups |
| `e2e/navigation.spec.js` | Section navigation, active state, collapse/expand |
| `e2e/projects.spec.js` | Project creation, activation, list, deployment filter |
| `e2e/heatmap.spec.js` | Heatmap rendering, cleaning method toolbar, event creation |
| `e2e/styles.spec.js` | CSS load, classes, deployment grid, layout |

### Coverage

- Authentication flows (all roles)
- UI navigation and section switching
- Project management UI
- Heatmap visualization and event creation
- Role-based UI restrictions
- Critical CSS classes and styles
- Modals and toasts
- Responsive layout elements

---

## Troubleshooting

**Port already in use (E2E)**  
Playwright expects port 3001. Free it before running E2E:

```bash
lsof -ti:3001 | xargs kill -9
```

**Port 3000 (manual run)**  
If the dev server fails to start:

```bash
lsof -ti:3000 | xargs kill -9
```

**Database lock**  
Ensure no other process is using the test DB:

```bash
rm backend/test.db backend/test.db-*
```

**Tests hang**  
The backup scheduler runs on app startup; tests may pause briefly. API tests usually finish in under a minute; E2E can take several minutes.

**E2E login or API failures**  
Confirm `.env` has the test users and that CORS allows the origin (E2E uses port 3001; the server adds it when `PORT=3001`).

---

## CI/CD

Example for GitHub Actions:

```yaml
- name: Run API tests
  run: npm test

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
```

---

## Writing new tests

### API test example

```javascript
const { describe, it } = require("node:test");
const { app, loginAs, authHeader } = require("./helpers");
const request = require("supertest");
const assert = require("node:assert");

describe("My Feature API", () => {
  it("should do something", async () => {
    const token = await loginAs("admin", "admin123");
    const res = await request(app)
      .get("/api/my-endpoint")
      .set(authHeader(token));
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });
});
```

### E2E test example

```javascript
const { test, expect } = require('@playwright/test');

test('should display my feature', async ({ page }) => {
  await page.goto('/');
  await page.fill('#login-username', 'admin');
  await page.fill('#login-password', 'admin123');
  await page.click('#login-submit');
  await expect(page.locator('#my-feature')).toBeVisible();
});
```

---

## Manual testing (optional)

For manual checks (e.g. after schema or role changes):

1. **Start server:** `node backend/server.js` → http://localhost:3000  
2. **Credentials:** SuperUser `superuser`/`super123`, Admin `admin`/`admin123`, Viewer `viewer`/`view123`  
3. **Roles:** SuperUser can manage projects, config, and backups; Admin can manage events only; Viewer is read-only.  
4. **Schema:** Events use `streamer_id` INTEGER (1–12); `cleaning_events.project_number` has FK to `projects(project_number)` ON DELETE CASCADE.  
5. **API:** Use [API.md](API.md) for endpoints and auth. Example login: `curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"username":"superuser","password":"super123"}'`

If the UI doesn’t match role or schema expectations, clear `localStorage` and hard-refresh (Cmd+Shift+R / Ctrl+Shift+R), then log in again.
