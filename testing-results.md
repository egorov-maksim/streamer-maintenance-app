# Testing Results - Step 1: Delete/Clear Functions

**Date:** February 8, 2026  
**Testing Phase:** Pre-refactoring baseline behavior capture

## Current Database Schema Status

### Tables
- `cleaning_events`: Uses `cable_id TEXT` (format: "cable-0", "cable-1", etc.)
- `streamer_deployments`: Uses `streamer_number INTEGER` (1-12)
- `projects`: No FK from cleaning_events to projects (no CASCADE)
- `app_config`: Key-value store

### Foreign Keys
- `streamer_deployments.project_id` → `projects.id` ON DELETE CASCADE ✓
- `cleaning_events.project_number` → `projects.project_number` **NO FK** ❌

---

## Test Scenario 1: Project Deletion

### Test Setup
```sql
-- Create test project
INSERT INTO projects (project_number, project_name, created_at, is_active) 
VALUES ('TEST-001', 'Test Project', datetime('now'), 0);

-- Add events to project
INSERT INTO cleaning_events (cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, project_number)
VALUES ('cable-0', 0, 10, 'rope', datetime('now'), 'TEST-001');

-- Add deployment config
INSERT INTO streamer_deployments (project_id, streamer_number, deployment_date, is_coated)
SELECT id, 1, date('now'), 1 FROM projects WHERE project_number = 'TEST-001';
```

### Expected Behavior (Current)
Backend blocks deletion if events exist:
- Response: `400 { error: "Cannot delete project with N associated events..." }`
- Project remains in database
- Events remain in database
- Deployment configs: **CASCADE DELETE should work** ✓

### Verification Queries
```sql
-- Check events remain
SELECT COUNT(*) as event_count FROM cleaning_events WHERE project_number = 'TEST-001';

-- Check deployment configs
SELECT COUNT(*) as deployment_count FROM streamer_deployments 
WHERE project_id = (SELECT id FROM projects WHERE project_number = 'TEST-001');

-- Check project still exists
SELECT * FROM projects WHERE project_number = 'TEST-001';
```

### Issues Found
1. **No CASCADE from events to projects** - Events orphaned if project deleted via SQL
2. **Inconsistent protection** - Backend blocks delete, but no DB-level constraint

---

## Test Scenario 2: Clear Active Project

### Test Setup
```sql
-- Activate a project
UPDATE projects SET is_active = 1 WHERE project_number = 'TEST-001';
UPDATE app_config SET value = 'TEST-001' WHERE key = 'active_project_number';
```

### Expected Behavior
Frontend "Clear Active Project" button should:
- POST `/api/projects/deactivate`
- Set all `projects.is_active = 0`
- Remove `active_project_number` from `app_config` or set to NULL

### Verification Queries
```sql
-- Check no active project
SELECT COUNT(*) as active_count FROM projects WHERE is_active = 1;
-- Expected: 0

-- Check app_config cleared
SELECT value FROM app_config WHERE key = 'active_project_number';
-- Expected: NULL or empty
```

### Issues Found
- Need to verify behavior in application

---

## Test Scenario 3: Clear All Events

### Test Cases

#### 3A: Clear All Events (Global)
```sql
-- Setup: Add events to multiple projects
INSERT INTO cleaning_events (cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, project_number)
VALUES 
  ('cable-0', 0, 5, 'rope', datetime('now'), 'TEST-001'),
  ('cable-1', 10, 15, 'scraper', datetime('now'), 'TEST-002'),
  ('cable-2', 20, 25, 'rope', datetime('now'), NULL);

-- Action: DELETE /api/events (no project param)
DELETE FROM cleaning_events;

-- Verify all deleted
SELECT COUNT(*) FROM cleaning_events;
-- Expected: 0
```

#### 3B: Clear Events by Project
```sql
-- Action: DELETE /api/events?project=TEST-001
DELETE FROM cleaning_events WHERE project_number = 'TEST-001';

-- Verify only TEST-001 deleted
SELECT COUNT(*) FROM cleaning_events WHERE project_number = 'TEST-001';
-- Expected: 0

SELECT COUNT(*) FROM cleaning_events WHERE project_number = 'TEST-002';
-- Expected: > 0 (other project events remain)
```

### Issues Found
- Current implementation requires admin role for all clears
- No differentiation between global vs per-project clear permissions

---

## Test Scenario 4: Clear Streamer Deployment

### Test Setup
```sql
-- Add deployment configs for multiple streamers
INSERT INTO streamer_deployments (project_id, streamer_number, deployment_date, is_coated)
SELECT id, 1, date('now'), 1 FROM projects WHERE project_number = 'TEST-001'
UNION ALL
SELECT id, 2, date('now'), 0 FROM projects WHERE project_number = 'TEST-001';
```

### Test Cases

#### 4A: Clear Single Streamer
```sql
-- Action: DELETE /api/projects/:id/streamer-deployments/:streamerNumber
DELETE FROM streamer_deployments 
WHERE project_id = ? AND streamer_number = 1;

-- Verify only streamer 1 deleted
SELECT COUNT(*) FROM streamer_deployments 
WHERE project_id = ? AND streamer_number = 1;
-- Expected: 0

SELECT COUNT(*) FROM streamer_deployments 
WHERE project_id = ? AND streamer_number = 2;
-- Expected: 1
```

#### 4B: Clear All Streamer Configs (implied by project deletion)
```sql
-- When project deleted (with CASCADE), all deployments should be deleted
-- Currently blocked by event protection, but CASCADE should work for deployments
```

### Issues Found
- Works as expected with CASCADE
- Need UI button for "Clear All Deployment Configs" for active project

---

## Test Scenario 5: Change Streamer Count

### Test Setup
```sql
-- Current config: 12 streamers
-- Add events and deployments for streamers 1-12
INSERT INTO cleaning_events (cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at)
VALUES 
  ('cable-0', 0, 5, 'rope', datetime('now')),
  ('cable-8', 0, 5, 'rope', datetime('now')),  -- Streamer 9
  ('cable-11', 0, 5, 'rope', datetime('now')); -- Streamer 12

-- Change config to 8 streamers
UPDATE projects SET num_cables = 8 WHERE project_number = 'TEST-001';
-- OR
UPDATE app_config SET value = '8' WHERE key = 'num_cables';
```

### Expected Behavior
**Current:** No automatic cleanup
- Events for streamers 9-12 (`cable-8` to `cable-11`) remain in DB
- UI only shows 8 columns, hiding streamers 9-12
- Data is "orphaned" but not deleted

### Verification Queries
```sql
-- Check for "orphaned" events beyond streamer 8
SELECT cable_id, COUNT(*) as event_count 
FROM cleaning_events 
WHERE cable_id IN ('cable-8', 'cable-9', 'cable-10', 'cable-11')
GROUP BY cable_id;

-- Check for orphaned deployments
SELECT streamer_number, COUNT(*) as config_count
FROM streamer_deployments
WHERE streamer_number > 8
GROUP BY streamer_number;
```

### Issues Found
1. **No warning when reducing streamer count** - User not informed of hidden data
2. **No cleanup mechanism** - Orphaned data accumulates
3. **No UI refresh** - Deployment grid doesn't update automatically

---

## Summary of Issues

### Critical Issues
1. ❌ **No FK CASCADE from cleaning_events to projects** - Events can be orphaned
2. ❌ **Inconsistent naming**: `cable_id` (TEXT) vs `streamer_number` (INTEGER)
3. ❌ **No cleanup for reduced streamer count** - Orphaned data accumulates
4. ❌ **No auto-refresh on config change** - UI out of sync

### Medium Priority
5. ⚠️ **Backend blocks project delete** - Should allow with confirmation + CASCADE
6. ⚠️ **No role differentiation** - Global clear should be SuperUser only
7. ⚠️ **No user feedback** - No warning when data will be hidden

### Low Priority
8. ℹ️ **Helper function needed** - `toStreamerNum()` conversion indicates schema issue

---

## Recommendations for Step 2+

### Database Schema (Step 2)
1. Rename `cable_id` → `streamer_id INTEGER NOT NULL`
2. Add `FOREIGN KEY (project_number) REFERENCES projects(project_number) ON DELETE CASCADE`
3. Rename `streamer_number` → `streamer_id` for consistency
4. Add index on `streamer_id`

### Delete Operations (Step 6)
1. Add `DELETE /api/projects/:id/force` endpoint (SuperUser only)
2. Return confirmation payload when project has data
3. Implement CASCADE delete verification

### Config Changes (Step 5)
1. Add warning modal when reducing streamer count
2. Add `POST /api/cleanup-streamers` endpoint
3. Auto-refresh deployment grid on config save

### Role System (Step 3)
1. Add SuperUser role
2. Restrict global operations to SuperUser
3. Allow Admin to manage events only

---

## Test Execution Checklist

- [ ] Run application in development mode
- [ ] Test project creation and deletion
- [ ] Test clear active project
- [ ] Test clear all events (global and per-project)
- [ ] Test streamer deployment clear
- [ ] Test config change with streamer count reduction
- [ ] Verify SQL queries for orphaned data
- [ ] Document all findings

**Status:** Documentation complete. Manual testing recommended before Step 2 implementation.
