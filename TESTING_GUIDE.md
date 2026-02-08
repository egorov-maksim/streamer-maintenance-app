# Testing Guide - Steps 2 & 3 Implementation

## Overview
This guide will help you test the implemented changes:
- **Step 2**: Database schema refactoring (cable_id → streamer_id)
- **Step 3**: Three-level user role system (SuperUser / Admin / Viewer)

## Prerequisites

### 1. Check .env Configuration
Verify your `.env` file has the correct user setup:

```env
PORT=3000
DB_FILE=backend/streamer.db
ALLOWED_ORIGINS=http://localhost:3000
AUTH_USERS=superuser:super123:superuser,admin:admin123:admin,viewer:view123:viewer
```

**Default Test Credentials:**
- SuperUser: `superuser` / `super123`
- Admin: `admin` / `admin123`
- Viewer: `viewer` / `view123`

### 2. Start the Server

```bash
cd /Users/maksimegorov/Desktop/streamer-maintenance-app
node backend/server.js
```

Expected output:
```
Server running on http://localhost:3000
Database schema applied.
Starting automated database backup scheduler (every 12 hours)
Database backup created: streamer_backup_2026-02-08T12-01-32-142Z.db
```

### 3. Open the Application
Navigate to: **http://localhost:3000**

---

## Test Plan

### Phase 1: Database Schema Verification (Step 2)

#### Test 1.1: Verify Fresh Schema
**Goal:** Confirm the new schema is correctly applied

**Steps:**
1. Stop the server if running
2. Delete the database: `rm backend/streamer.db`
3. Start the server
4. Check the database schema:
   ```bash
   sqlite3 backend/streamer.db ".schema cleaning_events"
   ```

**Expected Result:**
```sql
CREATE TABLE cleaning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,  -- ✓ Changed from cable_id TEXT
  section_index_start INTEGER NOT NULL,
  section_index_end INTEGER NOT NULL,
  cleaning_method TEXT NOT NULL,
  cleaned_at TEXT NOT NULL,
  cleaning_count INTEGER DEFAULT 1,
  project_number TEXT,
  vessel_tag TEXT DEFAULT 'TTN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_number) REFERENCES projects(project_number) ON DELETE CASCADE  -- ✓ New CASCADE
);
```

**Pass Criteria:**
- ✅ Column is `streamer_id INTEGER` (not `cable_id TEXT`)
- ✅ Foreign key with `ON DELETE CASCADE` exists
- ✅ Index on `streamer_id` exists

#### Test 1.2: Verify streamer_deployments
```bash
sqlite3 backend/streamer.db ".schema streamer_deployments"
```

**Expected Result:**
```sql
CREATE TABLE streamer_deployments (
  ...
  streamer_id INTEGER NOT NULL,  -- ✓ Changed from streamer_number
  ...
  UNIQUE(project_id, streamer_id)
);
```

---

### Phase 2: Role-Based Access Control (Step 3)

#### Test 2.1: SuperUser Role
**Login:** `superuser` / `super123`

**Expected Capabilities:**
| Action | Should Work? | Test |
|--------|-------------|------|
| View all data | ✅ Yes | Navigate through heatmap, log, stats |
| Create project | ✅ Yes | Try creating a new project |
| Edit configuration | ✅ Yes | Try changing num_cables or other config |
| Activate/deactivate project | ✅ Yes | Try activating a project |
| Delete project | ✅ Yes | Try deleting a project |
| Save deployment config | ✅ Yes | Try setting deployment date/coating |
| Create/edit/delete events | ✅ Yes | Try adding a cleaning event |
| Global "Clear All Events" | ✅ Yes | Button should be visible |
| Access backups | ✅ Yes | Check if backup section is visible |

**UI Indicators:**
- Role badge should show: **"Super User"** (orange/gold styling)
- All admin-only and superuser-only elements visible
- All inputs enabled

#### Test 2.2: Admin Role
**Login:** `admin` / `admin123`

**Expected Capabilities:**
| Action | Should Work? | Test |
|--------|-------------|------|
| View all data | ✅ Yes | Navigate through heatmap, log, stats |
| Create project | ❌ No | Button should be hidden |
| Edit configuration | ❌ No | Config inputs should be disabled |
| Activate/deactivate project | ❌ No | Buttons should be hidden |
| Delete project | ❌ No | Delete button should be hidden |
| Save deployment config | ❌ No | Inputs should be disabled |
| Create/edit/delete events | ✅ Yes | Should work for all events |
| Clear events (per-project) | ✅ Yes | Should work for specific projects |
| Global "Clear All Events" | ❌ No | Button should be hidden |
| Access backups | ❌ No | Section should be hidden |

**UI Indicators:**
- Role badge should show: **"Administrator"** (blue styling)
- Only admin-only elements visible (not superuser-only)
- Config and project inputs disabled

#### Test 2.3: Viewer Role
**Login:** `viewer` / `view123`

**Expected Capabilities:**
| Action | Should Work? | Test |
|--------|-------------|------|
| View all data | ✅ Yes | Navigate through heatmap, log, stats |
| Create project | ❌ No | Button should be hidden |
| Edit configuration | ❌ No | Inputs should be disabled |
| Create/edit/delete events | ❌ No | Buttons should be hidden |
| Drag-to-select on heatmap | ❌ No | Should not open modal |
| Manual event entry | ❌ No | Inputs should be disabled |
| Clear any events | ❌ No | All clear buttons hidden |
| Access backups | ❌ No | Section should be hidden |

**UI Indicators:**
- Role badge should show: **"Viewer"** (gray styling)
- All action buttons hidden
- All inputs disabled
- "View Only" badges visible

#### Test 2.4: Role Persistence
1. Login as SuperUser
2. Refresh the page
3. **Expected:** Should remain logged in as SuperUser
4. Close browser tab
5. Reopen http://localhost:3000
6. **Expected:** Should still be logged in (session persisted in localStorage)

---

### Phase 3: Data Integrity Tests (Step 2)

#### Test 3.1: Create Event with streamerId
**Login as:** SuperUser or Admin

**Steps:**
1. Add a cleaning event manually:
   - Streamer: `1`
   - Sections: `1` to `10`
   - Method: `rope`
2. Check the database:
   ```bash
   sqlite3 backend/streamer.db "SELECT streamer_id, section_index_start, section_index_end FROM cleaning_events LIMIT 1;"
   ```

**Expected Result:**
```
1|0|9
```
- ✅ `streamer_id` is `1` (INTEGER, not "cable-0" TEXT)
- ✅ Sections are 0-based internally

#### Test 3.2: Heatmap Display
**Login as:** Any role

**Steps:**
1. Add events for different streamers (1, 5, 12)
2. View the heatmap

**Expected Result:**
- ✅ Columns labeled S1, S5, S12 (not S0, S4, S11)
- ✅ Heatmap displays correctly with color coding
- ✅ Hover tooltips show correct streamer numbers (1-12)

#### Test 3.3: CASCADE Delete
**Login as:** SuperUser

**Steps:**
1. Create a test project: "TEST-001"
2. Activate it
3. Add 3 cleaning events to that project
4. Check event count:
   ```bash
   sqlite3 backend/streamer.db "SELECT COUNT(*) FROM cleaning_events WHERE project_number='TEST-001';"
   ```
   **Expected:** `3`
5. Delete the project "TEST-001"
6. Check event count again:
   ```bash
   sqlite3 backend/streamer.db "SELECT COUNT(*) FROM cleaning_events WHERE project_number='TEST-001';"
   ```
   **Expected:** `0` (events automatically deleted via CASCADE)

#### Test 3.4: Statistics Accuracy
**Login as:** Any role

**Steps:**
1. Add events for streamers 1, 2, 3
2. View statistics section

**Expected Result:**
- ✅ Total events count is correct
- ✅ Unique sections count is accurate
- ✅ Per-streamer breakdown shows correct streamer numbers (1-12)
- ✅ No reference to "cable-0" or similar

---

### Phase 4: API Testing

#### Test 4.1: Event Creation API
```bash
# Login first to get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superuser","password":"super123"}' \
  | jq -r '.token')

# Create an event
curl -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "streamerId": 5,
    "sectionIndexStart": 0,
    "sectionIndexEnd": 10,
    "cleaningMethod": "rope",
    "cleanedAt": "2026-02-08T12:00:00Z"
  }'
```

**Expected Response:**
```json
{
  "id": 1,
  "streamerId": 5,
  "sectionIndexStart": 0,
  "sectionIndexEnd": 10,
  "cleaningMethod": "rope",
  "cleanedAt": "2026-02-08T12:00:00Z",
  ...
}
```

#### Test 4.2: Last-Cleaned API
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/last-cleaned | jq '.'
```

**Expected Response:**
```json
{
  "lastCleaned": {
    "1": [null, null, ...],
    "2": [null, null, ...],
    ...
    "12": [null, null, ...]
  }
}
```
- ✅ Keys are integers (1-12), not strings ("cable-0")

#### Test 4.3: Role-Based Endpoint Protection
**As Viewer:**
```bash
# Get viewer token
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer","password":"view123"}' \
  | jq -r '.token')

# Try to create event (should fail)
curl -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "streamerId": 1,
    "sectionIndexStart": 0,
    "sectionIndexEnd": 5,
    "cleaningMethod": "rope",
    "cleanedAt": "2026-02-08T12:00:00Z"
  }'
```

**Expected Response:**
```json
{
  "error": "Admin access required"
}
```
Status code: `403`

**As Admin (try to create project - should fail):**
```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.token')

curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectNumber": "TEST-001",
    "projectName": "Test"
  }'
```

**Expected Response:**
```json
{
  "error": "SuperUser access required"
}
```
Status code: `403`

---

## Critical Issues to Check

### Issue Checklist

| Issue | Description | How to Verify | Status |
|-------|-------------|---------------|--------|
| Schema Applied | New schema with streamer_id | Check `.schema` output | ⬜ |
| CASCADE Works | Deleting project deletes events | Test project deletion | ⬜ |
| No cable-0 | No TEXT cable IDs anywhere | Check DB and logs | ⬜ |
| SuperUser Works | Can do everything | Test all operations | ⬜ |
| Admin Restricted | Cannot manage projects/config | Test restrictions | ⬜ |
| Viewer Read-Only | Cannot modify anything | Test all restrictions | ⬜ |
| Session Persists | Login survives page refresh | Refresh test | ⬜ |
| Heatmap Displays | Shows correct streamer numbers | Visual check | ⬜ |
| Stats Accurate | Counts match reality | Add events, verify | ⬜ |
| No Errors | Console clean | Check browser console | ⬜ |

---

## Known Limitations (Not Yet Implemented)

These features are planned for Steps 4-9:

- ⏳ Modern deployment card UI (Step 4)
- ⏳ Auto-refresh on config change (Step 5)
- ⏳ Force-delete confirmation modal (Step 6)
- ⏳ Deployment date tooltip on heatmap hover (Step 8)

---

## Troubleshooting

### Issue: Server won't start
**Symptom:** `EADDRINUSE: address already in use 0.0.0.0:3000`

**Solution:**
```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9

# Or kill all node processes
killall node

# Then restart
node backend/server.js
```

### Issue: Database locked
**Symptom:** `Error: SQLITE_BUSY: database is locked`

**Solution:**
```bash
# Stop server
# Delete WAL files
rm backend/streamer.db-wal backend/streamer.db-shm
# Restart server
```

### Issue: Login fails
**Symptom:** "Invalid credentials"

**Solution:**
1. Check `.env` has correct `AUTH_USERS` format
2. Verify username:password:role format
3. Restart server after changing `.env`

### Issue: Role not working
**Symptom:** UI doesn't match expected role permissions

**Solution:**
1. Clear browser localStorage: `localStorage.clear()`
2. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
3. Login again

---

## Success Criteria

Implementation is **PASSING** if:

✅ All database schema changes applied correctly  
✅ All three roles (SuperUser/Admin/Viewer) work as expected  
✅ CASCADE delete works properly  
✅ No references to "cable-0" or cable_id in DB or UI  
✅ Session persistence works across refreshes  
✅ API returns streamerId (1-12) as integers  
✅ No console errors during normal operations  
✅ Heatmap displays streamer numbers correctly  
✅ Role-based endpoint protection works  
✅ Statistics calculate correctly with new schema  

---

## Reporting Issues

If you find any issues, please note:
1. **What you did** (exact steps)
2. **What you expected**
3. **What actually happened**
4. **Role you were logged in as**
5. **Browser console errors** (F12 → Console tab)
6. **Server logs** (terminal output)

This information will help fix any bugs quickly.
